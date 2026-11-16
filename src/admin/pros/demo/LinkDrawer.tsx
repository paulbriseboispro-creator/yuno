/**
 * Le tiroir d'un lien de démo : ce qu'il ouvre, où en est le prospect, et
 * les gestes (copier, envoyer par e-mail ou WhatsApp, modifier les accès, le
 * compte à créer, couper, supprimer). Mêmes appels qu'avant :
 *   - accès Yuno CRM : crm-demo-email (admin-account-recovery),
 *     crm_admin_demo_link_mark / _update / _revoke ;
 *   - lien Yuno Tickets : écriture directe de demo_preview_links (RLS super
 *     admin), admin_set_demo_link_signup.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy, Mail, MessageCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { rpc } from '@/crm/lib/rpc';
import { invokeAdminAction, inviteErr } from '@/crm/admin/inviteData';
import { crmDemoWhatsAppText, crmLang, whatsAppUrl } from '@/crm/lib/crmInvites';
import { DEMO_ACCOUNTS, ALL_TARGET_ACCOUNTS, type TargetAccount } from '@/lib/demoSession';
import { fmtDate, fmtNum, fmtRelative } from '@/lib/adminFormat';
import { Badge, Dialog, Drawer, KeyValue, Section, Status, useAdminT } from '@/admin/ui';
import { accountHref } from '../accounts';
import { signupStage, useDemoRefresh, type DemoRow } from './data';
import { AccountPicker, SignupFields } from './fields';
import { EMPTY_SIGNUP, draftFromSignup, signupPayload, type SignupDraft } from './signup';
import { STATE_TONE } from './state';

type Open = null | 'roles' | 'signup' | 'cut' | 'delete';

export function LinkDrawer({ row, onClose }: { row: DemoRow; onClose: () => void }) {
  const { t, lang } = useAdminT();
  const refresh = useDemoRefresh();
  const [open, setOpen] = useState<Open>(null);
  const live = row.state === 'ready' || row.state === 'opened';
  const managed = !!row.crm?.managed;
  const plain = !row.venue_id && !row.organizer_user_id;
  const close = (v: boolean) => { if (!v) setOpen(null); };
  const markCopy = () => { if (managed) void rpc('crm_admin_demo_link_mark', { p_id: row.id, p_channel: 'copy' }).catch(() => undefined); };
  const copy = async (value: string, msg: string) => {
    try { await navigator.clipboard.writeText(value); toast.success(msg); markCopy(); } catch { toast.error(t('adm.pros.dl.copyFailed')); }
  };

  const roles = row.showcase
    ? t(row.venue_id ? 'adm.pros.dl.showcaseClub' : 'adm.pros.dl.showcaseOrg', { name: row.showcase })
    : row.targets.map((a) => DEMO_ACCOUNTS[a]?.label ?? a).join(', ');
  const su = row.signup;

  return (
    <Drawer open onOpenChange={(v) => { if (!v) onClose(); }} title={row.label}
      description={<span className="inline-flex flex-wrap items-center gap-2"><Status tone={STATE_TONE[row.state]}>{t(`adm.pros.dl.st.${row.state}`)}</Status>{row.products.map((p) => <Badge key={p} tone={p === 'crm' ? 'accent' : 'neutral'}>{t(`adm.pros.product.${p}`)}</Badge>)}</span>}>
      <div className="flex flex-col gap-6">
        <Section title={t('adm.pros.dl.d.link')}>
          <div className="flex flex-col gap-2">
            <CopyLine label={t('adm.pros.dl.d.url')} value={row.url} onCopy={() => void copy(row.url, t('adm.pros.dl.linkCopied'))} />
            {row.password && <CopyLine label={t('adm.pros.dl.d.password')} value={row.password} onCopy={() => void copy(row.password as string, t('adm.pros.dl.passwordCopied'))} />}
            {!row.password && <p className="a-t3 text-[12px]">{t('adm.pros.dl.d.passwordHidden')}</p>}
          </div>
        </Section>

        {live && <ShareBlock row={row} />}

        <Section title={t('adm.pros.dl.d.details')}>
          <KeyValue items={[
            { label: t('adm.pros.dl.col.roles'), value: roles || '—' },
            { label: t('adm.pros.dl.col.lang'), value: row.language.toUpperCase() },
            ...(row.crm ? [{ label: t('adm.pros.dl.d.contact'), value: [row.crm.contact_name, row.crm.email, row.crm.phone].filter(Boolean).join(' · ') || '—' }] : []),
            ...(row.crm?.invite ? [{ label: t('adm.pros.dl.d.invite'), value: `${row.crm.invite.org_name}${row.crm.invite.offer === 'founder' ? ` · ${t('adm.pros.inv.p.founder')}` : ''}` }] : []),
            { label: t('adm.pros.dl.col.opens'), value: row.used_count ? t('adm.pros.dl.opensLast', { n: fmtNum(row.used_count, lang), ago: fmtRelative(row.last_used_at, lang) }) : t('adm.pros.dl.neverOpened') },
            { label: t('adm.pros.dl.d.created'), value: fmtDate(row.created_at, lang, 'datetime') },
            { label: t('adm.pros.dl.col.expires'), value: row.expires_at ? fmtDate(row.expires_at, lang) : t('adm.pros.dl.noExpiry') },
            ...(row.crm?.emailed_at ? [{ label: t('adm.pros.dl.d.emailed'), value: fmtRelative(row.crm.emailed_at, lang) }] : []),
            ...(row.crm?.shared_at ? [{ label: t('adm.pros.dl.d.shared'), value: fmtRelative(row.crm.shared_at, lang) }] : []),
          ]} />
        </Section>

        {plain && !row.products.includes('crm') && (
          <Section title={t('adm.pros.dl.d.signup')} description={t('adm.pros.dl.d.signupSub')}
            actions={<button type="button" className="a-btn a-btn--sm" onClick={() => setOpen('signup')}>{t(su ? 'adm.pros.dl.d.signupEdit' : 'adm.pros.dl.d.signupAdd')}</button>}>
            {su ? (
              <KeyValue items={[
                { label: t('adm.pros.dl.d.stage'), value: <Status tone={signupStage(su) === 'created' ? 'positive' : 'warning'}>{t(`adm.pros.dl.su.${signupStage(su)}`)}</Status> },
                { label: t('adm.demo.signup.kind'), value: t(`adm.demo.signup.${su.kind}`) },
                { label: t('adm.pros.dl.d.org'), value: su.org_name ?? '—' },
                { label: t('adm.pros.dl.d.contact'), value: [[su.first_name, su.last_name].filter(Boolean).join(' '), su.email, su.phone].filter(Boolean).join(' · ') || '—' },
                ...(su.user_id && su.account_created_at ? [{ label: t('adm.pros.dl.d.accountAt'), value: fmtDate(su.account_created_at, lang, 'datetime') }] : []),
              ]} />
            ) : <p className="a-t3 text-[12.5px]">{t('adm.pros.dl.d.noSignup')}</p>}
          </Section>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          {plain && !managed && <button type="button" className="a-btn" onClick={() => setOpen('roles')}>{t('adm.pros.dl.editRoles')}</button>}
          {row.crm?.invite?.id && <Link className="a-btn" to={`/admin/pros/invite?open=crm:${row.crm.invite.id}`}>{t('adm.pros.dl.openInvite')}</Link>}
          {su?.user_id && su.kind !== 'club' && <Link className="a-btn" to={accountHref(`org:${su.user_id}`)}>{t('adm.pros.dl.openAccount')}</Link>}
          <span className="flex-1" />
          {live && <button type="button" className="a-btn" onClick={() => setOpen('cut')}>{t('adm.pros.dl.cut')}</button>}
          {!managed && <button type="button" className="a-btn a-btn--danger" onClick={() => setOpen('delete')}>{t('adm.pros.dl.delete')}</button>}
        </div>
      </div>

      {open === 'roles' && <RolesDialog row={row} onClose={() => setOpen(null)} />}
      {open === 'signup' && <SignupDialog row={row} onClose={() => setOpen(null)} />}
      <Dialog open={open === 'cut'} onOpenChange={close} title={t('adm.pros.dl.cutT', { name: row.label })} description={t('adm.pros.dl.cutB')} tone="danger" confirmLabel={t('adm.pros.dl.cut')}
        onConfirm={() => void (async () => {
          try {
            if (managed) await rpc('crm_admin_demo_link_revoke', { p_id: row.id });
            else {
              const { error } = await supabase.from('demo_preview_links').update({ is_active: false, revoked_at: new Date().toISOString() }).eq('id', row.id);
              if (error) throw error;
            }
            toast.success(t('adm.pros.dl.cutDone')); setOpen(null); await refresh();
          } catch (e) { toast.error(e instanceof Error ? e.message : t('adm.ui.error.title')); }
        })()} />
      <Dialog open={open === 'delete'} onOpenChange={close} title={t('adm.pros.dl.deleteT', { name: row.label })} description={t('adm.pros.dl.deleteB')} tone="danger" confirmLabel={t('adm.pros.dl.delete')}
        onConfirm={() => void (async () => {
          const { error } = await supabase.from('demo_preview_links').delete().eq('id', row.id);
          if (error) { toast.error(error.message); return; }
          toast.success(t('adm.pros.dl.deleted')); setOpen(null); onClose(); await refresh();
        })()} />
    </Drawer>
  );
}

function CopyLine({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  const { t } = useAdminT();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="a-t2 w-[96px] flex-none text-[12.5px]">{label}</span>
      <input className="a-input a-mono min-w-0 flex-1" readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="a-btn a-btn--icon" aria-label={t('adm.pros.dl.copy')} title={t('adm.pros.dl.copy')} onClick={onCopy}><Copy className="h-4 w-4" /></button>
    </div>
  );
}

/** Envoyer : e-mail et WhatsApp. Un accès Yuno CRM a son e-mail et son message ; un lien Tickets part par WhatsApp ou par votre messagerie. */
function ShareBlock({ row }: { row: DemoRow }) {
  const { t } = useAdminT();
  const refresh = useDemoRefresh();
  const [sending, setSending] = useState(false);
  const [email, setEmail] = useState('');
  const x = row.crm;
  if (x?.managed) {
    const text = crmDemoWhatsAppText({ lang: crmLang(x.lang), contactName: x.contact_name, url: x.url, password: x.password ?? '', expiresAt: x.expires_at ?? new Date().toISOString() });
    const sendEmail = async () => {
      setSending(true);
      const r = await invokeAdminAction<{ email?: string }>('crm-demo-email', { linkId: x.id });
      setSending(false);
      if (!r.ok) { toast.error(inviteErr(t, r.code)); return; }
      toast.success(t('adm.pros.dl.emailSent', { email: r.data.email ?? x.email ?? '' }));
      void refresh();
    };
    const saveEmail = async () => {
      try { await rpc('crm_admin_demo_link_update', { p_id: x.id, p_patch: { email } }); setEmail(''); void refresh(); }
      catch (e) { toast.error(inviteErr(t, e instanceof Error ? e.message : '')); }
    };
    return (
      <Section title={t('adm.pros.dl.d.send')} description={t('adm.pros.dl.d.sendSub')}>
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
          <a className="a-btn self-start" href={whatsAppUrl(x.phone, text)} target="_blank" rel="noopener noreferrer"
            onClick={() => void rpc('crm_admin_demo_link_mark', { p_id: x.id, p_channel: 'whatsapp' }).then(() => refresh()).catch(() => undefined)}>
            <MessageCircle className="h-4 w-4" />{x.phone ? t('adm.pros.dl.waTo', { phone: x.phone }) : t('adm.pros.dl.wa')}
          </a>
          <details className="a-t2 text-[12.5px]">
            <summary className="cursor-pointer">{t('adm.pros.dl.d.message')}</summary>
            <pre className="a-subtle a-t1 mt-2 max-h-[200px] overflow-y-auto whitespace-pre-wrap break-words rounded-lg p-3 font-[inherit] text-[12.5px]">{text}</pre>
          </details>
          <p className="a-t3 text-[12px]">{t('adm.pros.dl.selfWarn')}</p>
        </div>
      </Section>
    );
  }
  const text = t('adm.pros.dl.tixMessage', { url: row.url });
  return (
    <Section title={t('adm.pros.dl.d.send')} description={t('adm.pros.dl.d.sendTixSub')}>
      <div className="flex flex-wrap gap-2">
        <a className="a-btn" href={whatsAppUrl(null, text)} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" />{t('adm.pros.dl.wa')}</a>
        <a className="a-btn" href={`mailto:?subject=${encodeURIComponent(t('adm.pros.dl.tixSubject'))}&body=${encodeURIComponent(text)}`}><Mail className="h-4 w-4" />{t('adm.pros.dl.mail')}</a>
      </div>
    </Section>
  );
}

function RolesDialog({ row, onClose }: { row: DemoRow; onClose: () => void }) {
  const { t } = useAdminT();
  const refresh = useDemoRefresh();
  const [sel, setSel] = useState<TargetAccount[]>(row.targets);
  const [busy, setBusy] = useState(false);
  // On garde target_account (« rôle principal », lu par le redeem) en phase avec le premier de la liste.
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from('demo_preview_links').update({ target_accounts: sel, target_account: sel[0] }).eq('id', row.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('adm.pros.dl.rolesSaved')); onClose(); void refresh();
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }} title={t('adm.pros.dl.rolesT', { name: row.label })} description={t('adm.pros.dl.rolesB')}
      confirmLabel={t('adm.pros.g.save')} busy={busy} onConfirm={() => { if (sel.length) void save(); else toast.error(t('adm.pros.dl.missingRoles')); }}>
      <AccountPicker options={ALL_TARGET_ACCOUNTS} selected={sel} onToggle={(a) => setSel((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]))} />
    </Dialog>
  );
}

function SignupDialog({ row, onClose }: { row: DemoRow; onClose: () => void }) {
  const { t } = useAdminT();
  const refresh = useDemoRefresh();
  const locked = !!row.signup?.user_id;
  const [draft, setDraft] = useState<SignupDraft>(row.signup ? draftFromSignup(row.signup) : { ...EMPTY_SIGNUP, enabled: true, firstName: row.label });
  const [busy, setBusy] = useState(false);
  const save = async (remove: boolean) => {
    if (!remove && !draft.orgName.trim()) { toast.error(t('adm.demo.signup.orgRequired')); return; }
    setBusy(true);
    const { error } = await supabase.rpc('admin_set_demo_link_signup' as never, { p_link_id: row.id, p_data: remove ? null : signupPayload(draft) } as never);
    setBusy(false);
    if (error) { toast.error(t('adm.demo.signup.failed', { error: error.message })); return; }
    toast.success(t(remove ? 'adm.demo.signup.removed' : 'adm.demo.signup.saved')); onClose(); void refresh();
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }} title={t('adm.pros.dl.signupT', { name: row.label })}
      description={locked ? t('adm.demo.signup.createdLocked') : t('adm.pros.dl.signupB')}
      confirmLabel={t('adm.pros.g.save')} busy={busy} onConfirm={locked ? undefined : () => void save(false)}>
      {!locked && (
        <div className="flex flex-col gap-4 pb-1">
          <SignupFields draft={draft} onChange={setDraft} />
          {row.signup && <button type="button" className="a-btn a-btn--ghost self-start" style={{ color: 'var(--a-neg)' }} disabled={busy} onClick={() => void save(true)}>{t('adm.demo.signup.remove')}</button>}
        </div>
      )}
    </Dialog>
  );
}
