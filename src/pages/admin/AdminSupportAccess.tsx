// Fenêtre Super Admin : vue d'ensemble de l'ACCÈS ASSISTÉ (mode support).
//
// Jusqu'ici la gestion vivait uniquement dans la fiche utilisateur
// (SupportAccessPanel dans /admin/directory/user/:id) — aucune vue globale.
// Cette page centralise le cycle : comptes auxquels l'accès est ACCORDÉ
// (ouvrir une session en un clic), demandes EN ATTENTE d'acceptation par le
// pro, sessions en cours, historique récent. Plus un bouton « Demander un
// accès » avec recherche de compte.
//
// Aucun raccourci : sans accord donné PAR le pro, pas de bouton « Ouvrir une
// session » — c'est le serveur qui refuse, l'UI ne prétend pas le contraire.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LifeBuoy, Loader2, LogIn, ShieldOff, Clock, Check, Search, History, ExternalLink, Mail,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { setSupportSession } from '@/lib/supportSession';

// ─── Yuno Design Tokens (miroir AdminDemoAccess) ─────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const AMBER      = '#F5A524';
const NEG        = '#FF5C63';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const C_FAINT    = 'rgba(255,255,255,0.06)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const TILE_BG    = 'rgba(255,255,255,0.025)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

const inputStyle: React.CSSProperties = {
  background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
  color: T1, fontSize: 13, padding: '9px 12px', width: '100%', outline: 'none',
};
const cardStyle: React.CSSProperties = {
  background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18,
  boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden',
};
const rowStyle: React.CSSProperties = {
  background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 12,
};
function pillStyle(color: string, bg: string, border: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px',
    borderRadius: 999, fontSize: 11, fontWeight: 600, color, background: bg, border: `1px solid ${border}`,
  };
}
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
  borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`,
  color: T2, fontSize: 12.5, fontWeight: 560, cursor: 'pointer', whiteSpace: 'nowrap',
};
const btnPrimary: React.CSSProperties = {
  ...btn, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.3)',
  color: RED, fontWeight: 600,
};

interface GrantRow {
  id: string;
  target_user_id: string;
  status: string;
  reason: string | null;
  initiated_by: string | null;
  approved_at: string | null;
  revoked_at: string | null;
  expires_at: string;
  created_at: string;
}

interface SessionRow {
  id: string;
  grant_id: string;
  target_user_id: string;
  status: string;
  registered_at: string | null;
  expires_at: string;
}

interface ProfileRow {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  profile_type: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Club', organizer: 'Organisateur', agency: 'Agence', affiliate: 'Affilié',
  manager: 'Manager', promoter: 'Promoteur', dj: 'DJ', admin: 'Admin',
};

/** Où atterrir en ouvrant la session (même logique que SupportAccessPanel). */
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

function displayName(p?: ProfileRow): string {
  if (!p) return 'Compte inconnu';
  return p.organization_name
    || [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
    || p.email
    || 'Compte inconnu';
}

export default function AdminSupportAccess() {
  const navigate = useNavigate();
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [rolesById, setRolesById] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Dialog « Demander un accès »
  const [requestOpen, setRequestOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ProfileRow[]>([]);
  const [picked, setPicked] = useState<ProfileRow | null>(null);
  const [reason, setReason] = useState('Configuration de la soirée : guest lists, tables et billetterie.');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const [grantsRes, sessionsRes] = await Promise.all([
      supabase
        .from('admin_support_grants')
        .select('id, target_user_id, status, reason, initiated_by, approved_at, revoked_at, expires_at, created_at')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('admin_support_sessions')
        .select('id, grant_id, target_user_id, status, registered_at, expires_at')
        .eq('status', 'active'),
    ]);
    const g = (grantsRes.data ?? []) as GrantRow[];
    const s = (sessionsRes.data ?? []) as SessionRow[];
    setGrants(g);
    setSessions(s.filter((x) => new Date(x.expires_at) > new Date()));

    const ids = [...new Set([...g.map((x) => x.target_user_id), ...s.map((x) => x.target_user_id)])];
    if (ids.length) {
      const [profRes, rolesRes] = await Promise.all([
        supabase.from('profiles')
          .select('id, email, first_name, last_name, organization_name, profile_type')
          .in('id', ids),
        supabase.from('user_roles').select('user_id, role').in('user_id', ids),
      ]);
      setProfiles(Object.fromEntries(((profRes.data ?? []) as ProfileRow[]).map((p) => [p.id, p])));
      const byId: Record<string, string[]> = {};
      for (const r of (rolesRes.data ?? []) as { user_id: string; role: string }[]) {
        (byId[r.user_id] ??= []).push(r.role);
      }
      setRolesById(byId);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const now = Date.now();
  const active = useMemo(
    () => grants.filter((g) => g.status === 'active' && new Date(g.expires_at).getTime() > now),
    [grants, now],
  );
  const pending = useMemo(
    () => grants.filter((g) => g.status === 'pending' && new Date(g.expires_at).getTime() > now),
    [grants, now],
  );
  const history = useMemo(
    () => grants.filter((g) => !active.includes(g) && !pending.includes(g)).slice(0, 30),
    [grants, active, pending],
  );
  const sessionByGrant = useMemo(
    () => Object.fromEntries(sessions.map((s) => [s.grant_id, s])),
    [sessions],
  );

  // ── Recherche de compte (dialog de demande) ────────────────────────────────
  const search = async (q: string) => {
    setQuery(q);
    setPicked(null);
    const clean = q.trim().replace(/[,()]/g, '');
    if (clean.length < 2) { setResults([]); return; }
    setSearching(true);
    const like = `%${clean}%`;
    const { data } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name, organization_name, profile_type')
      .or(`email.ilike.${like},organization_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like}`)
      .limit(8);
    setResults((data ?? []) as ProfileRow[]);
    setSearching(false);
  };

  // La demande passe par l'edge : elle crée (ou réutilise) l'accord en attente
  // ET envoie l'email au pro avec le bouton d'acceptation, en plus de la notif
  // in-app + push posées par les triggers.
  const sendRequest = async () => {
    if (!picked || sending) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke('admin-account-recovery', {
      body: { action: 'request-support-access', userId: picked.id, reason: reason.trim() },
    });
    setSending(false);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? 'Erreur');
      return;
    }
    if ((data as { already_active?: boolean })?.already_active) {
      toast.info(`${displayName(picked)} t'a déjà accordé l'accès — il est dans « Accès accordés ».`);
    } else {
      toast.success(
        (data as { emailSent?: boolean })?.emailSent
          ? `Demande envoyée à ${displayName(picked)} — email + notif + push.`
          : `Demande envoyée à ${displayName(picked)} (notif + push ; email indisponible).`,
      );
    }
    setRequestOpen(false);
    setQuery(''); setResults([]); setPicked(null);
    load();
  };

  // Re-notifier un pro qui n'a pas encore accepté : ré-envoie l'email sur
  // l'accord en attente existant (l'edge le réutilise, pas de doublon).
  const remind = async (g: GrantRow) => {
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('admin-account-recovery', {
      body: { action: 'request-support-access', userId: g.target_user_id, reason: g.reason ?? '' },
    });
    setBusy(false);
    if (error || (data as { error?: string })?.error) {
      toast.error((data as { error?: string })?.error ?? error?.message ?? 'Erreur');
      return;
    }
    toast.success((data as { emailSent?: boolean })?.emailSent ? 'Email de relance envoyé.' : 'Relance impossible (email indisponible).');
  };

  // ── Ouvrir / révoquer (même mécanique que SupportAccessPanel) ─────────────
  const openSession = async (grant: GrantRow) => {
    const name = displayName(profiles[grant.target_user_id]);
    if (!confirm(
      `Ouvrir une session d'assistance dans le compte de ${name} ?\n\n` +
      `Vous serez déconnecté de votre compte admin et connecté au sien. ` +
      `Chaque écriture est journalisée sous votre nom, et visible par lui. ` +
      `Les paiements, l'identité de connexion et la 2FA restent verrouillés.`
    )) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-account-recovery', {
        body: { action: 'open-support-session', grantId: grant.id },
      });
      if (error) throw error;
      if (!data?.access_token || !data?.refresh_token) throw new Error(data?.error || 'Session indisponible');

      // Le drapeau AVANT setSession pour que la bannière soit là au premier rendu.
      setSupportSession({
        sessionId: data.session_id,
        targetUserId: data.target_user_id,
        targetName: data.target_name || name,
        expiresAt: data.expires_at,
      });
      const { error: sessErr } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (sessErr) throw sessErr;
      // Rechargement complet volontaire : tous les contextes se réinitialisent.
      window.location.href = landingRoute(rolesById[grant.target_user_id]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur');
      setBusy(false);
    }
  };

  const revoke = async (grantId: string) => {
    if (!confirm('Révoquer cet accès ? Toute session ouverte est coupée immédiatement.')) return;
    setBusy(true);
    const { error } = await supabase.rpc('revoke_support_grant', { _grant_id: grantId });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Accès révoqué.');
    load();
  };

  const accountCell = (userId: string) => {
    const p = profiles[userId];
    const roles = rolesById[userId] ?? [];
    const chips = roles.filter((r) => ROLE_LABELS[r] && r !== 'admin').map((r) => ROLE_LABELS[r]);
    if (!chips.length && p?.profile_type === 'organizer') chips.push('Organisateur');
    return (
      <div className="flex-1 min-w-0">
        <button
          onClick={() => navigate(`/admin/directory/user/${userId}`)}
          className="font-[560] truncate flex items-center gap-1.5 hover:underline"
          style={{ color: T1, fontSize: 13.5, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          {displayName(p)}
          <ExternalLink className="h-3 w-3 shrink-0" style={{ color: T3 }} />
        </button>
        <div className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
          {p?.email ?? userId}
          {chips.length ? ` · ${chips.join(', ')}` : ''}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
              Accès assisté
            </h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>
              Les comptes pro que tu peux configurer avec eux. Le consentement est la porte :
              chaque accès est accordé par le pro, expire seul (7 j) et se révoque en un clic.
            </p>
          </div>
          <Dialog open={requestOpen} onOpenChange={(o) => { setRequestOpen(o); if (!o) { setQuery(''); setResults([]); setPicked(null); } }}>
            <DialogTrigger asChild>
              <button
                className="inline-flex items-center gap-2 rounded-xl text-[13px] font-semibold cursor-pointer transition-all duration-150"
                style={{ background: RED, color: '#fff', padding: '10px 16px', boxShadow: `0 0 18px -6px ${RED}88` }}
              >
                <LifeBuoy className="h-4 w-4" />Demander un accès
              </button>
            </DialogTrigger>
            <DialogContent style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, color: T1 }}>
              <DialogHeader><DialogTitle style={{ color: T1 }}>Demander un accès assisté</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label style={{ color: T2 }}>Compte pro</Label>
                  <div className="relative" style={{ marginTop: 6 }}>
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
                    <input
                      value={picked ? displayName(picked) : query}
                      onChange={(e) => search(e.target.value)}
                      placeholder="Nom, organisation ou email…"
                      style={{ ...inputStyle, paddingLeft: 36 }}
                    />
                  </div>
                  {!picked && (searching || results.length > 0) && (
                    <div className="mt-1.5 overflow-hidden rounded-xl" style={{ background: '#0d0d10', border: `1px solid ${BORDER}` }}>
                      {searching ? (
                        <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" style={{ color: T3 }} /></div>
                      ) : results.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => { setPicked(r); setResults([]); }}
                          className="flex w-full flex-col items-start px-3 py-2 text-left transition hover:bg-white/[0.05]"
                          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                          <span style={{ color: T1, fontSize: 13 }}>{displayName(r)}</span>
                          <span style={{ color: T3, fontSize: 11.5 }}>{r.email}{r.profile_type === 'organizer' ? ' · Organisateur' : ''}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <Label style={{ color: T2 }}>Motif (visible par le pro)</Label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    style={{ ...inputStyle, marginTop: 6, resize: 'vertical' }}
                  />
                </div>
                <button
                  onClick={sendRequest}
                  disabled={!picked || sending}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150"
                  style={{ background: RED, color: '#fff', padding: '11px 16px', boxShadow: `0 0 18px -6px ${RED}88`, cursor: (!picked || sending) ? 'not-allowed' : 'pointer', opacity: (!picked || sending) ? 0.5 : 1 }}
                >
                  {sending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Envoyer la demande
                </button>
                <p style={{ color: T3, fontSize: 11.5, lineHeight: 1.5 }}>
                  Le pro reçoit une notification et un push, et accepte (ou pas) depuis son app.
                  Rien ne s'ouvre sans son accord.
                </p>
              </div>
            </DialogContent>
          </Dialog>
        </header>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin" style={{ color: T3 }} /></div>
        ) : (
          <>
            {/* ── Accès accordés ─────────────────────────────────────────── */}
            <div style={cardStyle}>
              <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 16 }}>
                <Check className="h-4 w-4" style={{ color: POS }} />Accès accordés ({active.length})
              </h2>
              {active.length === 0 ? (
                <p className="py-4 text-center" style={{ color: T3, fontSize: 12.5 }}>
                  Aucun accès actif. Quand un pro accepte ta demande (ou l'offre d'assistance à
                  l'invitation), il apparaît ici.
                </p>
              ) : (
                <div className="space-y-2">
                  {active.map((g) => {
                    const sess = sessionByGrant[g.id];
                    return (
                      <div key={g.id} className="flex items-center justify-between gap-3 p-3 flex-wrap" style={rowStyle}>
                        {accountCell(g.target_user_id)}
                        {sess && (
                          <span style={pillStyle(POS, 'rgba(52,211,153,0.1)', 'rgba(52,211,153,0.25)')}>
                            Session en cours{sess.registered_at ? ` · ${format(new Date(sess.registered_at), 'HH:mm')}` : ''}
                          </span>
                        )}
                        <span style={{ color: T3, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                          expire {format(new Date(g.expires_at), 'dd/MM · HH:mm')}
                        </span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => openSession(g)} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.5 : 1 }}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                            Ouvrir la session
                          </button>
                          <button onClick={() => revoke(g.id)} disabled={busy} style={{ ...btn, opacity: busy ? 0.5 : 1 }}>
                            <ShieldOff className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── En attente d'acceptation ───────────────────────────────── */}
            <div style={cardStyle}>
              <h2 className="flex items-center gap-2" style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 16 }}>
                <Clock className="h-4 w-4" style={{ color: AMBER }} />En attente d'acceptation ({pending.length})
              </h2>
              {pending.length === 0 ? (
                <p className="py-4 text-center" style={{ color: T3, fontSize: 12.5 }}>
                  Aucune demande en attente.
                </p>
              ) : (
                <div className="space-y-2">
                  {pending.map((g) => (
                    <div key={g.id} className="flex items-center justify-between gap-3 p-3 flex-wrap" style={rowStyle}>
                      {accountCell(g.target_user_id)}
                      <span style={{ color: T3, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                        demandé {format(new Date(g.created_at), 'dd/MM · HH:mm')}
                      </span>
                      <span style={pillStyle(AMBER, 'rgba(245,165,36,0.08)', 'rgba(245,165,36,0.25)')}>
                        Attend son accord
                      </span>
                      <button onClick={() => remind(g)} disabled={busy} style={{ ...btn, opacity: busy ? 0.5 : 1 }}>
                        <Mail className="h-4 w-4" />Relancer par email
                      </button>
                      <button onClick={() => revoke(g.id)} disabled={busy} style={{ ...btn, opacity: busy ? 0.5 : 1 }}>
                        <ShieldOff className="h-4 w-4" />Annuler
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p style={{ fontSize: 11.5, color: T3, marginTop: 12, lineHeight: 1.5 }}>
                Le pro accepte depuis son app (Réglages → Assistance Yuno). Tu reçois une
                notification dès que l'accès devient actif.
              </p>
            </div>

            {/* ── Historique ─────────────────────────────────────────────── */}
            <div style={cardStyle}>
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="flex items-center gap-2 w-full text-left"
                style={{ background: 'none', border: 'none', color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', cursor: 'pointer', padding: 0 }}
              >
                <History className="h-4 w-4" style={{ color: T3 }} />
                Historique ({history.length}){' '}
                <span style={{ color: T3, fontSize: 12, fontWeight: 400 }}>{showHistory ? 'masquer' : 'afficher'}</span>
              </button>
              {showHistory && (
                <div className="space-y-2 mt-4">
                  {history.length === 0 ? (
                    <p className="py-2 text-center" style={{ color: T3, fontSize: 12.5 }}>Rien pour l'instant.</p>
                  ) : history.map((g) => (
                    <div key={g.id} className="flex items-center justify-between gap-3 p-3 flex-wrap" style={rowStyle}>
                      {accountCell(g.target_user_id)}
                      <span style={{ color: T3, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                        {format(new Date(g.created_at), 'dd/MM/yyyy')}
                      </span>
                      <span style={g.status === 'revoked'
                        ? pillStyle(NEG, 'rgba(255,92,99,0.1)', 'rgba(255,92,99,0.25)')
                        : pillStyle(T3, C_FAINT, BORDER)}>
                        {g.status === 'revoked' ? 'Révoqué' : g.status === 'active' || g.status === 'pending' ? 'Expiré' : g.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
