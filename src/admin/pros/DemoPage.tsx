/**
 * « Quels prospects regardent une démo ? » (`/admin/pros/demo`).
 * Une page pour les liens d'aperçu des deux produits. Les deux écrans sont
 * encore ceux d'avant (cadres hérités) : la Billetterie (lien d'aperçu,
 * compte à créer) et Yuno CRM (accès démo, contact, invitation liée).
 */
import { Suspense } from 'react';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { Page, Tabs, useAdminT, useTab } from '@/admin/ui';
import { CrmFrame, SuiteFrame } from '../shell/frames';

const SuiteDemo = lazyWithRetry(() => import('@/pages/admin/AdminDemoAccess'));
const CrmDemo = lazyWithRetry(() => import('@/crm/admin/pages/DemoPage'));

export default function DemoPage() {
  const { t } = useAdminT();
  const items = [{ value: 'tickets', label: t('adm.pros.product.tickets') }, { value: 'crm', label: 'Yuno CRM' }];
  const [tab, setTab] = useTab(items);
  const fallback = <div className="a-skel m-6 h-40" />;
  return (
    <Page title={t('adm.pros.demo.title')} subtitle={t('adm.pros.demo.sub')}>
      <Tabs items={items} value={tab} onChange={setTab} />
      <div className="a-card overflow-hidden">
        {tab === 'crm'
          ? <CrmFrame><Suspense fallback={fallback}><CrmDemo /></Suspense></CrmFrame>
          : <SuiteFrame><Suspense fallback={fallback}><SuiteDemo /></Suspense></SuiteFrame>}
      </div>
    </Page>
  );
}
