/**
 * Système › Offre et tarifs : « Combien coûte Yuno CRM, et que comprend
 * l'offre ? » Quatre onglets (`?tab=`) : Offre et prix (grille, seuil des 50
 * payants, historique des changements), E-mails du cycle de vie, Analyse
 * client, « Vos clients ». Tout changement de prix ou d'interrupteur demande
 * un motif (journal d'audit). Les interrupteurs de canaux vivent dans
 * Interrupteurs.
 */
import { Suspense } from 'react';
import { Page, Tabs, Verdict, useAdminT, useTab } from '@/admin/ui';
import { fmtEur, fmtNum } from '@/lib/adminFormat';
import { usePriceTier } from './pricingData';
import { useAdminPricing } from '@/crm/admin/data';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { PageBoundary } from '../shell/frames';
import { PageLoading } from '../shell/AdminShell';

const PricingOffer = lazyWithRetry(() => import('./PricingOffer'));
const PricingLifecycle = lazyWithRetry(() => import('./PricingLifecycle'));
const PricingAnalysis = lazyWithRetry(() => import('./PricingAnalysis'));
const PricingCustomers = lazyWithRetry(() => import('./PricingCustomers'));

export default function Pricing() {
  const { t, lang } = useAdminT();
  const q = useAdminPricing();
  const tabs = [
    { value: 'offer', label: t('adm.sys.pr.tab.offer') },
    { value: 'lifecycle', label: t('adm.sys.pr.tab.lifecycle') },
    { value: 'analysis', label: t('adm.sys.pr.tab.analysis') },
    { value: 'customers', label: t('adm.sys.pr.tab.customers') },
  ];
  const [tab, setTab] = useTab(tabs);
  const tier = usePriceTier();
  const cfg = q.data?.cfg;
  const td = tier.data;
  const eur = (v: number | null | undefined) => fmtEur(v ?? 0, lang, { cents: false });
  return (
    <Page title={t('adm.sys.pr.title')} subtitle={t('adm.sys.pr.sub')}>
      {cfg && td && (
        <Verdict tone={td.tier === 'public' || !td.public_active ? 'neutral' : 'positive'} kicker={t('adm.sys.pr.vKicker')}
          headline={t(td.tier === 'public' ? 'adm.sys.pr.vPublic' : 'adm.sys.pr.vLaunch', { m: eur(td.tier === 'public' ? cfg.price_month_next : cfg.price_month), y: eur(cfg.price_year) })}
          sub={td.tier === 'public' ? t('adm.sys.pr.vPublicSub', { n: fmtNum(td.paying ?? 0, lang) })
            : t('adm.sys.pr.vLaunchSub', { n: fmtNum(td.paying ?? 0, lang), at: fmtNum(td.switch_at ?? cfg.price_switch_at, lang), next: eur(cfg.price_month_next), left: fmtNum(Math.max(0, (td.switch_at ?? cfg.price_switch_at) - (td.paying ?? 0)), lang) })} />
      )}
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
