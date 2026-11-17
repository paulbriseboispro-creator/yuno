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
import { Badge, BulletBar, Checkbox, DataTable, Page, Section, Status, useAdminT, type ColumnDef } from '@/admin/ui';
import { useAdminInvites } from '@/crm/admin/inviteData';
import { fmtDate, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { Field } from '@/admin/ui';
import { accountHref, venueIdFromName, type AccountType } from './accounts';
import { useInvitations, useProsRefresh, type PendingInvite } from './data';
import { CrmInviteForm } from './invite/CrmInviteForm';
import { INVITE_TONE, InviteDrawer } from './invite/InviteDrawer';
import { Panel } from './v3';

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
      <div className="grid grid-cols-1 gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-col gap-4">
            <Choice<AccountType> label={t('adm.pros.inv.step1')} value={type} options={TYPES.map((v) => ({ v, label: t(`adm.pros.type.${v}`) }))}
              onChange={(v) => { setType(v); setProduct(v === 'agency' ? 'tickets' : null); }} />
            {type && (
              <Choice<Product> label={t('adm.pros.inv.step2')} value={product} options={products.map((v) => ({ v, label: t(`adm.pros.inv.p.${v}`) }))} onChange={setProduct} />
            )}
          </div>
          {!type && <p className="a-t3 border-y py-6 text-[13px]">{t('adm.pros.v3.inv.pick')}</p>}
          {type && product === 'tickets' && type === 'club' && <ClubForm />}
          {type && product === 'tickets' && (type === 'organizer' || type === 'association') && <OrganizerForm association={type === 'association'} />}
          {type === 'agency' && product === 'tickets' && <AgencyForm />}
          {type && type !== 'agency' && (product === 'crm' || product === 'founder') && (
            <CrmInviteForm key={`${type}:${product}`} kind={type === 'club' ? 'club' : 'organizer'} founder={product === 'founder'} onCreated={(id) => openInvite(`crm:${id}`)} />
          )}
        </div>
        <InviteRail onOpen={(r) => openInvite(`${r.source}:${r.id}`)} />
      </div>

      <InvitationsList onOpen={(r) => openInvite(`${r.source}:${r.id}`)} />
    </Page>
  );
}

/** À droite : les places de l'offre fondateurs et les invitations en cours, en direct. */
function InviteRail({ onOpen }: { onOpen: (r: PendingInvite) => void }) {
  const { t, lang } = useAdminT();
  const inv = useAdminInvites();
  const seats = inv.data?.seats;
  const q = useInvitations();
  const pending = (q.data ?? []).filter((r) => r.state === 'pending').sort((a, b) => b.created_at.localeCompare(a.created_at));
  const soon = pending.filter((r) => r.expires_at && new Date(r.expires_at).getTime() - Date.now() < 7 * 864e5).length;
  return (
    <aside className="flex min-w-0 flex-col gap-8 xl:sticky xl:top-[64px] xl:self-start xl:border-l xl:pl-8">
      <section className="flex flex-col gap-3">
        <h2 className="a-kicker">{t('adm.pros.v3.inv.seats')}</h2>
        {inv.isLoading ? <div className="a-skel h-10 w-full" /> : !seats ? <p className="a-t3 text-[13px]">{t('adm.pros.v3.inv.noSeats')}</p> : (
          <>
            <BulletBar value={seats.claimed} max={Math.max(1, seats.total)} zones={[seats.claimed, seats.claimed + seats.pending]}
              label={t('adm.pros.v3.inv.claimed')} display={`${fmtNum(seats.claimed, lang)} / ${fmtNum(seats.total, lang)}`} />
            <p className="a-t2 text-[12.5px]">{t('adm.pros.ci.seats', { claimed: seats.claimed, pending: seats.pending, left: seats.left })}</p>
          </>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2 border-b pb-2">
          <h2 className="a-t1 text-[14px] font-semibold">{t('adm.pros.v3.inv.pending')}</h2>
          <span className="a-mono a-t3 ml-auto text-[11px]">{fmtNum(pending.length, lang)}</span>
        </div>
        {soon > 0 && <p className="text-[12.5px]" style={{ color: 'var(--a-warn)' }}>{t(soon === 1 ? 'adm.pros.v3.inv.soonOne' : 'adm.pros.v3.inv.soon', { n: soon })}</p>}
        {q.isLoading ? <div className="a-skel h-24 w-full" /> : pending.length === 0 ? <p className="a-t3 text-[13px]">{t('adm.pros.inv.empty')}</p> : (
          <ol className="flex flex-col">
            {pending.slice(0, 8).map((r) => (
              <li key={`${r.source}:${r.id}`}>
                <button type="button" onClick={() => onOpen(r)} className="a-focus grid w-full grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 border-0 bg-transparent py-1.5 text-left font-[inherit] hover:bg-[var(--a-hover)]" style={{ cursor: 'pointer' }}>
                  <span className="a-mono a-t3 pt-[1px] text-[11px]">{fmtDate(r.created_at, lang)}</span>
                  <span className="min-w-0">
                    <span className="a-t1 block truncate text-[13px]">{r.name ?? r.email ?? '—'}</span>
                    <span className="a-mono a-t3 block truncate text-[10.5px] uppercase tracking-[0.04em]">{t(`adm.pros.type.${r.type}`)} · {t(`adm.pros.inv.p.${r.product}`)}{r.expires_at ? ` · ${t('adm.pros.v3.inv.expires', { when: fmtDate(r.expires_at, lang) })}` : ''}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
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
      <Panel>
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
      </Panel>
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
      <Panel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('adm.pros.inv.orgName')}><input className="a-input" value={org} onChange={(e) => setOrg(e.target.value)} /></Field>
          <Field label={t('adm.pros.f.email')}><input className="a-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
        <Checkbox checked={help} onChange={setHelp}>{t('adm.pros.inv.offerHelp')}</Checkbox>
        <div className="mt-4"><button type="button" className="a-btn a-btn--primary" disabled={busy} onClick={() => void submit()}>{t(busy ? 'adm.ui.working' : 'adm.pros.inv.send')}</button></div>
      </Panel>
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
      <Panel>
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
      </Panel>
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
    { id: 'product', header: t('adm.pros.col.products'), accessorKey: 'product', cell: ({ row: { original: r } }) => <Badge>{t(`adm.pros.inv.p.${r.product}`)}</Badge> },
    { id: 'state', header: t('adm.pros.col.status'), accessorKey: 'state', cell: ({ row: { original: r } }) => <Status tone={tone(r.state)}>{t(`adm.pros.inv.s.${r.state}`)}</Status> },
    { id: 'at', header: t('adm.pros.inv.sentAt'), accessorFn: (r) => new Date(r.created_at).getTime(), cell: ({ row: { original: r } }) => <span className="a-t2 text-[12.5px]" title={fmtDate(r.created_at, lang, 'datetime')}>{fmtRelative(r.created_at, lang)}</span> },
    { id: 'exp', header: t('adm.pros.inv.expires'), accessorFn: (r) => (r.expires_at ? new Date(r.expires_at).getTime() : 0), cell: ({ row: { original: r } }) => <span className="a-t3 a-num text-[12.5px]">{r.expires_at ? fmtDate(r.expires_at, lang) : '—'}</span> },
  ];
  return (
    <Section title={t('adm.pros.inv.listTitle')} description={t('adm.pros.inv.listSub')}
      actions={<Checkbox checked={all} onChange={setAll}>{t('adm.pros.inv.showAll')}</Checkbox>}>
      <DataTable data={rows} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} searchable
        getRowId={(r) => `${r.source}:${r.id}`} initialSort={[{ id: 'at', desc: true }]} empty={{ title: t('adm.pros.inv.empty') }}
        onRowClick={onOpen} />
      {opened && <InviteDrawer key={openKey ?? ''} row={opened} onClose={close} />}
    </Section>
  );
}
