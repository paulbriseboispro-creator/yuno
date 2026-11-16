/**
 * Pilotage › Produit et usage : « Que font les gens de Yuno ? ».
 * Trois onglets (Signaux produit, IA et MCP, Yuno CRM). Les en-têtes et les
 * chiffres clés sont réécrits avec le kit ; le DÉTAIL de chaque onglet reste
 * l'écran hérité dans son cadre (AdminProduct, AdminAi, ProductPage du CRM),
 * jusqu'au lot 7.
 */
import { Suspense } from 'react';
import { ErrorState, Kpi, KpiRow, Page, Tabs, useAdminFilters, useAdminT, useTab } from '@/admin/ui';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { fmtNum, fmtUsd } from '@/lib/adminFormat';
import { CrmFrame, PageBoundary, SuiteFrame } from '../shell/frames';
import { PageLoading } from '../shell/AdminShell';
import { useAiUsage, useCrmProduct } from './data';

const AdminProduct = lazyWithRetry(() => import('@/pages/admin/AdminProduct'));
const AdminAi = lazyWithRetry(() => import('@/pages/admin/AdminAi'));
const CrmProduct = lazyWithRetry(() => import('@/crm/admin/pages/ProductPage'));

export default function ProductPage() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const items = [
    { value: 'signals', label: t('adm.pil.prod.tab.signals') },
    { value: 'ai', label: t('adm.pil.prod.tab.ai') },
    { value: 'crm', label: t('adm.pil.prod.tab.crm') },
  ];
  const [tab, setTab] = useTab(items);
  const ai = useAiUsage(range, includeDemo);
  const crm = useCrmProduct(includeDemo);
  const a = ai.data?.totals;

  return (
    <Page title={t('adm.pil.prod.title')} subtitle={t('adm.pil.prod.sub')} period>
      {ai.error && !a ? <ErrorState onRetry={() => void ai.refetch()} /> : (
        <KpiRow>
          <Kpi label={t('adm.pil.prod.aiEvents')} loading={!a} value={fmtNum(a?.events, lang)} current={a?.events} previous={a?.prev_events} invert={false} />
          <Kpi label={t('adm.pil.prod.aiCost')} hint={t('adm.pil.prod.aiCost.hint')} loading={!a} value={fmtUsd(a?.cost_usd, lang)}
            current={a?.cost_usd} previous={a?.prev_cost_usd} invert to="/admin/money/costs" />
          <Kpi label={t('adm.pil.prod.aiUsers')} loading={!a} value={fmtNum(a?.users, lang)} />
          <Kpi label={t('adm.pil.prod.crmLive')} hint={t('adm.pil.prod.crmLive.hint')} loading={!crm.data} value={fmtNum(crm.data?.live, lang)} to="/admin/pros?product=crm" />
          <Kpi label={t('adm.pil.prod.crmPaid')} loading={!crm.data} value={fmtNum(crm.data?.paid, lang)} to="/admin/money/crm" />
        </KpiRow>
      )}
      <Tabs items={items} value={tab} onChange={setTab} />
      <p className="a-t3 -mt-3 text-[12px]">{t('adm.pil.prod.legacyNote')}</p>
      <div className="-mx-5 md:-mx-8">
        <PageBoundary resetKey={tab}>
          <Suspense fallback={<PageLoading />}>
            {tab === 'signals' && <SuiteFrame><AdminProduct /></SuiteFrame>}
            {tab === 'ai' && <SuiteFrame><AdminAi /></SuiteFrame>}
            {tab === 'crm' && <CrmFrame><CrmProduct /></CrmFrame>}
          </Suspense>
        </PageBoundary>
      </div>
    </Page>
  );
}
