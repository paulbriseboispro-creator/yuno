/**
 * Pilotage › Produit et usage : « Que font les gens de Yuno ? »
 * Trois onglets (adresse `?tab=`) : Signaux (ce que font les clients et les
 * pros), IA (assistants et connecteur MCP), CRM (usage, rétention, NPS,
 * demandes). Chaque onglet porte ses propres chiffres.
 */
import { Suspense } from 'react';
import { Page, Tabs, useAdminT, useTab } from '@/admin/ui';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { PageBoundary } from '../shell/frames';
import { PageLoading } from '../shell/AdminShell';

const ProductSignals = lazyWithRetry(() => import('./ProductSignals'));
const ProductAi = lazyWithRetry(() => import('./ProductAi'));
const ProductCrm = lazyWithRetry(() => import('./ProductCrm'));

export default function ProductPage() {
  const { t } = useAdminT();
  const items = [
    { value: 'signals', label: t('adm.pil.prod.tab.signals') },
    { value: 'ai', label: t('adm.pil.prod.tab.ai') },
    { value: 'crm', label: t('adm.pil.prod.tab.crm') },
  ];
  const [tab, setTab] = useTab(items);

  return (
    <Page title={t('adm.pil.prod.title')} subtitle={t('adm.pil.prod.sub')} period={tab !== 'crm'}>
      <Tabs items={items} value={tab} onChange={setTab} />
      <PageBoundary resetKey={tab}>
        <Suspense fallback={<PageLoading />}>
          {tab === 'signals' && <ProductSignals />}
          {tab === 'ai' && <ProductAi />}
          {tab === 'crm' && <ProductCrm />}
        </Suspense>
      </PageBoundary>
    </Page>
  );
}
