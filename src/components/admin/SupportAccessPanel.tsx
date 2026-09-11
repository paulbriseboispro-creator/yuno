// Accès assisté — panneau super admin (monté dans /admin/people/:userId).
//
// Le cycle complet en une carte : demander l'accès (le pro reçoit une notif et
// décide), voir l'état du consentement, ouvrir une session dans son compte,
// couper. Aucun raccourci : sans grant approuvé PAR LE PRO, le bouton
// « Ouvrir une session » n'existe pas — c'est le serveur qui refuse, et l'UI ne
// prétend pas le contraire.

import { useCallback, useEffect, useState } from 'react';
import { Check, Clock, LifeBuoy, LogIn, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { setSupportSession } from '@/lib/supportSession';
import { Card, Btn, Spinner, WARN, POS, T1, T2, T3 } from '@/components/admin/ui';
import { fmtDate } from '@/lib/adminFormat';

interface GrantRow { id: string; status: string; reason: string | null; approved_at: string | null; expires_at: string | null; created_at: string }

// expires_at NULL = accord valable jusqu'à révocation (20260907120000).
const grantIsOpen = (g: { expires_at: string | null }) => !g.expires_at || new Date(g.expires_at) > new Date();

interface Props {
  userId: string;
  userEmail?: string;
  userName?: string;
  /** Rôles du compte cible : décident du dashboard d'atterrissage. */
  roles?: string[];
}

/**
 * Où atterrir en ouvrant la session. Un organisateur n'a pas de
 * /owner/dashboard : l'y envoyer afficherait un écran vide et donnerait
 * l'impression que l'accès n'a pas marché.
 */
export function landingRoute(roles: string[] = []): string {
  if (roles.includes('owner')) return '/owner/dashboard';
  if (roles.includes('organizer')) return '/organizer-app';
  if (roles.includes('agency')) return '/agency-app';
  if (roles.includes('affiliate')) return '/affiliate';
  if (roles.includes('manager')) return '/manager/dashboard';
  if (roles.includes('promoter')) return '/promoter';
  if (roles.includes('dj')) return '/dj';
  return '/';
}

export function SupportAccessPanel({ userId, userEmail, userName, roles }: Props) {
  const { t, language } = useLanguage();
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('admin_support_grants')
      .select('id, status, reason, approved_at, expires_at, created_at')
      .eq('target_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) toast.error(error.message);
    setGrants((data as GrantRow[]) ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const pending = grants.find((g) => g.status === 'pending' && grantIsOpen(g));
  const active = grants.find((g) => g.status === 'active' && grantIsOpen(g));

  const request = async () => {
    const reason = window.prompt(t('adm.sup.reasonPanel'), t('adm.sup.reasonSample'));
    if (reason === null) return;
    setBusy(true);
    // Via l'edge : crée l'accord en attente ET envoie l'email d'acceptation au
    // pro (en plus de la notif in-app + push posées par les triggers).
    const { data, error } = await supabase.functions.invoke('admin-account-recovery', {
      body: { action: 'request-support-access', userId, reason: reason.trim() },
    });
    setBusy(false);
    const err = (data as { error?: string })?.error ?? error?.message;
    if (err) { toast.error(err); return; }
    toast.success((data as { emailSent?: boolean })?.emailSent ? t('adm.sup.requestSentEmail') : t('adm.sup.requestSentApp'));
    load();
  };

  const openSession = async (grantId: string) => {
    if (!window.confirm(`${t('adm.sup.openConfirmWho').replace('{name}', userName || userEmail || '')}\n\n${t('adm.sup.openConfirmWhat')}`)) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-account-recovery', {
        body: { action: 'open-support-session', grantId },
      });
      if (error) throw error;
      if (!data?.access_token || !data?.refresh_token) throw new Error(data?.error || t('adm.sup.openFailed'));

      // La session support remplace la session admin dans ce navigateur : on pose
      // le drapeau AVANT setSession pour que la bannière soit là au premier rendu.
      setSupportSession({
        sessionId: data.session_id,
        targetUserId: data.target_user_id,
        targetName: data.target_name || userEmail || '',
        expiresAt: data.expires_at,
      });
      const { error: sessErr } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      if (sessErr) throw sessErr;
      // Rechargement complet volontaire : tous les contextes (rôle, venue,
      // langue) se réinitialisent sur la nouvelle identité.
      window.location.href = landingRoute(roles);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('adm.sup.openFailed'));
      setBusy(false);
    }
  };

  const revoke = async (grantId: string) => {
    if (!window.confirm(t('adm.sup.revokeConfirm'))) return;
    setBusy(true);
    const { error } = await supabase.rpc('revoke_support_grant', { _grant_id: grantId });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('adm.sup.revoked'));
    load();
  };

  return (
    <Card title={t('adm.sup.panelTitle')} icon={LifeBuoy} accent={!!active}>
      {loading ? <Spinner /> : (
        <>
          {active && (
            <div className="flex items-start gap-2 mb-4 rounded-xl p-3" style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.25)' }}>
              <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: POS }} />
              <div style={{ fontSize: 13, color: T1 }}>
                <span style={{ fontWeight: 600, color: POS }}>{t('adm.sup.granted')}</span>{' '}
                <span style={{ color: T2 }}>{active.expires_at ? t('adm.sup.validUntil').replace('{d}', fmtDate(active.expires_at, language, 'datetime')) : t('adm.sup.validUntilRevoked')}</span>
              </div>
            </div>
          )}
          {pending && !active && (
            <div className="flex items-start gap-2 mb-4 rounded-xl p-3" style={{ background: 'rgba(252,211,77,0.07)', border: '1px solid rgba(252,211,77,0.25)' }}>
              <Clock className="h-4 w-4 mt-0.5 shrink-0" style={{ color: WARN }} />
              <div style={{ fontSize: 13, color: T1 }}>
                <span style={{ fontWeight: 600, color: WARN }}>{t('adm.sup.waiting')}</span>{' '}
                <span style={{ color: T2 }}>{t('adm.sup.requestedOn').replace('{d}', fmtDate(pending.created_at, language, 'datetime'))}</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!pending && !active && <Btn onClick={request} disabled={busy} icon={LifeBuoy}>{t('adm.sup.request')}</Btn>}
            {active && <Btn onClick={() => openSession(active.id)} loading={busy} variant="primary" icon={LogIn}>{t('adm.sup.openSession')}</Btn>}
            {(active || pending) && <Btn onClick={() => revoke((active ?? pending)!.id)} disabled={busy} icon={ShieldOff}>{t('adm.sup.revoke')}</Btn>}
          </div>

          <p style={{ fontSize: 12, color: T3, marginTop: 12, lineHeight: 1.5 }}>{t('adm.sup.guarantees')}</p>
        </>
      )}
    </Card>
  );
}
