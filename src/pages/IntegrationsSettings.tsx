// Réglages → Intégrations : les connexions externes du compte pro.
// Servie sur /owner/integrations et /organizer-app/integrations — la même page
// pour les deux dashboards (comme SupportAccessSettings). Un manager n'y a pas
// accès : ce sont des surfaces argent/identité (comme Stripe).
//
// Deux cartes : Meta (Pixel + Conversions API) et la billetterie connectée
// (Shotgun, Yuno CRM — réservée au super admin, à la démo et aux comptes bêta
// tant que CRM_CONNECTORS_LIVE est à false). Les suivantes (Google, TikTok…)
// se posent ici, chacune sur le même modèle.

import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { OrgPage, OrgPageHeader } from '@/components/org-ui';
import { MetaConnectionCard } from '@/components/integrations/MetaConnectionCard';
import { useMetaIntegrationLive } from '@/lib/metaIntegration';
import { TicketingConnectionCard } from '@/components/integrations/TicketingConnectionCard';
import { useTicketingConnectorsLive } from '@/lib/crmProduct';

export default function IntegrationsSettings() {
  const { t } = useLanguage();
  const { venueId, organizerUserId, scope, mode, loading } = useVenueContext();
  const metaLive = useMetaIntegrationLive();
  const ticketingLive = useTicketingConnectorsLive();

  if (loading) return <OwnerPageSkeleton />;

  const metaScope = scope === 'organizer'
    ? { organizerUserId }
    : { venueId };
  const helpPath = mode === 'organizer' ? '/organizer-app/help' : '/owner/help';
  const ready = scope === 'organizer' ? !!organizerUserId : !!venueId;

  if (mode === 'organizer') {
    return (
      <OrgPage>
        <OrgPageHeader title={t('integ.title')} subtitle={t('integ.subtitle')} />
        <div className="space-y-5">
          {ready && ticketingLive && <TicketingConnectionCard scope={metaScope} />}
          {ready && <MetaConnectionCard scope={metaScope} helpPath={helpPath} live={metaLive} returnTo="/organizer-app/integrations" />}
        </div>
      </OrgPage>
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: 'var(--sf-000000)' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgb(var(--ink)/.025),transparent 55%)' }} />
      <OwnerHeader title={t('integ.title')} />
      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-5">
        <p style={{ color: 'rgb(var(--ink)/var(--ink-a58,0.58))', fontSize: 13.5, maxWidth: 720 }}>{t('integ.subtitle')}</p>
        {ready && ticketingLive && <TicketingConnectionCard scope={metaScope} />}
        {ready && <MetaConnectionCard scope={metaScope} helpPath={helpPath} live={metaLive} returnTo="/owner/integrations" />}
      </div>
    </div>
  );
}
