/**
 * Accueil de l'admin, rubrique « Aujourd'hui » (lot 1) : qu'est-ce qui
 * demande une décision aujourd'hui ?
 *   1. la semaine en six chiffres, comparée à la précédente ;
 *   2. la file unique `admin_today` (une ligne par chose à faire, son action,
 *      « Traité », « Plus tard ») ;
 *   3. quatre feux de santé (bloc `health` d'admin_cockpit) ;
 *   4. un fil d'activité Billetterie + CRM.
 * L'ancien Cockpit vit sous Pilotage ; l'ancien « à faire » CRM est dans la file.
 */
import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { fmtEur, fmtNum } from '@/lib/adminFormat';
import { Kpi, KpiRow, Page, Section, useAdminFilters, useAdminT } from '@/admin/ui';
import { TODAY_KEY, useCockpit, useToday } from './data';
import { TodayQueue } from './TodayQueue';
import { HealthLights } from './HealthLights';
import { moneyHintKey, moneyLabelKey } from '../money/terms';
import { ActivityFeed } from './ActivityFeed';

export default function TodayHome() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const qc = useQueryClient();
  const today = useToday(includeDemo);
  const cockpit = useCockpit(includeDemo);
  const k = today.data?.kpis;
  const gmv = cockpit.data;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: TODAY_KEY });
    void cockpit.refetch();
  };

  return (
    <Page title={t('adm.today.title')} subtitle={t('adm.today.subtitle')}
      actions={(
        <button type="button" className="a-btn a-btn--sm" onClick={refresh} disabled={today.isFetching}>
          <RefreshCw className="h-3.5 w-3.5" />{t('adm.today.refresh')}
        </button>
      )}>
      <Section title={t('adm.today.kpi.title')} description={t('adm.today.kpi.desc')}>
        <KpiRow>
          <Kpi label={t(moneyLabelKey('sales'))} hint={t(moneyHintKey('sales'))} loading={!gmv}
            value={fmtEur(gmv?.week.gmv, lang)} current={gmv?.week.gmv} previous={gmv?.prev_week.gmv} to="/admin/money" />
          <Kpi label={t(moneyLabelKey('fees'))} hint={t(moneyHintKey('fees'))} loading={!k}
            value={fmtEur(k?.revenue.cur, lang)} current={k?.revenue.cur} previous={k?.revenue.prev} to="/admin/money" />
          <Kpi label={t(moneyLabelKey('mrr'))} hint={t(moneyHintKey('mrr'))} loading={!k}
            value={fmtEur(k?.mrr.cur, lang)} current={k?.mrr.cur} previous={k?.mrr.prev} to="/admin/money/crm" />
          <Kpi label={t('adm.today.kpi.newPros')} hint={t('adm.today.kpi.newPros.hint')} loading={!k}
            value={fmtNum(k?.new_pros.cur, lang)} current={k?.new_pros.cur} previous={k?.new_pros.prev} to="/admin/pilot/acquisition" />
          <Kpi label={t('adm.today.kpi.activePros')} hint={t('adm.today.kpi.activePros.hint')} loading={!k}
            value={fmtNum(k?.active.cur, lang)} current={k?.active.cur} previous={k?.active.prev} to="/admin/pros" />
          <Kpi label={t('adm.today.kpi.buyers')} hint={t('adm.today.kpi.buyers.hint')} loading={!k}
            value={fmtNum(k?.buyers.cur, lang)} current={k?.buyers.cur} previous={k?.buyers.prev} to="/admin/clients" />
        </KpiRow>
      </Section>

      <TodayQueue items={today.data?.items} loading={today.isLoading} error={today.error} onRetry={() => void today.refetch()} />

      <HealthLights health={cockpit.data?.health} loading={cockpit.isLoading} error={cockpit.error} onRetry={() => void cockpit.refetch()} />

      <ActivityFeed includeDemo={includeDemo} />
    </Page>
  );
}
