/**
 * Compte › Accès Yuno (`/crm/account/support`) : la page de consentement de
 * l'accès assisté dans la Console CRM (migration 20261019420000). Même
 * mécanique que la Billetterie (SupportAccessSettings, admin_support_grants) :
 * la demande en attente (décision), ce que l'accès permet et interdit
 * (contrat), le journal (preuve). L'accord est celui du TITULAIRE : un membre
 * de l'équipe voit la règle, pas les boutons. `?approve=<id>` (lien de
 * l'e-mail) ouvre la décision d'office ; le clic d'accord reste explicite.
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { isSupportSessionActive } from '@/lib/supportSession';
import { isPreviewActive } from '@/contexts/PreviewModeContext';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { Modal, Skel } from '@/crm/ui/kit';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { useCrmToast } from '@/crm/ui/toast';
import { useCrmT } from '@/crm/i18n';
import { useCrmScope } from '@/crm/scope';
import { Card, CardHead } from './accountUi';

interface Grant { id: string; status: string; reason: string | null; approved_at: string | null; revoked_at: string | null; expires_at: string | null; created_at: string; initiated_by: string | null }
interface Session { id: string; status: string; created_at: string; ended_at: string | null; expires_at: string }
interface Audit { id: string; action: string; table_name: string | null; created_at: string }

const open = (g: { expires_at: string | null }) => !g.expires_at || new Date(g.expires_at) > new Date();
const KNOWN = ['grant_approved', 'grant_revoked', 'session_opened', 'session_ended', 'help_requested', 'insert', 'update', 'delete'];

function useSupportState(uid: string | undefined) {
  return useQuery({
    queryKey: ['crm', 'support-access', uid],
    enabled: !!uid,
    staleTime: 10_000,
    queryFn: async () => {
      const [g, s, a] = await Promise.all([
        supabase.from('admin_support_grants').select('id, status, reason, approved_at, revoked_at, expires_at, created_at, initiated_by')
          .eq('target_user_id', uid as string).order('created_at', { ascending: false }).limit(20),
        supabase.from('admin_support_sessions').select('id, status, created_at, ended_at, expires_at')
          .eq('target_user_id', uid as string).order('created_at', { ascending: false }).limit(20),
        supabase.from('admin_support_audit').select('id, action, table_name, created_at')
          .eq('target_user_id', uid as string).order('created_at', { ascending: false }).limit(60),
      ]);
      // Une liste illisible n'est pas une liste vide : « aucune session » serait faux.
      if (g.error) throw g.error;
      if (s.error) throw s.error;
      if (a.error) throw a.error;
      return { grants: (g.data ?? []) as Grant[], sessions: (s.data ?? []) as Session[], audit: (a.data ?? []) as Audit[] };
    },
  });
}

export function AccountSupport() {
  const { t, dShort, time } = useCrmT();
  const toast = useCrmToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { space, qk } = useCrmScope();
  const holder = space.role === 'owner';
  // Une session d'assistance ou un aperçu démo voient la page, sans les boutons
  // (le serveur refuserait de toute façon : l'accord est celui du titulaire).
  const assisted = isSupportSessionActive() || isPreviewActive();
  const q = useSupportState(holder ? user?.id : undefined);
  const [params, setParams] = useSearchParams();
  const [decide, setDecide] = useState<Grant | null>(null);
  const [cut, setCut] = useState<Grant | null>(null);
  const [busy, setBusy] = useState(false);
  const consumed = useRef(false);

  const grants = q.data?.grants ?? [];
  const pending = grants.find((g) => g.status === 'pending' && !g.revoked_at && open(g)) ?? null;
  const active = grants.find((g) => g.status === 'active' && !g.revoked_at && open(g)) ?? null;
  const live = (q.data?.sessions ?? []).find((s) => s.status === 'active' && new Date(s.expires_at) > new Date()) ?? null;

  // Arrivée depuis l'e-mail (?approve=…) : la décision s'ouvre une fois, d'elle-même.
  useEffect(() => {
    // Attend une lecture réussie : après un échec puis « Réessayer », la décision s'ouvre encore.
    if (consumed.current || !params.get('approve') || (holder && !q.data)) return;
    consumed.current = true;
    if (pending && !assisted) setDecide(pending);
    params.delete('approve');
    setParams(params, { replace: true });
  }, [holder, q.data, pending, params, setParams, assisted]);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['crm', 'support-access'] }); void qc.invalidateQueries({ queryKey: ['crm', qk, 'notifications'] }); };
  const run = async (fn: () => PromiseLike<{ error: unknown }>, done: string) => {
    if (busy) return false;
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) { toast(t('yc.acc.sup.err')); return false; }
    toast(t(done));
    refresh();
    return true;
  };
  const approve = (g: Grant) => run(() => supabase.rpc('approve_support_grant', { _grant_id: g.id }), 'yc.acc.sup.approved').then((ok) => { if (ok) setDecide(null); });
  const revoke = (g: Grant, done: string) => run(() => supabase.rpc('revoke_support_grant', { _grant_id: g.id }), done).then((ok) => { if (ok) { setDecide(null); setCut(null); } });
  const askHelp = () => run(() => supabase.rpc('request_support_help', { _reason: t('yc.acc.sup.askReason') }), 'yc.acc.sup.askDone');

  const auditLabel = (a: Audit) => `${t(`yc.acc.sup.a.${KNOWN.includes(a.action) ? a.action : 'update'}`)}${a.table_name ? ` · ${a.table_name}` : ''}`;
  const btn = { height: 44, padding: '0 20px', borderRadius: 99, fontWeight: 600, fontSize: 15, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 } as const;

  if (!holder) {
    return (
      <Card>
        <CardHead title={t('yc.acc.sup.t')} sub={t('yc.acc.sup.holderOnly')} />
      </Card>
    );
  }
  if (q.isLoading) return <Skel h={260} r={28} />;
  // Pas « aucun accès en cours » : la lecture a échoué, on n'en sait rien.
  if (q.isError && !q.data) return <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card>
        {pending ? (
          <>
            <CardHead title={t('yc.acc.sup.pendingT')} sub={t('yc.acc.sup.pendingS', { date: dShort(pending.created_at) })} />
            {pending.reason && <p style={{ margin: 0, padding: '12px 16px', borderRadius: 16, background: 'var(--sand-50)', fontSize: 14.5, lineHeight: 1.5, color: 'var(--sand-700)' }}>{t('yc.acc.sup.reason', { reason: pending.reason })}</p>}
            {!assisted && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Hv as="button" type="button" onClick={() => setDecide(pending)} style={{ ...btn, border: 0, background: 'var(--gradient-brand)', color: '#fff', boxShadow: 'var(--shadow-cta)' }} hover={{ filter: 'brightness(1.05)' }}>
                  <Icon name="shield" size={16} stroke={2.4} />{t('yc.acc.sup.review')}
                </Hv>
              </div>
            )}
          </>
        ) : active ? (
          <>
            <CardHead title={t('yc.acc.sup.activeT')} sub={t(active.initiated_by === 'client' ? 'yc.acc.sup.activeAsked' : 'yc.acc.sup.activeS', { date: dShort(active.approved_at ?? active.created_at) })} />
            {live && <p role="status" style={{ margin: 0, padding: '12px 16px', borderRadius: 16, background: 'var(--amber-50)', color: 'var(--amber-700)', fontSize: 14.5, lineHeight: 1.5 }}>{t('yc.acc.sup.live', { time: time(live.expires_at) })}</p>}
            {!assisted && (
              <div><Hv as="button" type="button" onClick={() => setCut(active)} style={{ ...btn, border: '1.5px solid var(--sand-200)', background: '#fff', color: 'var(--ink)' }} hover={{ background: 'var(--red-50)', color: 'var(--red-700)' }}>{t('yc.acc.sup.cut')}</Hv></div>
            )}
          </>
        ) : (
          <>
            <CardHead title={t('yc.acc.sup.noneT')} sub={t('yc.acc.sup.noneS')} />
            {!assisted && (
              <div><Hv as="button" type="button" disabled={busy} onClick={() => void askHelp()} style={{ ...btn, border: 0, background: 'var(--ink)', color: '#fff', opacity: busy ? 0.6 : 1 }} hover={{ background: 'var(--sand-700)' }}>
                <Icon name="message" size={16} stroke={2.4} />{t('yc.acc.sup.ask')}
              </Hv></div>
            )}
          </>
        )}
      </Card>

      <Card>
        <CardHead title={t('yc.acc.sup.rulesT')} sub={t('yc.acc.sup.rulesS')} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
          {(['can', 'cannot'] as const).map((k) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, borderRadius: 18, background: k === 'can' ? 'var(--green-50)' : 'var(--sand-50)' }}>
              <b style={{ fontSize: 14.5, color: k === 'can' ? 'var(--green-700)' : 'var(--ink)' }}>{t(`yc.acc.sup.${k}T`)}</b>
              {(['1', '2', '3', '4'] as const).map((i) => (
                <span key={i} style={{ display: 'flex', gap: 8, fontSize: 14, lineHeight: 1.45, color: 'var(--sand-700)' }}>
                  <Icon name={k === 'can' ? 'check' : 'lock'} size={14} stroke={2.4} style={{ flex: 'none', marginTop: 3 }} />{t(`yc.acc.sup.${k}${i}`)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHead title={t('yc.acc.sup.logT')} sub={t('yc.acc.sup.logS')} />
        {(q.data?.audit ?? []).length === 0
          ? <span style={{ fontSize: 14.5, color: 'var(--sand-500)' }}>{t('yc.acc.sup.noLog')}</span>
          : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {(q.data?.audit ?? []).map((a, i) => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--sand-100)' : 0, fontSize: 14.5 }}>
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{auditLabel(a)}</span>
                  <span style={{ flex: 'none', fontSize: 13, color: 'var(--sand-500)', fontVariantNumeric: 'tabular-nums' }}>{dShort(a.created_at)} · {time(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
      </Card>

      <Modal open={!!decide} onClose={() => setDecide(null)} width={520} label={t('yc.acc.sup.decideT')}>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.03em' }}>{t('yc.acc.sup.decideT')}</h2>
          <p style={{ margin: 0, fontSize: 15, color: 'var(--sand-600)', lineHeight: 1.55 }}>{t('yc.acc.sup.decideB')}</p>
          {decide?.reason && <p style={{ margin: 0, fontSize: 14.5, color: 'var(--sand-700)' }}>{t('yc.acc.sup.reason', { reason: decide.reason })}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <Hv as="button" type="button" disabled={busy} onClick={() => decide && void revoke(decide, 'yc.acc.sup.refused')} style={{ ...btn, border: 0, background: 'var(--sand-100)', color: 'var(--ink)' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.acc.sup.refuse')}</Hv>
            <Hv as="button" type="button" disabled={busy} onClick={() => decide && void approve(decide)} style={{ ...btn, border: 0, background: 'var(--ink)', color: '#fff', opacity: busy ? 0.6 : 1 }} hover={{ background: 'var(--sand-700)' }}>{t('yc.acc.sup.accept')}</Hv>
          </div>
        </div>
      </Modal>
      <Modal open={!!cut} onClose={() => setCut(null)} width={480} label={t('yc.acc.sup.cutT')}>
        <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.03em' }}>{t('yc.acc.sup.cutT')}</h2>
          <p style={{ margin: 0, fontSize: 15, color: 'var(--sand-600)', lineHeight: 1.55 }}>{t('yc.acc.sup.cutB')}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Hv as="button" type="button" onClick={() => setCut(null)} style={{ ...btn, border: 0, background: 'var(--sand-100)', color: 'var(--ink)' }} hover={{ background: 'var(--sand-200)' }}>{t('yc.common.cancel')}</Hv>
            <Hv as="button" type="button" disabled={busy} onClick={() => cut && void revoke(cut, 'yc.acc.sup.cutDone')} style={{ ...btn, border: 0, background: 'var(--red-600)', color: '#fff', opacity: busy ? 0.6 : 1 }}>{t('yc.acc.sup.cut')}</Hv>
          </div>
        </div>
      </Modal>
    </div>
  );
}
