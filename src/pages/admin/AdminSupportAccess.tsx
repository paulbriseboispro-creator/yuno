// Accès assisté — vue globale (super admin).
//
// Le consentement est la porte : chaque accès est DEMANDÉ ici, ACCORDÉ par le
// pro depuis son app, et coupé d'un bouton. Aucun raccourci côté client — sans
// accord approuvé, l'edge refuse d'ouvrir la session.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { setSupportSession } from '@/lib/supportSession';
import { toast } from 'sonner';
import { Check, Clock, ExternalLink, History, LifeBuoy, LogIn, Mail, Search, ShieldOff } from 'lucide-react';
import {
  AdminPage, Card, Btn, Pill, Modal, Field, EmptyState, Spinner, INPUT_STYLE, TILE_BG, F_BORDER, POS, WARN, T1, T2, T3,
} from '@/components/admin/ui';
import { landingRoute } from '@/components/admin/SupportAccessPanel';
import { fmtDate, fmtRelative } from '@/lib/adminFormat';

interface GrantRow { id: string; target_user_id: string; status: string; reason: string | null; initiated_by: string | null; approved_at: string | null; revoked_at: string | null; expires_at: string | null; created_at: string }
interface SessionRow { id: string; grant_id: string; target_user_id: string; status: string; registered_at: string | null; expires_at: string }
interface ProfileRow { id: string; email: string | null; first_name: string | null; last_name: string | null; organization_name: string | null; profile_type: string | null }

// expires_at NULL = accord valable jusqu'à révocation (20260907120000).
const grantIsOpen = (g: { expires_at: string | null }, now: number) => !g.expires_at || new Date(g.expires_at).getTime() > now;

export default function AdminSupportAccess() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [rolesById, setRolesById] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [requestOpen, setRequestOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ProfileRow[]>([]);
  const [picked, setPicked] = useState<ProfileRow | null>(null);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => { setReason(t('adm.sup.reasonSample')); }, [t]);

  const displayName = useCallback((p?: ProfileRow): string =>
    p?.organization_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || p?.email || t('adm.common.unknown'), [t]);
  const roleLabel = (r: string) => { const k = `adm.people.role.${r}`; const v = t(k); return v === k ? r : v; };

  const load = useCallback(async () => {
    const [grantsRes, sessionsRes] = await Promise.all([
      supabase.from('admin_support_grants').select('id, target_user_id, status, reason, initiated_by, approved_at, revoked_at, expires_at, created_at').order('created_at', { ascending: false }).limit(200),
      supabase.from('admin_support_sessions').select('id, grant_id, target_user_id, status, registered_at, expires_at').eq('status', 'active'),
    ]);
    if (grantsRes.error) toast.error(grantsRes.error.message);
    const g = (grantsRes.data ?? []) as GrantRow[];
    const s = (sessionsRes.data ?? []) as SessionRow[];
    setGrants(g);
    setSessions(s.filter((x) => new Date(x.expires_at) > new Date()));
    const ids = [...new Set([...g.map((x) => x.target_user_id), ...s.map((x) => x.target_user_id)])];
    if (ids.length) {
      const [profRes, rolesRes] = await Promise.all([
        supabase.from('profiles').select('id, email, first_name, last_name, organization_name, profile_type').in('id', ids),
        supabase.from('user_roles').select('user_id, role').in('user_id', ids),
      ]);
      setProfiles(Object.fromEntries(((profRes.data ?? []) as ProfileRow[]).map((p) => [p.id, p])));
      const byId: Record<string, string[]> = {};
      for (const r of (rolesRes.data ?? []) as { user_id: string; role: string }[]) (byId[r.user_id] ??= []).push(r.role);
      setRolesById(byId);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Recherche débouncée : une requête par pause de frappe, pas par touche.
  useEffect(() => { const id = window.setTimeout(() => setDebounced(query), 280); return () => clearTimeout(id); }, [query]);
  useEffect(() => {
    const clean = debounced.trim().replace(/[%_,()]/g, ' ').trim();
    if (clean.length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const like = `%${clean}%`;
    supabase.from('profiles').select('id, email, first_name, last_name, organization_name, profile_type')
      .or(`email.ilike.${like},organization_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like}`).limit(8)
      .then(({ data }) => { if (!cancelled) { setResults((data ?? []) as ProfileRow[]); setSearching(false); } });
    return () => { cancelled = true; };
  }, [debounced]);

  const now = Date.now();
  const active = useMemo(() => grants.filter((g) => g.status === 'active' && grantIsOpen(g, now)), [grants, now]);
  const pending = useMemo(() => grants.filter((g) => g.status === 'pending' && grantIsOpen(g, now)), [grants, now]);
  const history = useMemo(() => grants.filter((g) => !active.includes(g) && !pending.includes(g)).slice(0, 30), [grants, active, pending]);
  const sessionByGrant = useMemo(() => Object.fromEntries(sessions.map((s) => [s.grant_id, s])), [sessions]);

  // La demande passe par l'edge : elle crée (ou réutilise) l'accord en attente
  // ET envoie l'email au pro avec le bouton d'acceptation, en plus de la notif
  // in-app + push posées par les triggers.
  const sendRequest = async () => {
    if (!picked || sending) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke('admin-account-recovery', { body: { action: 'request-support-access', userId: picked.id, reason: reason.trim() } });
    setSending(false);
    const err = (data as { error?: string })?.error ?? error?.message;
    if (err) { toast.error(err); return; }
    if ((data as { already_active?: boolean })?.already_active) toast.info(t('adm.sup.alreadyActive').replace('{name}', displayName(picked)));
    else toast.success((data as { emailSent?: boolean })?.emailSent ? t('adm.sup.requestSentEmail') : t('adm.sup.requestSentApp'));
    setRequestOpen(false); setQuery(''); setResults([]); setPicked(null);
    load();
  };

  const remind = async (g: GrantRow) => {
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('admin-account-recovery', { body: { action: 'request-support-access', userId: g.target_user_id, reason: g.reason ?? '' } });
    setBusy(false);
    const err = (data as { error?: string })?.error ?? error?.message;
    if (err) { toast.error(err); return; }
    toast.success((data as { emailSent?: boolean })?.emailSent ? t('adm.sup.reminded') : t('adm.sup.remindFailed'));
  };

  const openSession = async (grant: GrantRow) => {
    const name = displayName(profiles[grant.target_user_id]);
    if (!window.confirm(`${t('adm.sup.openConfirmWho').replace('{name}', name)}\n\n${t('adm.sup.openConfirmWhat')}`)) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-account-recovery', { body: { action: 'open-support-session', grantId: grant.id } });
      if (error) throw error;
      if (!data?.access_token || !data?.refresh_token) throw new Error(data?.error || t('adm.sup.openFailed'));
      // Le drapeau AVANT setSession pour que la bannière soit là au premier rendu.
      setSupportSession({ sessionId: data.session_id, targetUserId: data.target_user_id, targetName: data.target_name || name, expiresAt: data.expires_at });
      const { error: sessErr } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      if (sessErr) throw sessErr;
      // Rechargement complet volontaire : tous les contextes se réinitialisent.
      window.location.href = landingRoute(rolesById[grant.target_user_id]);
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

  const AccountCell = ({ userId }: { userId: string }) => {
    const p = profiles[userId];
    const roles = (rolesById[userId] ?? []).filter((r) => r !== 'admin');
    return (
      <div className="flex-1 min-w-0">
        <button onClick={() => navigate(`/admin/people/${userId}`)} className="font-[560] truncate flex items-center gap-1.5 hover:underline cursor-pointer"
          style={{ color: T1, fontSize: 13.5, background: 'none', border: 'none', padding: 0 }}>
          {displayName(p)}
          <ExternalLink className="h-3 w-3 shrink-0" style={{ color: T3 }} />
        </button>
        <div className="truncate" style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>
          {p?.email ?? userId}{roles.length ? ` · ${roles.map(roleLabel).join(', ')}` : ''}
        </div>
      </div>
    );
  };

  const row = { background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 12 };

  return (
    <AdminPage eyebrow={t('adm.sup.eyebrow')} title={t('adm.sup.title')} subtitle={t('adm.sup.subtitle')}
      actions={<Btn variant="primary" icon={LifeBuoy} onClick={() => setRequestOpen(true)}>{t('adm.sup.request')}</Btn>}>
      {loading ? <Card><Spinner /></Card> : (
        <>
          <Card title={`${t('adm.sup.granted_')} (${active.length})`} icon={Check} accent={active.length > 0}>
            {active.length === 0 ? <EmptyState icon={Check} text={t('adm.sup.noActive')} /> : (
              <div className="space-y-2">
                {active.map((g) => {
                  const sess = sessionByGrant[g.id];
                  return (
                    <div key={g.id} className="flex items-center justify-between gap-3 p-3 flex-wrap" style={row}>
                      <AccountCell userId={g.target_user_id} />
                      {sess && <Pill size="xs" tone="pos">{t('adm.sup.sessionActive')}{sess.registered_at ? ` · ${fmtDate(sess.registered_at, language, 'time')}` : ''}</Pill>}
                      <span style={{ color: T3, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                        {g.expires_at ? t('adm.sup.expiresOn').replace('{d}', fmtDate(g.expires_at, language, 'datetime')) : t('adm.sup.untilRevoked')}
                      </span>
                      <div className="flex items-center gap-2">
                        <Btn variant="primary" icon={LogIn} loading={busy} onClick={() => openSession(g)}>{t('adm.sup.openSession')}</Btn>
                        <Btn icon={ShieldOff} disabled={busy} onClick={() => revoke(g.id)} title={t('adm.sup.revoke')} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title={`${t('adm.sup.pending')} (${pending.length})`} icon={Clock} accent={pending.length > 0}>
            {pending.length === 0 ? <EmptyState icon={Clock} text={t('adm.sup.noPending')} /> : (
              <div className="space-y-2">
                {pending.map((g) => (
                  <div key={g.id} className="flex items-center justify-between gap-3 p-3 flex-wrap" style={row}>
                    <AccountCell userId={g.target_user_id} />
                    <span style={{ color: T3, fontSize: 11.5, whiteSpace: 'nowrap' }}>{fmtRelative(g.created_at, language)}</span>
                    <Pill size="xs" tone="accent">{t('adm.sup.waitingShort')}</Pill>
                    <Btn size="sm" icon={Mail} disabled={busy} onClick={() => remind(g)}>{t('adm.sup.remind')}</Btn>
                    <Btn size="sm" icon={ShieldOff} disabled={busy} onClick={() => revoke(g.id)}>{t('adm.sup.cancel')}</Btn>
                  </div>
                ))}
              </div>
            )}
            <p style={{ fontSize: 11.5, color: T3, marginTop: 12, lineHeight: 1.5 }}>{t('adm.sup.acceptHint')}</p>
          </Card>

          <Card>
            <button onClick={() => setShowHistory((v) => !v)} className="flex items-center gap-2 w-full text-left cursor-pointer"
              style={{ background: 'none', border: 'none', color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', padding: 0 }}>
              <History className="h-4 w-4" style={{ color: T3 }} />
              {t('adm.sup.history')} ({history.length}){' '}
              <span style={{ color: T3, fontSize: 12, fontWeight: 400 }}>{showHistory ? t('adm.sup.hide') : t('adm.sup.show')}</span>
            </button>
            {showHistory && (
              <div className="space-y-2 mt-4">
                {history.length === 0 ? <EmptyState icon={History} text={t('adm.sup.nothing')} /> : history.map((g) => (
                  <div key={g.id} className="flex items-center justify-between gap-3 p-3 flex-wrap" style={row}>
                    <AccountCell userId={g.target_user_id} />
                    <span style={{ color: T3, fontSize: 11.5, whiteSpace: 'nowrap' }}>{fmtDate(g.created_at, language)}</span>
                    <Pill size="xs" tone={g.status === 'revoked' ? 'neg' : 'muted'}>
                      {g.status === 'revoked' ? t('adm.sup.st.revoked') : g.status === 'active' || g.status === 'pending' ? t('adm.sup.st.expired') : g.status}
                    </Pill>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      <Modal open={requestOpen} onClose={() => { setRequestOpen(false); setQuery(''); setResults([]); setPicked(null); }} title={t('adm.sup.requestTitle')}
        footer={<><Btn onClick={() => setRequestOpen(false)}>{t('adm.common.cancel')}</Btn><Btn variant="primary" icon={LifeBuoy} loading={sending} disabled={!picked} onClick={sendRequest}>{t('adm.sup.send')}</Btn></>}>
        <Field label={t('adm.sup.proAccount')}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: T3 }} />
            <input value={picked ? displayName(picked) : query} onChange={(e) => { setPicked(null); setQuery(e.target.value); }} placeholder={t('adm.sup.searchPh')} style={{ ...INPUT_STYLE, paddingLeft: 36 }} />
          </div>
          {!picked && (searching || results.length > 0) && (
            <div className="mt-1.5 overflow-hidden rounded-xl" style={{ background: '#0a0a0c', border: `1px solid ${F_BORDER}` }}>
              {searching ? <Spinner /> : results.map((r) => (
                <button key={r.id} onClick={() => { setPicked(r); setResults([]); }} className="flex w-full flex-col items-start px-3 py-2 text-left transition hover:bg-white/[0.05] cursor-pointer" style={{ background: 'none', border: 'none' }}>
                  <span style={{ color: T1, fontSize: 13 }}>{displayName(r)}</span>
                  <span style={{ color: T3, fontSize: 11.5 }}>{r.email}{r.profile_type === 'organizer' ? ` · ${roleLabel('organizer')}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field label={t('adm.sup.reason')} hint={t('adm.sup.consentHint')}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={{ ...INPUT_STYLE, resize: 'vertical' }} />
        </Field>
        <p style={{ color: T2, fontSize: 11.5 }}>{WARN && ''}</p>
      </Modal>
    </AdminPage>
  );
}
