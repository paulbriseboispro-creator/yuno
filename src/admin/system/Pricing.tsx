/**
 * Système › Offre et tarifs : « Combien coûte Yuno CRM, et que comprend
 * l'offre ? » Quatre onglets (`?tab=`) : Offre et prix (grille, seuil des 50
 * payants, historique des changements), E-mails du cycle de vie, Analyse
 * client, « Vos clients ». Tout changement de prix ou d'interrupteur demande
 * un motif (journal d'audit). Les interrupteurs de canaux vivent dans
 * Interrupteurs.
 */
import { Suspense } from 'react';
import { Page, Tabs, useAdminT, useTab } from '@/admin/ui';
import { useAdminPricing } from '@/crm/admin/data';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { PageBoundary } from '../shell/frames';
import { PageLoading } from '../shell/AdminShell';

const PricingOffer = lazyWithRetry(() => import('./PricingOffer'));
const PricingLifecycle = lazyWithRetry(() => import('./PricingLifecycle'));
const PricingAnalysis = lazyWithRetry(() => import('./PricingAnalysis'));
const PricingCustomers = lazyWithRetry(() => import('./PricingCustomers'));

export default function Pricing() {
  const { t } = useAdminT();
  const q = useAdminPricing();
  const tabs = [
    { value: 'offer', label: t('adm.sys.pr.tab.offer') },
    { value: 'lifecycle', label: t('adm.sys.pr.tab.lifecycle') },
    { value: 'analysis', label: t('adm.sys.pr.tab.analysis') },
    { value: 'customers', label: t('adm.sys.pr.tab.customers') },
  ];
  const [tab, setTab] = useTab(tabs);
  return (
    <Page title={t('adm.sys.pr.title')} subtitle={t('adm.sys.pr.sub')}>
      <Tabs items={tabs} value={tab} onChange={setTab} />
      <PageBoundary resetKey={tab}>
        <Suspense fallback={<PageLoading />}>
          {tab === 'offer' && <PricingOffer pricing={q} onChanged={() => void q.refetch()} />}
          {tab === 'lifecycle' && <PricingLifecycle />}
          {tab === 'analysis' && <PricingAnalysis />}
          {tab === 'customers' && <PricingCustomers />}
        </Suspense>
      </PageBoundary>
    </Page>
  );
}
