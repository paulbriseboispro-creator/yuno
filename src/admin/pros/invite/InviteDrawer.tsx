/**
 * Le tiroir d'une invitation de la liste unique (admin_pending_invitations).
 * Chaque porte garde ses gestes d'avant :
 *   - Yuno CRM (crm_offer_invites) : envoyer par e-mail (crm-invite-email) ou
 *     WhatsApp, prolonger, révoquer avec motif, ajouter un accès démo ;
 *   - organisateur / agence (platform_invitations) : relancer
 *     (invite-platform-user / invite-affiliate), révoquer, supprimer, copier ;
 *   - propriétaire de club (owner_invitations) : relancer (invite-owner), copier.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Mail, MessageCircle, RotateCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { invokeAdminAction, inviteErr, useAdminInvites, type CrmInvite, type InvitesData } from '@/crm/admin/inviteData';
import { crmInviteWhatsAppText, crmLang, inviteStage, whatsAppUrl, type InviteTone } from '@/crm/lib/crmInvites';
import { fmtDate, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { Badge, Dialog, Drawer, KeyValue, ReasonDialog, Section, Status, useAdminT } from '@/admin/ui';
import { accountHref } from '../accounts';
import { PROS_QK, type PendingInvite } from '../data';
import { invokeEdge } from '../demo/data';
import { Seg } from '../demo/fields';

const TONE_KEY = 'yuno.crm.admin.inviteTone';
/** Dernier ton choisi sur cet appareil ; le vouvoiement par défaut. */
function readTone(): InviteTone {
  try { return localStorage.getItem(TONE_KEY) === 'casual' ? 'casual' : 'formal'; } catch { return 'formal'; }
}

export const INVITE_TONE = { pending: 'warning', accepted: 'positive', expired: 'neutral', revoked: 'neutral' } as const;

export function InviteDrawer({ row, onClose }: { row: PendingInvite; onClose: () => void }) {
  const { t, lang } = useAdminT();
  const title = row.name ?? row.email ?? t('adm.pros.iv.untitled');
  return (
    <Drawer open onOpenChange={(v) => { if (!v) onClose(); }} title={title}
      description={<span className="inline-flex flex-wrap items-center gap-2"><Status tone={INVITE_TONE[row.state]}>{t(`adm.pros.inv.s.${row.state}`)}</Status><Badge tone={row.product === 'tickets' ? 'neutral' : 'accent'}>{t(`adm.pros.inv.p.${row.product}`)}</Badge></span>}>
      <div className="flex flex-col gap-6">
        {row.source === 'crm' ? <CrmPart id={row.id} /> : (
          <>
            <Section title={t('adm.pros.iv.details')}>
              <KeyValue items={[
                { label: t('adm.pros.col.type'), value: t(`adm.pros.type.${row.type}`) },
                { label: t('adm.pros.f.email'), value: row.email ?? '—' },
                { label: t('adm.pros.inv.sentAt'), value: fmtDate(row.created_at, lang, 'datetime') },
                { label: t('adm.pros.inv.expires'), value: row.expires_at ? fmtDate(row.expires_at, lang) : '—' },
              ]} />
            </Section>
            {row.source === 'platform' && <PlatformPart row={row} onClose={onClose} />}
            {row.source === 'owner' && <OwnerPart row={row} />}
          </>
        )}
        {row.account_key && row.state === 'accepted' && <Link className="a-btn self-start" to={accountHref(row.account_key)}>{t('adm.pros.inv.openCard')}</Link>}
      </div>
    </Drawer>
  );
}

function useInviteRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: [PROS_QK] }), qc.invalidateQueries({ queryKey: ['crm-admin'] })]);
}

// ── Yuno CRM ────────────────────────────────────────────────────────────────
function CrmPart({ id }: { id: string }) {
  const { t, lang } = useAdminT();
  const q = useAdminInvites();
  const x = q.data?.invites.find((i) => i.id === id) ?? null;
  if (q.isLoading) return <div className="a-skel h-40" />;
  if (!x || !q.data) return <p className="a-t3 text-[13px]">{t('adm.pros.iv.crmMissing')}</p>;
  const stage = inviteStage(x);
  const who = [x.contact_name, x.email, x.phone, x.city].filter(Boolean).join(' · ');
  return (
    <>
      <Section title={t('adm.pros.iv.details')}>
        <KeyValue items={[
          { label: t('adm.pros.iv.stage'), value: t(`adm.pros.iv.st.${stage}`) },
          { label: t('adm.pros.iv.offer'), value: t(x.offer === 'founder' ? 'adm.pros.inv.p.founder' : 'adm.pros.iv.offerStandard') },
          { label: t('adm.pros.col.type'), value: x.kind ? t(`adm.pros.type.${x.kind}`) : '—' },
          { label: t('adm.pros.iv.contact'), value: who || '—' },
          { label: t('adm.pros.iv.support'), value: x.support ? t(`adm.pros.iv.support.${x.support.status === 'active' ? 'active' : 'pending'}`) : x.support_offer ? t('adm.pros.iv.support.offered') : t('adm.pros.no') },
          { label: t('adm.pros.iv.demo'), value: x.demo ? t(`adm.pros.dl.st.${x.demo.status === 'locked' ? 'cut' : x.demo.status === 'revoked' ? 'cut' : x.demo.status}`) : t('adm.pros.no') },
          { label: t('adm.pros.inv.sentAt'), value: fmtDate(x.created_at, lang, 'datetime') },
          ...(x.emailed_at ? [{ label: t('adm.pros.dl.d.emailed'), value: fmtRelative(x.emailed_at, lang) }] : []),
          ...(x.opened_at ? [{ label: t('adm.pros.iv.opened'), value: fmtRelative(x.opened_at, lang) }] : []),
          { label: t('adm.pros.inv.expires'), value: fmtDate(x.expires_at, lang) },
          ...(x.account ? [
            { label: t('adm.pros.iv.until'), value: x.offer === 'founder' && x.account.offer_until ? fmtDate(x.account.offer_until, lang) : x.account.trial_ends_at ? fmtDate(x.account.trial_ends_at, lang) : '—' },
            { label: t('adm.pros.iv.balance'), value: fmtNum(x.account.yunits_balance, lang) },
            { label: t('adm.pros.iv.card'), value: t(x.account.has_stripe ? 'adm.pros.yes' : 'adm.pros.no') },
          ] : []),
          ...(x.revoked_reason ? [{ label: t('adm.pros.iv.revokedWhy'), value: x.revoked_reason }] : []),
          ...(x.note ? [{ label: t('adm.pros.ci.note'), value: x.note }] : []),
        ]} />
      </Section>
      {x.status === 'pending' && <CrmShare x={x} d={q.data} />}
      <CrmActions x={x} />
    </>
  );
}

function CrmShare({ x, d }: { x: CrmInvite; d: InvitesData }) {
  const { t } = useAdminT();
  const refresh = useInviteRefresh();
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState('');
  const [tone, setToneState] = useState<InviteTone>(readTone);
  const setTone = (v: InviteTone) => { setToneState(v); try { localStorage.setItem(TONE_KEY, v); } catch { /* stockage refusé */ } };
  const lang = crmLang(x.lang);
  const demoLive = x.demo && x.demo.password && (x.demo.status === 'ready' || x.demo.status === 'opened') ? { url: x.demo.url, password: x.demo.password } : null;
  const text = crmInviteWhatsAppText({
    lang, offer: x.offer, orgName: x.org_name, contactName: x.contact_name, url: x.url, freeMonths: x.free_months, yunits: x.yunits,
    priceMonth: d.price_month, trialDays: d.trial.days, trialYunits: d.trial.yunits, expiresAt: x.expires_at, supportOffer: x.support_offer, demo: demoLive, tone,
  });
  const mark = (ch: 'whatsapp' | 'copy') => void rpc('crm_admin_offer_invite_mark', { p_id: x.id, p_channel: ch }).then(() => refresh()).catch(() => undefined);
  const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); toast.success(t('adm.pros.inv.copied')); mark('copy'); } catch { toast.error(t('adm.pros.dl.copyFailed')); } };
  const sendEmail = async () => {
    setSending(true);
    const r = await invokeAdminAction<{ email?: string }>('crm-invite-email', { inviteId: x.id });
    setSending(false);
    if (!r.ok) { toast.error(inviteErr(t, r.code)); return; }
    toast.success(t('adm.pros.dl.emailSent', { email: r.data.email ?? x.email ?? '' }));
    void refresh();
  };
  const saveEmail = async () => {
    try { await rpc('crm_admin_offer_invite_update', { p_id: x.id, p_patch: { email } }); setEmail(''); void refresh(); }
    catch (e) { toast.error(inviteErr(t, e instanceof Error ? e.message : '')); }
  };
  return (
    <Section title={t('adm.pros.dl.d.send')} description={t('adm.pros.iv.sendSub')}>
      <div className="flex flex-col gap-3">
        {x.email ? (
          <button type="button" className="a-btn a-btn--primary self-start" disabled={sending} onClick={() => void sendEmail()}>
            <Mail className="h-4 w-4" />{sending ? t('adm.ui.working') : t(x.emailed_at ? 'adm.pros.dl.resendTo' : 'adm.pros.dl.sendTo', { email: x.email })}
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <input className="a-input min-w-[220px] flex-1" type="email" value={email} placeholder={t('adm.pros.dl.addEmail')} onChange={(e) => setEmail(e.target.value)} />
            <button type="button" className="a-btn" disabled={!email.trim()} onClick={() => void saveEmail()}>{t('adm.pros.dl.saveEmail')}</button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <a className="a-btn" href={whatsAppUrl(x.phone, text)} target="_blank" rel="noopener noreferrer" onClick={() => mark('whatsapp')}>
            <MessageCircle className="h-4 w-4" />{x.phone ? t('adm.pros.dl.waTo', { phone: x.phone }) : t('adm.pros.dl.wa')}
          </a>
          {lang !== 'en' && <Seg<InviteTone> label={t('adm.pros.iv.tone')} value={tone} onChange={setTone} options={[{ v: 'formal', label: t('adm.pros.iv.toneFormal') }, { v: 'casual', label: t('adm.pros.iv.toneCasual') }]} />}
        </div>
        <details className="a-t2 text-[12.5px]">
          <summary className="cursor-pointer">{t('adm.pros.dl.d.message')}</summary>
          <pre className="a-subtle a-t1 mt-2 max-h-[220px] overflow-y-auto whitespace-pre-wrap break-words rounded-lg p-3 font-[inherit] text-[12.5px]">{text}</pre>
          <button type="button" className="a-btn a-btn--sm mt-2" onClick={() => void copy(text)}><Copy className="h-3.5 w-3.5" />{t('adm.pros.iv.copyMsg')}</button>
        </details>
        <div className="flex min-w-0 items-center gap-2">
          <input className="a-input a-mono min-w-0 flex-1" readOnly value={x.url} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="a-btn a-btn--icon" aria-label={t('adm.pros.dl.copy')} onClick={() => void copy(x.url)}><Copy className="h-4 w-4" /></button>
        </div>
      </div>
    </Section>
  );
}

function CrmActions({ x }: { x: CrmInvite }) {
  const { t } = useAdminT();
  const refresh = useInviteRefresh();
  const [revoke, setRevoke] = useState(false);
  const canExtend = x.status === 'expired' || (x.status === 'pending' && new Date(x.expires_at).getTime() - Date.now() < 7 * 86_400_000);
  const demoLive = x.demo && (x.demo.status === 'ready' || x.demo.status === 'opened');
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); void refresh(); } catch (e) { toast.error(inviteErr(t, e instanceof Error ? e.message : '')); }
  };
  if (x.status !== 'pending' && !canExtend) return null;
  return (
    <div className="flex flex-wrap gap-2 border-t pt-4">
      {canExtend && <button type="button" className="a-btn" onClick={() => void run(() => rpc('crm_admin_invite_extend', { p_id: x.id }), t('adm.pros.iv.extended'))}><RotateCw className="h-4 w-4" />{t('adm.pros.iv.extend')}</button>}
      {x.status === 'pending' && !demoLive && <button type="button" className="a-btn" onClick={() => void run(() => rpc('crm_admin_demo_link_create', { p: { invite_id: x.id } }), t('adm.pros.iv.demoAdded'))}>{t('adm.pros.iv.demoAdd')}</button>}
      {x.demo && <Link className="a-btn" to={`/admin/pros/demo?open=${x.demo.id}`}>{t('adm.pros.iv.openDemo')}</Link>}
      <span className="flex-1" />
      {x.status === 'pending' && <button type="button" className="a-btn a-btn--danger" onClick={() => setRevoke(true)}>{t('adm.pros.iv.revoke')}</button>}
      <ReasonDialog open={revoke} onOpenChange={setRevoke} tone="danger" title={t('adm.pros.iv.revokeT', { name: x.org_name })}
        description={t(x.offer === 'founder' ? 'adm.pros.iv.revokeFounderB' : 'adm.pros.iv.revokeB')} confirmLabel={t('adm.pros.iv.revoke')}
        onConfirm={async (reason) => { await rpc('crm_admin_offer_invite_revoke', { p_id: x.id, p_reason: reason }); toast.success(t('adm.pros.iv.revoked')); void refresh(); }} />
    </div>
  );
}

// ── Organisateur, association, agence ───────────────────────────────────────
function PlatformPart({ row, onClose }: { row: PendingInvite; onClose: () => void }) {
  const { t } = useAdminT();
  const refresh = useInviteRefresh();
  const [confirm, setConfirm] = useState<null | 'revoke' | 'delete'>(null);
  const [token, setToken] = useState<string | null>(null);
  const agency = row.type === 'agency';
  useEffect(() => {
    if (!agency) return;
    void supabase.from('platform_invitations').select('token').eq('id', row.id).maybeSingle().then(({ data }) => setToken((data as { token?: string } | null)?.token ?? null));
  }, [agency, row.id]);
  const resend = async () => {
    if (!row.email || !row.name) return;
    try {
      if (agency) {
        const d = await invokeEdge<{ email_sent?: boolean; invite_link?: string }>('invite-affiliate', { email: row.email, name: row.name });
        if (d.email_sent === false && d.invite_link) toast.warning(t('adm.pros.iv.noEmailLink', { link: d.invite_link }));
        else toast.success(t('adm.pros.iv.resent', { email: row.email }));
      } else {
        await invokeEdge('invite-platform-user', { email: row.email, organization_name: row.name });
        toast.success(t('adm.pros.iv.resent', { email: row.email }));
      }
      void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('adm.ui.error.title')); }
  };
  const write = async (kind: 'revoke' | 'delete') => {
    const { error } = kind === 'revoke'
      ? await supabase.from('platform_invitations').update({ status: 'revoked' }).eq('id', row.id)
      : await supabase.from('platform_invitations').delete().eq('id', row.id);
    if (error) { toast.error(error.message); return; }
    toast.success(t(kind === 'revoke' ? 'adm.pros.iv.revoked' : 'adm.pros.iv.deleted'));
    setConfirm(null); void refresh();
    if (kind === 'delete') onClose();
  };
  return (
    <div className="flex flex-wrap gap-2 border-t pt-4">
      {row.state !== 'accepted' && row.name && <button type="button" className="a-btn" onClick={() => void resend()}><RotateCw className="h-4 w-4" />{t('adm.pros.iv.resend')}</button>}
      {agency && token && row.state === 'pending' && (
        <button type="button" className="a-btn" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/auth?invite_affiliate=${token}`).then(() => toast.success(t('adm.pros.inv.copied'))); }}>
          <Copy className="h-4 w-4" />{t('adm.pros.iv.copyLink')}
        </button>
      )}
      <span className="flex-1" />
      {row.state === 'pending' && <button type="button" className="a-btn" onClick={() => setConfirm('revoke')}>{t('adm.pros.iv.revoke')}</button>}
      {!agency && <button type="button" className="a-btn a-btn--danger" onClick={() => setConfirm('delete')}>{t('adm.pros.iv.delete')}</button>}
      <Dialog open={!!confirm} onOpenChange={(v) => { if (!v) setConfirm(null); }} tone="danger"
        title={t(confirm === 'delete' ? 'adm.pros.iv.deleteT' : 'adm.pros.iv.revokeT', { name: row.name ?? row.email ?? '' })}
        description={t(confirm === 'delete' ? 'adm.pros.iv.deleteB' : 'adm.pros.iv.revokePlatformB')}
        confirmLabel={t(confirm === 'delete' ? 'adm.pros.iv.delete' : 'adm.pros.iv.revoke')}
        onConfirm={() => { if (confirm) void write(confirm); }} />
    </div>
  );
}

// ── Propriétaire d'un club ──────────────────────────────────────────────────
function OwnerPart({ row }: { row: PendingInvite }) {
  const { t } = useAdminT();
  const refresh = useInviteRefresh();
  const [token, setToken] = useState<string | null>(null);
  const venueId = row.account_key?.startsWith('venue:') ? row.account_key.slice(6) : null;
  useEffect(() => {
    void supabase.from('owner_invitations').select('token').eq('id', row.id).maybeSingle().then(({ data }) => setToken((data as { token?: string } | null)?.token ?? null));
  }, [row.id]);
  if (row.state === 'accepted') return null;
  const resend = async () => {
    if (!row.email || !venueId) return;
    try {
      const d = await invokeEdge<{ user_exists?: boolean }>('invite-owner', { email: row.email, venue_id: venueId, venue_name: row.name ?? venueId });
      toast.success(t(d.user_exists ? 'adm.pros.inv.ownerAssigned' : 'adm.pros.iv.resent', { email: row.email }));
      void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : t('adm.ui.error.title')); }
  };
  return (
    <div className="flex flex-wrap gap-2 border-t pt-4">
      {venueId && row.email && <button type="button" className="a-btn" onClick={() => void resend()}><RotateCw className="h-4 w-4" />{t('adm.pros.iv.resend')}</button>}
      {token && (
        <button type="button" className="a-btn" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/auth?invite=${encodeURIComponent(token)}`).then(() => toast.success(t('adm.pros.inv.copied'))); }}>
          <Copy className="h-4 w-4" />{t('adm.pros.iv.copyLink')}
        </button>
      )}
    </div>
  );
}
