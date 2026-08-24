// Accès assisté — panneau super admin (monté dans /admin/directory/user/:userId).
//
// Le cycle complet en une carte : demander l'accès (le pro reçoit une notif et
// décide), voir l'état du consentement, ouvrir une session dans son compte,
// couper. Aucun raccourci : sans grant approuvé PAR LE PRO, le bouton
// « Ouvrir une session » n'existe pas — c'est le serveur qui refuse, et l'UI ne
// prétend pas le contraire.

import { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, Loader2, ShieldOff, LogIn, Clock, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { setSupportSession } from '@/lib/supportSession';
import { format } from 'date-fns';

const RED = '#E8192C';
const POS = '#34D399';
const AMBER = '#F5A524';
const T1 = 'rgba(255,255,255,0.96)';
const T2 = 'rgba(255,255,255,0.58)';
const T3 = 'rgba(255,255,255,0.36)';
const BORDER = 'rgba(255,255,255,0.085)';
const INNER_BG = 'rgba(255,255,255,0.032)';

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`,
  color: T2, fontSize: 12.5, fontWeight: 560, cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = {
  ...btn, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)',
  color: RED, fontWeight: 600,
};

interface GrantRow {
  id: string;
  status: string;
  reason: string | null;
  approved_at: string | null;
  expires_at: string;
  created_at: string;
}

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
function landingRoute(roles: string[] = []): string {
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
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('admin_support_grants')
      .select('id, status, reason, approved_at, expires_at, created_at')
      .eq('target_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);
    setGrants((data as GrantRow[]) ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const pending = grants.find((g) => g.status === 'pending' && new Date(g.expires_at) > new Date());
  const active = grants.find((g) => g.status === 'active' && new Date(g.expires_at) > new Date());

  const request = async () => {
    const reason = window.prompt(
      "Motif de la demande (visible par le pro dans son app) :",
      "Configuration de la soirée : guest lists, tables et billetterie.",
    );
    if (reason === null) return;
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('admin_support_grants').insert({
      target_user_id: userId,
      requested_by: user?.id,
      reason: reason.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Demande envoyée — le pro la voit dans son app.');
    load();
  };

  const openSession = async (grantId: string) => {
    if (!confirm(
      `Ouvrir une session d'assistance dans le compte de ${userName || userEmail || 'ce pro'} ?\n\n` +
      `Vous serez déconnecté de votre compte admin et connecté au sien. ` +
      `Chaque écriture est journalisée sous votre nom, et visible par lui. ` +
      `Les paiements, l'identité de connexion et la 2FA restent verrouillés.`
    )) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-account-recovery', {
        body: { action: 'open-support-session', grantId },
      });
      if (error) throw error;
      if (!data?.access_token || !data?.refresh_token) throw new Error(data?.error || 'Session indisponible');

      // La session support remplace la session admin dans ce navigateur : on pose
      // le drapeau AVANT setSession pour que la bannière soit là au premier rendu.
      setSupportSession({
        sessionId: data.session_id,
        targetUserId: data.target_user_id,
        targetName: data.target_name || userEmail || 'Compte pro',
        expiresAt: data.expires_at,
      });
      const { error: sessErr } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessErr) throw sessErr;
      // Rechargement complet volontaire : tous les contextes (rôle, venue,
      // langue) se réinitialisent sur la nouvelle identité.
      window.location.href = landingRoute(roles);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
      setBusy(false);
    }
  };

  const revoke = async (grantId: string) => {
    if (!confirm("Révoquer cet accès ? Toute session ouverte est coupée immédiatement.")) return;
    setBusy(true);
    const { error } = await supabase.rpc('revoke_support_grant', { _grant_id: grantId });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Accès révoqué.');
    load();
  };

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl flex-none"
          style={{ background: 'rgba(245,165,36,0.1)', border: '1px solid rgba(245,165,36,0.2)' }}>
          <LifeBuoy className="h-4 w-4" style={{ color: AMBER }} />
        </div>
        <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
          Accès assisté
        </h3>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin" style={{ color: T3 }} /></div>
      ) : (
        <>
          {active && (
            <div className="flex items-start gap-2 mb-4 rounded-xl p-3"
              style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.25)' }}>
              <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: POS }} />
              <div style={{ fontSize: 13, color: T1 }}>
                <span style={{ fontWeight: 600, color: POS }}>Accès accordé par le pro.</span>{' '}
                <span style={{ color: T2 }}>
                  Valable jusqu'au {format(new Date(active.expires_at), 'dd/MM/yyyy · HH:mm')}.
                </span>
              </div>
            </div>
          )}
          {pending && !active && (
            <div className="flex items-start gap-2 mb-4 rounded-xl p-3"
              style={{ background: 'rgba(245,165,36,0.07)', border: '1px solid rgba(245,165,36,0.25)' }}>
              <Clock className="h-4 w-4 mt-0.5 shrink-0" style={{ color: AMBER }} />
              <div style={{ fontSize: 13, color: T1 }}>
                <span style={{ fontWeight: 600, color: AMBER }}>En attente de son accord.</span>{' '}
                <span style={{ color: T2 }}>Demandé le {format(new Date(pending.created_at), 'dd/MM · HH:mm')}.</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2.5">
            {!pending && !active && (
              <button onClick={request} disabled={busy} style={{ ...btn, opacity: busy ? 0.5 : 1 }}>
                <LifeBuoy className="h-4 w-4" /> Demander un accès
              </button>
            )}
            {active && (
              <button onClick={() => openSession(active.id)} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.5 : 1 }}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                Ouvrir une session
              </button>
            )}
            {(active || pending) && (
              <button onClick={() => revoke((active ?? pending)!.id)} disabled={busy} style={{ ...btn, opacity: busy ? 0.5 : 1 }}>
                <ShieldOff className="h-4 w-4" /> Révoquer
              </button>
            )}
          </div>

          <p style={{ fontSize: 12, color: T3, marginTop: 12, lineHeight: 1.5 }}>
            Le pro reçoit une notification et doit accepter depuis son app. Une fois la session
            ouverte : événements, guest lists, tables et profil public sont modifiables ; les
            paiements (Stripe, IBAN, règlements), l'email de connexion, le PIN et la 2FA sont
            refusés par la base. Chaque écriture apparaît dans son journal.
          </p>
        </>
      )}
    </div>
  );
}
