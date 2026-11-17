/**
 * Onglet « Vitrines » de Pros › Démo : les comptes fantômes que Yuno construit
 * pour un prospect (club ou organisateur caché), et les demandes d'activation
 * (« Activer mon compte » cliqué dans une vitrine). Mêmes appels qu'avant :
 *   - admin-account-recovery : create-showcase-owner (club),
 *     create-showcase-organizer (organisateur) → lien builder ;
 *   - invite-owner / invite-platform-user (+ showcase_shadow_user_id) pour
 *     transférer la vitrine ; showcase_claim_requests passée à « cancelled ».
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { fmtDate, fmtRelative } from '@/lib/adminFormat';
import { DataTable, Dialog, Section, useAdminT, type ColumnDef } from '@/admin/ui';
import { Field } from '../gestures';
import { accountHref } from '../accounts';
import { invokeEdge, useDemoRefresh, type ClaimRequest, type DemoPayload } from './data';
import { Check } from './fields';

/** Les messages d'erreur connus de l'edge, en phrases. */
function showcaseError(t: (k: string) => string, msg: string): string {
  if (msg.includes('venue_already_owned')) return t('adm.pros.sc.err.owned');
  if (msg.includes('email_already_used')) return t('adm.pros.sc.err.emailUsed');
  if (msg.includes('womber_email_forbidden')) return t('adm.pros.sc.err.womber');
  return msg || t('adm.ui.error.title');
}

interface ShowcaseRow { key: string; kind: 'club' | 'organizer'; id: string; name: string; email: string | null }

export function Showcases({ d, loading, error, onRetry }: { d: DemoPayload | undefined; loading: boolean; error: unknown; onRetry: () => void }) {
  const { t, lang } = useAdminT();
  const refresh = useDemoRefresh();
  const [invite, setInvite] = useState<ClaimRequest | null>(null);
  const [dismiss, setDismiss] = useState<ClaimRequest | null>(null);
  const [builder, setBuilder] = useState<ShowcaseRow | null>(null);
  const [newOrg, setNewOrg] = useState(false);
  const orgName = new Map((d?.showcaseOrgs ?? []).map((o) => [o.user_id, o.display_name]));
  const claimName = (c: ClaimRequest) => (c.venue_id ? (c.venues?.name ?? c.venue_id) : orgName.get(c.organizer_user_id ?? '') ?? t('adm.pros.type.organizer'));

  const claimCols: ColumnDef<ClaimRequest, unknown>[] = [
    {
      id: 'who', header: t('adm.pros.sc.col.showcase'), accessorFn: (c) => `${claimName(c)} ${c.requested_email}`,
      cell: ({ row: { original: c } }) => (
        <div className="min-w-0">
          <div className="a-t1 truncate font-medium">{claimName(c)}</div>
          <div className="a-t3 truncate text-[12px]">{t(c.venue_id ? 'adm.pros.type.club' : 'adm.pros.type.organizer')}</div>
        </div>
      ),
    },
    { id: 'email', header: t('adm.pros.sc.col.email'), accessorKey: 'requested_email' },
    { id: 'at', header: t('adm.pros.sc.col.at'), accessorFn: (c) => new Date(c.updated_at ?? c.created_at).getTime(), cell: ({ row: { original: c } }) => <span className="a-t2 text-[12.5px]" title={fmtDate(c.updated_at ?? c.created_at, lang, 'datetime')}>{fmtRelative(c.updated_at ?? c.created_at, lang)}</span> },
    {
      id: 'act', header: '', enableSorting: false, meta: { align: 'right' },
      cell: ({ row: { original: c } }) => (
        <div className="flex justify-end gap-1">
          <button type="button" className="a-btn a-btn--sm a-btn--primary" onClick={() => setInvite(c)}>{t('adm.pros.sc.invite')}</button>
          <button type="button" className="a-btn a-btn--sm" onClick={() => setDismiss(c)}>{t('adm.pros.sc.dismiss')}</button>
        </div>
      ),
    },
  ];

  const showcases: ShowcaseRow[] = [
    ...(d?.showcaseVenues ?? []).map((v) => ({ key: `venue:${v.id}`, kind: 'club' as const, id: v.id, name: v.name, email: v.owner_email })),
    ...(d?.showcaseOrgs ?? []).map((o) => ({ key: `org:${o.user_id}`, kind: 'organizer' as const, id: o.user_id, name: o.display_name, email: null })),
  ];
  const scCols: ColumnDef<ShowcaseRow, unknown>[] = [
    { id: 'name', header: t('adm.pros.sc.col.showcase'), accessorKey: 'name', cell: ({ row: { original: r } }) => <Link className="a-t1 font-medium hover:underline" to={accountHref(r.key)}>{r.name}</Link> },
    { id: 'kind', header: t('adm.pros.col.type'), accessorKey: 'kind', cell: ({ row: { original: r } }) => t(`adm.pros.type.${r.kind}`) },
    {
      id: 'act', header: '', enableSorting: false, meta: { align: 'right' },
      cell: ({ row: { original: r } }) => r.kind === 'club'
        ? <button type="button" className="a-btn a-btn--sm" onClick={() => setBuilder(r)}>{t('adm.pros.sc.builder')}</button>
        : <span className="a-t3 text-[12px]">{t('adm.pros.sc.orgBuilderOnce')}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Section title={t('adm.pros.sc.claims')} description={t('adm.pros.sc.claimsSub')}>
        <DataTable data={d?.claims} columns={claimCols} loading={loading} error={error} onRetry={onRetry} getRowId={(c) => c.id}
          initialSort={[{ id: 'at', desc: true }]} empty={{ title: t('adm.pros.sc.claimsEmpty') }} />
      </Section>
      <Section title={t('adm.pros.sc.list')} description={t('adm.pros.sc.listSub')}
        actions={<button type="button" className="a-btn" onClick={() => setNewOrg(true)}><Plus className="h-4 w-4" />{t('adm.pros.sc.newOrg')}</button>}>
        <DataTable data={showcases} columns={scCols} loading={loading} error={error} onRetry={onRetry} getRowId={(r) => r.key} searchable
          empty={{ title: t('adm.pros.sc.empty'), body: t('adm.pros.sc.emptyBody') }} />
      </Section>

      {invite && <ClaimInviteDialog claim={invite} name={claimName(invite)} onClose={() => setInvite(null)} />}
      <Dialog open={!!dismiss} onOpenChange={(v) => { if (!v) setDismiss(null); }} title={t('adm.pros.sc.dismissT')} description={t('adm.pros.sc.dismissB')} confirmLabel={t('adm.pros.sc.dismiss')}
        onConfirm={() => void (async () => {
          if (!dismiss) return;
          const { error: e } = await supabase.from('showcase_claim_requests').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', dismiss.id);
          if (e) { toast.error(e.message); return; }
          toast.success(t('adm.pros.sc.dismissed')); setDismiss(null); void refresh();
        })()} />
      {builder && <BuilderLinkDialog row={builder} onClose={() => setBuilder(null)} />}
      {newOrg && <NewShowcaseOrgDialog onClose={() => setNewOrg(false)} />}
    </div>
  );
}

/** Inviter le prospect qui a demandé l'activation : le compte existant reprend la vitrine tout de suite. */
function ClaimInviteDialog({ claim, name, onClose }: { claim: ClaimRequest; name: string; onClose: () => void }) {
  const { t } = useAdminT();
  const refresh = useDemoRefresh();
  const [email, setEmail] = useState(claim.requested_email);
  const [help, setHelp] = useState(true);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const d = claim.venue_id
        ? await invokeEdge<{ user_exists?: boolean }>('invite-owner', { email: email.trim(), venue_id: claim.venue_id, venue_name: name, offer_support_help: help })
        : await invokeEdge<{ user_exists?: boolean }>('invite-platform-user', { email: email.trim(), organization_name: name, offer_support_help: help, showcase_shadow_user_id: claim.organizer_user_id });
      toast.success(d.user_exists ? t('adm.pros.sc.transferred') : t('adm.pros.inv.sent', { email: email.trim() }));
      onClose(); void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('adm.ui.error.title')); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }} title={t('adm.pros.sc.inviteT', { name })} description={t('adm.pros.sc.inviteB')}
      confirmLabel={t('adm.pros.inv.send')} busy={busy} onConfirm={() => { if (email.trim()) void send(); else toast.error(t('adm.pros.g.editMissing')); }}>
      <div className="flex flex-col gap-3 pb-1">
        <Field label={t('adm.pros.f.email')}><input className="a-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Check checked={help} onChange={setHelp}>{t('adm.pros.inv.offerHelp')}</Check>
      </div>
    </Dialog>
  );
}

/** Le lien builder d'un club vitrine : à ouvrir en fenêtre privée pour construire sa page. */
export function BuilderLinkDialog({ row, onClose }: { row: { id: string; name: string; email: string | null }; onClose: () => void }) {
  const { t } = useAdminT();
  const refresh = useDemoRefresh();
  // Le fantôme existe : son e-mail ; sinon la convention vitrine+<id>@yunoapp.eu (jamais @womber.fr).
  const [email, setEmail] = useState(row.email ?? `vitrine+${row.id}@yunoapp.eu`);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const d = await invokeEdge<{ action_link?: string }>('admin-account-recovery', { action: 'create-showcase-owner', venueId: row.id, email: email.trim() });
      setLink(d.action_link ?? ''); toast.success(t('adm.pros.sc.ready')); void refresh();
    } catch (e) { toast.error(showcaseError(t, e instanceof Error ? e.message : '')); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }} title={t('adm.pros.sc.builderT', { name: row.name })} description={t('adm.pros.sc.builderB')}
      confirmLabel={link ? undefined : t('adm.pros.sc.builderCreate')} cancelLabel={link ? t('adm.ui.close') : undefined} busy={busy} onConfirm={link ? undefined : () => { if (email.trim()) void create(); else toast.error(t('adm.pros.g.editMissing')); }}>
      <div className="flex flex-col gap-3 pb-1">
        {link ? <LinkOut url={link} /> : <Field label={t('adm.pros.sc.shadowEmail')} hint={t('adm.pros.sc.shadowEmailHint')}><input className="a-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>}
      </div>
    </Dialog>
  );
}

function NewShowcaseOrgDialog({ onClose }: { onClose: () => void }) {
  const { t } = useAdminT();
  const refresh = useDemoRefresh();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const d = await invokeEdge<{ action_link?: string }>('admin-account-recovery', { action: 'create-showcase-organizer', name: name.trim(), email: email.trim() });
      setLink(d.action_link ?? ''); toast.success(t('adm.pros.sc.ready')); void refresh();
    } catch (e) { toast.error(showcaseError(t, e instanceof Error ? e.message : '')); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }} title={t('adm.pros.sc.newOrg')} description={t('adm.pros.sc.newOrgB')}
      confirmLabel={link ? undefined : t('adm.pros.sc.builderCreate')} cancelLabel={link ? t('adm.ui.close') : undefined} busy={busy} onConfirm={link ? undefined : () => { if (name.trim() && email.trim()) void create(); else toast.error(t('adm.pros.g.editMissing')); }}>
      <div className="flex flex-col gap-3 pb-1">
        {link ? <LinkOut url={link} /> : (
          <>
            <Field label={t('adm.pros.inv.orgName')}><input className="a-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={t('adm.pros.sc.shadowEmail')} hint={t('adm.pros.sc.shadowEmailHint')}><input className="a-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

function LinkOut({ url }: { url: string }) {
  const { t } = useAdminT();
  return (
    <div className="flex flex-col gap-2">
      <p className="a-t2 text-[13px]">{t('adm.pros.sc.builderReady')}</p>
      <div className="flex gap-2">
        <input className="a-input a-mono min-w-0 flex-1" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="a-btn a-btn--icon" aria-label={t('adm.pros.dl.copy')}
          onClick={() => { void navigator.clipboard?.writeText(url).then(() => toast.success(t('adm.pros.dl.linkCopied'))); }}><Copy className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
