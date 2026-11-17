/**
 * Système › Connecteurs › plan d'une soirée : « Que dirait le plan de soirée à
 * ce prospect ? » Le plan d'un compte en essai, lu par le super admin avant
 * l'appel de 15 minutes. Même calcul que la Console (crm_night_plan, ouvert au
 * super admin par crm_scope_allowed), en lecture seule : aucun envoi, aucune
 * écriture, des agrégats seulement. Le titre, les états et le retour sont au
 * kit ; le rapport lui-même est celui de la Console (NightPlanReport), qui
 * garde son cadre CRM : c'est le même écran que verra le pro.
 */
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, EmptyState, ErrorState, Page, useAdminT } from '@/admin/ui';
import { useCrmT } from '@/crm/i18n';
import { NightPlanReport } from '@/crm/pages/nights/plan/NightPlanReport';
import type { NightPlan } from '@/crm/data/plan';
import { CrmFrame } from '../shell/frames';
import { rpc } from './data';

export default function NightPlanPage() {
  const { t } = useAdminT();
  return (
    <CrmFrame>
      <PlanBody tAdmin={t} />
    </CrmFrame>
  );
}

function PlanBody({ tAdmin }: { tAdmin: (k: string, v?: Record<string, string | number>) => string }) {
  const { scope = '', event = '' } = useParams();
  const account = useSearchParams()[0].get('n')?.trim() || '';
  const T = useCrmT();
  const navigate = useNavigate();
  const cut = scope.indexOf(':');
  const kind = scope.slice(0, cut);
  const id = scope.slice(cut + 1);
  const args = kind === 'venue' ? { p_venue_id: id, p_organizer_user_id: null } : { p_venue_id: null, p_organizer_user_id: id };
  const q = useQuery({
    queryKey: ['admin', 'system', 'night-plan', scope, event],
    enabled: cut > 0 && !!id && !!event,
    staleTime: 60_000,
    queryFn: () => rpc<NightPlan>('crm_night_plan', { ...args, p_event_id: event }),
  });
  const d = q.data;
  return (
    <Page title={account || tAdmin('adm.sys.np.title')} subtitle={tAdmin('adm.sys.np.sub')} width="narrow"
      actions={<button type="button" className="a-btn a-btn--sm" onClick={() => navigate(-1)}>{tAdmin('adm.sys.np.back')}</button>}>
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} />
        : !d ? <div aria-busy="true" className="a-skel h-64" />
          : !d.ok ? <Card><EmptyState title={T.t(d.error === 'not_upcoming' || d.error === 'no_upcoming' ? `yc.ag.plan.err.${d.error}` : 'yc.ni.dr.notFound')} /></Card>
            : <NightPlanReport d={d} T={T} at={q.dataUpdatedAt} writable={false} />}
    </Page>
  );
}
