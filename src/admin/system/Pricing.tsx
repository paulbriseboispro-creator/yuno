/**
 * Système › Offre et tarifs : « Combien coûte Yuno CRM, et que comprend
 * l'offre ? » En-tête et onglets au kit. Le contenu des onglets (grille des
 * prix, e-mails du cycle de vie, analyse client, « Vos clients », historique)
 * reste celui de l'ex-Admin CRM, dans son cadre : seuls les interrupteurs de
 * canaux ont déménagé dans Interrupteurs.
 */
import { Page, Tabs, useAdminT, useTab } from '@/admin/ui';
import { useAdminPricing } from '@/crm/admin/data';
import { Editor, AuditTab } from '@/crm/admin/pages/SettingsPage';
import LifecycleTab from '@/crm/admin/pages/LifecycleTab';
import { LearningTab } from '@/crm/admin/pages/LearningTab';
import { CustomerBasisTab } from '@/crm/admin/pages/CustomerBasisAdmin';
import PriceTierCard from '@/crm/admin/pages/PriceTierCard';
import { CrmFrame } from '../shell/frames';

export default function Pricing() {
  const { t } = useAdminT();
  const q = useAdminPricing();
  const tabs = [
    { value: 'offer', label: t('adm.sys.pr.tab.offer') },
    { value: 'lifecycle', label: t('adm.sys.pr.tab.lifecycle') },
    { value: 'analysis', label: t('adm.sys.pr.tab.analysis') },
    { value: 'customers', label: t('adm.sys.pr.tab.customers') },
    { value: 'history', label: t('adm.sys.pr.tab.history') },
  ];
  const [tab, setTab] = useTab(tabs);
  return (
    <Page title={t('adm.sys.pr.title')} subtitle={t('adm.sys.pr.sub')}>
      <Tabs items={tabs} value={tab} onChange={setTab} />
      <CrmFrame>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {tab === 'lifecycle' ? <LifecycleTab />
            : tab === 'analysis' ? <LearningTab />
            : tab === 'customers' ? <CustomerBasisTab />
            : !q.data ? <div className="a-skel h-64" />
            : tab === 'history' ? <AuditTab history={q.data.history} />
            : <><PriceTierCard /><Editor cfg={q.data.cfg} mode="offer" /></>}
        </div>
      </CrmFrame>
    </Page>
  );
}
