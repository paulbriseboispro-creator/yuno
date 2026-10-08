/**
 * Admin CRM › audit d'un prospect (agents, lot A5) : le plan de soirée d'un
 * compte en essai, lu par le super admin avant l'appel de 15 minutes. Même
 * calcul que la Console (crm_night_plan, ouvert au super admin par
 * crm_scope_allowed), en lecture seule : aucun envoi, aucune écriture, des
 * agrégats seulement.
 */
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useCrmT } from '@/crm/i18n';
import { rpc } from '@/crm/lib/rpc';
import { Skel } from '@/crm/ui/kit';
import { CrmLoadError } from '@/crm/errors/CrmLoadError';
import { NightPlanReport } from '@/crm/pages/nights/plan/NightPlanReport';
import type { NightPlan } from '@/crm/data/plan';
import { ADMIN_ROUTES } from '../adminNav';
import { PageHead, pageWrap } from '../ui';

export default function NightPlanAdminPage() {
  const { scope = '', event = '' } = useParams();
  const account = useSearchParams()[0].get('n')?.trim() || '';
  const T = useCrmT();
  const { t } = T;
  const cut = scope.indexOf(':');
  const kind = scope.slice(0, cut);
  const id = scope.slice(cut + 1);
  const args = kind === 'venue' ? { p_venue_id: id, p_organizer_user_id: null } : { p_venue_id: null, p_organizer_user_id: id };
  const q = useQuery({
    queryKey: ['crm-admin', 'night-plan', scope, event],
    enabled: cut > 0 && !!id && !!event,
    staleTime: 60_000,
    queryFn: () => rpc<NightPlan>('crm_night_plan', { ...args, p_event_id: event }),
  });
  const d = q.data;
  return (
    <main style={pageWrap}>
      <PageHead
        kicker={t('adm.crm.pf.dy.auditKicker')}
        title={account || t('adm.crm.pf.dy.auditTitle')}
        sub={t('adm.crm.pf.dy.auditSub')}
        right={<Link to={`${ADMIN_ROUTES.platform}?tab=day`} style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{t('adm.crm.pf.dy.back')}</Link>}
      />
      <div style={{ maxWidth: 880, width: '100%', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {q.isError ? <CrmLoadError error={q.error} onRetry={() => { void q.refetch(); }} retrying={q.isFetching} />
          : !d ? <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}><Skel h={140} r={24} /><Skel h={260} r={24} /></div>
            : !d.ok ? <p style={{ fontSize: 14, color: 'var(--sand-600)' }}>{t(d.error === 'not_upcoming' || d.error === 'no_upcoming' ? `yc.ag.plan.err.${d.error}` : 'yc.ni.dr.notFound')}</p>
              : <NightPlanReport d={d} T={T} at={q.dataUpdatedAt} writable={false} />}
      </div>
    </main>
  );
}
