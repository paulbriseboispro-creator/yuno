/**
 * Gestes admin d'un compte CRM (Yunits offerts, essai prolongé, gel d'envoi),
 * tous avec un motif et écrits au journal ; et la demande d'accès assisté
 * (« Voir sa Console ») : jamais une session sans le consentement du pro.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { setSupportSession } from '@/lib/supportSession';
import { useCrmT } from '@/crm/i18n';
import type { AdminAccount } from '@/crm/lib/admin';
import { Modal } from '@/crm/ui/kit';
import { useCrmToast } from '@/crm/ui/toast';
import { Hv } from '@/crm/ui/Hv';
import { useAdminGesture } from './data';

export type Gesture = null | 'grant' | 'extend' | 'freeze' | 'unfreeze';
const h2 = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-.03em' } as const;

export function GestureDialog({ gesture, account, ext, onClose }: { gesture: Gesture; account: AdminAccount; ext?: { used: number; free: number }; onClose: () => void }) {
  const { t, n, dShort } = useCrmT();
  const toast = useCrmToast();
  const id = account.id;
  const grant = useAdminGesture<{ p_scope_key: string; p_amount: number; p_reason: string }>('crm_admin_grant_yunits');
  const extend = useAdminGesture<{ p_scope_key: string; p_days: number; p_reason: string }>('crm_admin_extend_trial');
  const freeze = useAdminGesture<{ p_scope_key: string; p_frozen: boolean; p_reason: string }>('crm_admin_freeze');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(2000);
  const [days, setDays] = useState(7);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setReason(''); setErr(null); }, [gesture]);
  if (!gesture) return null;
  const busy = grant.isPending || extend.isPending || freeze.isPending;
  const ok = reason.trim().length >= 3;
  const fail = (e: unknown) => {
    const code = (e as { message?: string } | null)?.message ?? '';
    const known = ['reason_required', 'bad_amount', 'bad_days', 'not_extendable', 'not_found'].includes(code);
    setErr(t(`adm.crm.ac.err.${known ? code : 'x'}`));
  };
  const submit = () => {
    if (!ok || busy) return;
    const done = (msg: string) => () => { toast(msg); onClose(); };
    if (gesture === 'grant') grant.mutate({ p_scope_key: id, p_amount: amount, p_reason: reason }, { onSuccess: done(t('adm.crm.ac.doneGrant', { n: n(amount) })), onError: fail });
    else if (gesture === 'extend') extend.mutate({ p_scope_key: id, p_days: days, p_reason: reason }, { onSuccess: done(t('adm.crm.ac.doneExtend', { n: days })), onError: fail });
    else freeze.mutate({ p_scope_key: id, p_frozen: gesture === 'freeze', p_reason: reason }, { onSuccess: done(t(gesture === 'freeze' ? 'adm.crm.ac.doneFreeze' : 'adm.crm.ac.doneUnfreeze')), onError: fail });
  };
  const title = { grant: 'adm.crm.ac.grant', extend: 'adm.crm.ac.extend', freeze: 'adm.crm.ac.freeze', unfreeze: 'adm.crm.ac.unfreeze' }[gesture];
  const input = { height: 44, borderRadius: 12, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: '0 14px', font: 'inherit', fontSize: 15, outline: 'none', width: '100%', boxSizing: 'border-box' } as const;
  return (
    <Modal open onClose={onClose} width={500} label={t(title)}>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ ...h2, fontSize: 24 }}>{t(title)} · {account.name}</h2>
        {gesture === 'grant' && <label style={lbl}>{t('adm.crm.ac.amount')}<input type="number" min={1} max={100000} step={500} value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} style={input} /></label>}
        {gesture === 'extend' && <label style={lbl}>{t('adm.crm.ac.days')}<input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value))))} style={input} /></label>}
        {gesture === 'freeze' && <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-600)', lineHeight: 1.5 }}>{t('adm.crm.ac.freezeBody')}</p>}
        {gesture === 'extend' && ext && <p style={{ margin: 0, fontSize: 13.5, color: ext.used >= ext.free ? 'var(--amber-700)' : 'var(--sand-500)' }}>{t(ext.used >= ext.free ? 'adm.crm.ac.extBeyond' : 'adm.crm.ac.extCount', { used: ext.used, free: ext.free })}</p>}
        {gesture === 'extend' && account.trial_ends_at && <p style={{ margin: 0, fontSize: 13.5, color: 'var(--sand-500)' }}>{t('adm.crm.ac.trialEnds', { date: dShort(account.trial_ends_at) })}</p>}
        <label style={lbl}>{t('adm.crm.ac.reason')}<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} style={{ ...input, height: 'auto', padding: 12, resize: 'vertical' }} /></label>
        {err && <span role="alert" style={{ fontSize: 13.5, color: 'var(--red-600)' }}>{err}</span>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Hv as="button" type="button" onClick={onClose} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
          <Hv as="button" type="button" onClick={submit} disabled={!ok || busy} style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: gesture === 'freeze' ? 'var(--red-600)' : 'var(--ink)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: ok && !busy ? 'pointer' : 'default', opacity: ok && !busy ? 1 : 0.45 }}>{t('adm.crm.ac.confirm')}</Hv>
        </div>
      </div>
    </Modal>
  );
}
const lbl = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, fontWeight: 600 } as const;

// ── Accès assisté (« Voir sa Console ») ────────────────────────────────────
interface Grant { id: string; status: 'pending' | 'active' | 'revoked'; expires_at: string | null; revoked_at: string | null }

/** Dernier accord d'accès assisté encore ouvert pour ce titulaire. */
export function useSupportGrant(ownerId: string | null | undefined) {
  return useQuery({
    queryKey: ['crm-admin', 'support-grant', ownerId],
    enabled: !!ownerId,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('admin_support_grants')
        .select('id, status, expires_at, revoked_at').eq('target_user_id', ownerId as string)
        .in('status', ['pending', 'active']).is('revoked_at', null).order('created_at', { ascending: false }).limit(1);
      if (error) throw error;
      const g = (data?.[0] ?? null) as Grant | null;
      return g && (!g.expires_at || new Date(g.expires_at) > new Date()) ? g : null;
    },
  });
}

/**
 * Le bouton « Voir sa Console » : accord actif → ouvre la session (confirmation,
 * puis rechargement sur /crm) ; sinon → envoie la demande de consentement au pro
 * (motif obligatoire). Rien ne s'ouvre sans accord accepté.
 */
export function SupportConsoleButton({ ownerId, name, style, hover }: { ownerId: string | null | undefined; name: string; style: React.CSSProperties; hover: React.CSSProperties }) {
  const { t } = useCrmT();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const g = useSupportGrant(ownerId);
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!ownerId) return null;
  const grant = g.data;
  const label = grant?.status === 'active' ? t('adm.crm.sup.open') : grant?.status === 'pending' ? t('adm.crm.sup.pending') : t('adm.crm.sup.ask');

  const open = async () => {
    if (!grant || busy) return;
    if (!window.confirm(t('adm.crm.sup.confirm', { name }))) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-account-recovery', { body: { action: 'open-support-session', grantId: grant.id } });
      if (error) throw error;
      if (!data?.access_token || !data?.refresh_token) throw new Error(data?.error || 'open_failed');
      setSupportSession({ sessionId: data.session_id, targetUserId: data.target_user_id, targetName: data.target_name || name, expiresAt: data.expires_at });
      const { error: e2 } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      if (e2) throw e2;
      window.location.href = '/crm';
    } catch {
      toast(t('adm.crm.sup.openFailed'));
      setBusy(false);
    }
  };
  const request = async () => {
    if (busy || reason.trim().length < 3) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('admin-account-recovery', { body: { action: 'request-support-access', userId: ownerId, reason: reason.trim() } });
    setBusy(false);
    if (error || (data as { error?: string } | null)?.error) { toast(t('adm.crm.sup.askFailed')); return; }
    toast(t((data as { emailSent?: boolean } | null)?.emailSent ? 'adm.crm.sup.askedEmail' : 'adm.crm.sup.askedApp'));
    setAsk(false); setReason('');
    void qc.invalidateQueries({ queryKey: ['crm-admin', 'support-grant', ownerId] });
  };
  return (
    <>
      <Hv as="button" type="button" disabled={busy || g.isLoading} onClick={() => (grant?.status === 'active' ? void open() : setAsk(true))} style={style} hover={hover} title={grant?.status === 'pending' ? t('adm.crm.sup.pendingHint') : undefined}>{label}</Hv>
      <Modal open={ask} onClose={() => setAsk(false)} width={500} label={t('adm.crm.sup.ask')}>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ ...h2, fontSize: 24 }}>{t(grant?.status === 'pending' ? 'adm.crm.sup.remindTitle' : 'adm.crm.sup.askTitle', { name })}</h2>
          <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-600)', lineHeight: 1.55 }}>{t('adm.crm.sup.askBody')}</p>
          <label style={lbl}>{t('adm.crm.ac.reason')}<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} style={{ borderRadius: 12, border: 0, boxShadow: 'inset 0 0 0 1.5px var(--sand-200)', padding: 12, font: 'inherit', fontSize: 15, outline: 'none', resize: 'vertical' }} /></label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Hv as="button" type="button" onClick={() => setAsk(false)} style={{ height: 44, padding: '0 20px', borderRadius: 99, border: 0, background: 'var(--sand-100)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
            <Hv as="button" type="button" disabled={reason.trim().length < 3 || busy} onClick={() => void request()} style={{ height: 44, padding: '0 22px', borderRadius: 99, border: 0, background: 'var(--ink)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: reason.trim().length >= 3 ? 'pointer' : 'not-allowed', opacity: reason.trim().length >= 3 ? 1 : 0.5 }}>{t('adm.crm.sup.send')}</Hv>
          </div>
        </div>
      </Modal>
    </>
  );
}
