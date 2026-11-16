/**
 * « Qui veut-on faire entrer, et où en sont les invitations ? » (`/admin/pros/invite`).
 * UNE porte : on choisit d'abord le type de compte et le produit, puis la page
 * appelle le chemin qui existe déjà :
 *   club · Yuno Tickets         → création du club + invite-owner (ou lien d'accès)
 *   organisateur / association  → invite-platform-user
 *   agence                      → invite-affiliate
 *   Yuno CRM / offre fondateurs → crm_admin_invite_create (pré-profil, places
 *                                 de l'offre fondateurs, accès assisté proposé)
 * Toutes les invitations, toutes portes, sont listées dessous
 * (admin_pending_invitations) ; une ligne ouvre son tiroir (`?open=<source>:<id>`)
 * avec les gestes de sa porte (envoyer, relancer, prolonger, révoquer).
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Badge, Card, DataTable, Page, Section, Status, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtDate, fmtRelative } from '@/lib/adminFormat';
import { Field } from './gestures';
import { accountHref, venueIdFromName, type AccountType } from './accounts';
import { useInvitations, useProsRefresh, type PendingInvite } from './data';
import { CrmInviteForm } from './invite/CrmInviteForm';
import { INVITE_TONE, InviteDrawer } from './invite/InviteDrawer';

type Product = 'tickets' | 'crm' | 'founder';
const TYPES: AccountType[] = ['club', 'organizer', 'association', 'agency'];

async function invoke(fn: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let msg = error.message;
    try { const b = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.(); if (b?.error) msg = b.error; } catch { /* corps non JSON */ }
    throw new Error(msg);
  }
  if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
  return data as Record<string, unknown>;
}

export default function InvitePage() {
  const { t } = useAdminT();
  const [sp, setSp] = useSearchParams();
  // `?type=club&product=crm` ouvre directement un formulaire ; `?f=founder` est l'ancien lien de l'offre fondateurs.
  const founderLink = sp.get('f') === 'founder';
  const initType = TYPES.find((v) => v === sp.get('type')) ?? (founderLink ? 'club' : null);
  const initProduct = (['tickets', 'crm', 'founder'] as const).find((v) => v === sp.get('product')) ?? (founderLink ? 'founder' : null);
  const [type, setType] = useState<AccountType | null>(initType);
  const [product, setProduct] = useState<Product | null>(initType === 'agency' ? 'tickets' : initType ? initProduct : null);
  const openInvite = (key: string) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('open', key); return n; }, { replace: true });
  const products: Product[] = type === 'agency' ? ['tickets'] : ['tickets', 'crm', 'founder'];

  return (
    <Page title={t('adm.pros.inv.title')} subtitle={t('adm.pros.inv.sub')}>
      <Card>
        <div className="flex flex-col gap-4">
          <Choice<AccountType> label={t('adm.pros.inv.step1')} value={type} options={TYPES.map((v) => ({ v, label: t(`adm.pros.type.${v}`) }))}
            onChange={(v) => { setType(v); setProduct(v === 'agency' ? 'tickets' : null); }} />
          {type && (
            <Choice<Product> label={t('adm.pros.inv.step2')} value={product} options={products.map((v) => ({ v, label: t(`adm.pros.inv.p.${v}`) }))} onChange={setProduct} />
          )}
        </div>
      </Card>

      {type && product === 'tickets' && type === 'club' && <ClubForm />}
      {type && product === 'tickets' && (type === 'organizer' || type === 'association') && <OrganizerForm association={type === 'association'} />}
      {type === 'agency' && product === 'tickets' && <AgencyForm />}
      {type && type !== 'agency' && (product === 'crm' || product === 'founder') && (
        <CrmInviteForm key={`${type}:${product}`} kind={type === 'club' ? 'club' : 'organizer'} founder={product === 'founder'} onCreated={(id) => openInvite(`crm:${id}`)} />
      )}

      <InvitationsList onOpen={(r) => openInvite(`${r.source}:${r.id}`)} />
    </Page>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="a-t1 text-[13px] font-medium">{label}</span>
      <div className="a-seg flex-wrap self-start" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function ClubForm() {
  const { t } = useAdminT();
  const refresh = useProsRefresh();
  const [f, setF] = useState({ name: '', city: '', address: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const id = venueIdFromName(f.name);
  const submit = async () => {
    if (!f.name.trim() || !f.city.trim() || !id) { toast.error(t('adm.pros.g.editMissing')); return; }
    setBusy(true);
    try {
      const patch: Record<string, unknown> = { id, name: f.name.trim(), city: f.city.trim(), address: f.address.trim() || null };
      if (f.address.trim()) {
        const { data } = await supabase.functions.invoke('geocode-address', { body: { address: f.address.trim() } });
        if (data?.latitude && data?.longitude) { patch.latitude = data.latitude; patch.longitude = data.longitude; }
      }
      const { error } = await supabase.from('venues').insert(patch as never);
      if (error) throw error;
      if (f.email.trim()) {
        const d = await invoke('invite-owner', { email: f.email.trim(), venue_id: id, venue_name: f.name.trim() });
        toast.success(t(d.user_exists ? 'adm.pros.inv.ownerAssigned' : 'adm.pros.inv.sent', { email: f.email.trim() }));
      } else {
        const d = await invoke('accept-staff-invitation', { action: 'create_onboarding_link', role: 'owner', venue_id: id });
        if (typeof d.url === 'string') setLink(d.url);
      }
      setCreated(id);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('adm.ui.error.title'));
    } finally { setBusy(false); }
  };
  return (
    <Section title={t('adm.pros.inv.clubTitle')} description={t('adm.pros.inv.clubSub')}>
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('adm.pros.f.name')} hint={id ? t('adm.pros.inv.clubId', { id }) : undefined}><input className="a-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('adm.pros.f.city')}><input className="a-input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label={t('adm.pros.f.address')}><input className="a-input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label={t('adm.pros.inv.ownerEmail')} hint={t('adm.pros.inv.ownerEmailHint')}><input className="a-input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="a-btn a-btn--primary" disabled={busy || !!created} onClick={() => void submit()}>{t(busy ? 'adm.ui.working' : 'adm.pros.inv.createClub')}</button>
          {created && <Link className="a-btn" to={accountHref(`venue:${created}`)}>{t('adm.pros.inv.openCard')}</Link>}
          {link && <CopyLink url={link} />}
        </div>
      </Card>
    </Section>
  );
}

function OrganizerForm({ association }: { association: boolean }) {
  const { t } = useAdminT();
  const refresh = useProsRefresh();
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [help, setHelp] = useState(true);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!email.trim() || !org.trim()) { toast.error(t('adm.pros.g.editMissing')); return; }
    setBusy(true);
    try {
      await invoke('invite-platform-user', { email: email.trim(), organization_name: org.trim(), offer_support_help: help });
      toast.success(t('adm.pros.inv.sent', { email: email.trim() }));
      setEmail(''); setOrg('');
      void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('adm.ui.error.title')); } finally { setBusy(false); }
  };
  return (
    <Section title={t(association ? 'adm.pros.inv.assocTitle' : 'adm.pros.inv.orgTitle')} description={t(association ? 'adm.pros.inv.assocSub' : 'adm.pros.inv.orgSub')}>
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('adm.pros.inv.orgName')}><input className="a-input" value={org} onChange={(e) => setOrg(e.target.value)} /></Field>
          <Field label={t('adm.pros.f.email')}><input className="a-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
        <label className="a-t2 mt-3 inline-flex items-center gap-2 text-[13px]"><input type="checkbox" checked={help} onChange={(e) => setHelp(e.target.checked)} />{t('adm.pros.inv.offerHelp')}</label>
        <div className="mt-4"><button type="button" className="a-btn a-btn--primary" disabled={busy} onClick={() => void submit()}>{t(busy ? 'adm.ui.working' : 'adm.pros.inv.send')}</button></div>
      </Card>
    </Section>
  );
}

function AgencyForm() {
  const { t } = useAdminT();
  const refresh = useProsRefresh();
  const [f, setF] = useState({ email: '', name: '', city: '', rate: '10' });
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const submit = async () => {
    if (!f.email.trim() || !f.name.trim()) { toast.error(t('adm.pros.g.editMissing')); return; }
    setBusy(true);
    try {
      const d = await invoke('invite-affiliate', { email: f.email.trim(), name: f.name.trim(), city: f.city.trim() || null, type: 'agency', commission_rate: Number.parseFloat(f.rate) || 0 });
      if (d.email_sent === false && typeof d.invite_link === 'string') setLink(d.invite_link);
      else toast.success(t(d.user_exists ? 'adm.pros.inv.agencyActivated' : 'adm.pros.inv.sent', { email: f.email.trim() }));
      void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('adm.ui.error.title')); } finally { setBusy(false); }
  };
  return (
    <Section title={t('adm.pros.inv.agencyTitle')} description={t('adm.pros.inv.agencySub')}>
      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('adm.pros.f.name')}><input className="a-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('adm.pros.f.email')}><input className="a-input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label={t('adm.pros.f.city')}><input className="a-input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label={t('adm.pros.inv.rate')}><input className="a-input" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="a-btn a-btn--primary" disabled={busy} onClick={() => void submit()}>{t(busy ? 'adm.ui.working' : 'adm.pros.inv.send')}</button>
          {link && <CopyLink url={link} />}
        </div>
      </Card>
    </Section>
  );
}

function CopyLink({ url }: { url: string }) {
  const { t } = useAdminT();
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="a-mono a-t2 max-w-[360px] truncate text-[12px]">{url}</span>
      <button type="button" className="a-btn a-btn--sm" onClick={() => { void navigator.clipboard?.writeText(url); toast.success(t('adm.pros.inv.copied')); }}>
        <Copy className="h-3.5 w-3.5" />{t('adm.pros.inv.copy')}
      </button>
    </span>
  );
}

function InvitationsList({ onOpen }: { onOpen: (r: PendingInvite) => void }) {
  const { t, lang } = useAdminT();
  const q = useInvitations();
  const [sp, setSp] = useSearchParams();
  const [all, setAll] = useState(false);
  const rows = useMemo(() => (q.data ?? []).filter((r) => all || r.state === 'pending'), [q.data, all]);
  const tone = (s: PendingInvite['state']) => INVITE_TONE[s];
  const openKey = sp.get('open');
  const opened = openKey ? (q.data ?? []).find((r) => `${r.source}:${r.id}` === openKey) ?? null : null;
  const close = () => setSp((prev) => { const n = new URLSearchParams(prev); n.delete('open'); return n; }, { replace: true });
  const columns: ColumnDef<PendingInvite, unknown>[] = [
    {
      id: 'who', header: t('adm.pros.pr.col.who'), accessorFn: (r) => `${r.name ?? ''} ${r.email ?? ''}`,
      cell: ({ row: { original: r } }) => (
        <div className="min-w-0">
          <div className="a-t1 truncate font-medium">{r.account_key ? <Link className="hover:underline" to={accountHref(r.account_key)} onClick={(e) => e.stopPropagation()}>{r.name ?? r.email}</Link> : (r.name ?? r.email ?? '—')}</div>
          {r.name && <div className="a-t3 truncate text-[12px]">{r.email}</div>}
        </div>
      ),
    },
    { id: 'type', header: t('adm.pros.col.type'), accessorKey: 'type', cell: ({ row: { original: r } }) => t(`adm.pros.type.${r.type}`) },
    { id: 'product', header: t('adm.pros.col.products'), accessorKey: 'product', cell: ({ row: { original: r } }) => <Badge tone={r.product === 'tickets' ? 'neutral' : 'accent'}>{t(`adm.pros.inv.p.${r.product}`)}</Badge> },
    { id: 'state', header: t('adm.pros.col.status'), accessorKey: 'state', cell: ({ row: { original: r } }) => <Status tone={tone(r.state)}>{t(`adm.pros.inv.s.${r.state}`)}</Status> },
    { id: 'at', header: t('adm.pros.inv.sentAt'), accessorFn: (r) => new Date(r.created_at).getTime(), cell: ({ row: { original: r } }) => <span className="a-t2 text-[12.5px]" title={fmtDate(r.created_at, lang, 'datetime')}>{fmtRelative(r.created_at, lang)}</span> },
    { id: 'exp', header: t('adm.pros.inv.expires'), accessorFn: (r) => (r.expires_at ? new Date(r.expires_at).getTime() : 0), cell: ({ row: { original: r } }) => <span className="a-t3 a-num text-[12.5px]">{r.expires_at ? fmtDate(r.expires_at, lang) : '—'}</span> },
  ];
  return (
    <Section title={t('adm.pros.inv.listTitle')} description={t('adm.pros.inv.listSub')}
      actions={<label className="a-t2 inline-flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t('adm.pros.inv.showAll')}</label>}>
      <DataTable data={rows} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} searchable
        getRowId={(r) => `${r.source}:${r.id}`} initialSort={[{ id: 'at', desc: true }]} empty={{ title: t('adm.pros.inv.empty') }}
        onRowClick={onOpen} />
      {opened && <InviteDrawer key={openKey ?? ''} row={opened} onClose={close} />}
    </Section>
  );
}
