// Réglages → Intégrations : les connexions externes du compte pro.
// Servie sur /owner/integrations et /organizer-app/integrations — la même page
// pour les deux dashboards (comme SupportAccessSettings). Un manager n'y a pas
// accès : ce sont des surfaces argent/identité (comme Stripe).
//
// Aujourd'hui une seule carte : Meta (Pixel + Conversions API). Les suivantes
// (Google, TikTok…) se posent ici, chacune sur le même modèle.

import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { OrgPage, OrgPageHeader } from '@/components/org-ui';
import { MetaConnectionCard } from '@/components/integrations/MetaConnectionCard';

export default function IntegrationsSettings() {
  const { t } = useLanguage();
  const { venueId, organizerUserId, scope, mode, loading } = useVenueContext();

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
          {ready && <MetaConnectionCard scope={metaScope} helpPath={helpPath} />}
        </div>
      </OrgPage>
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: '#000' }}>
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(255,255,255,.025),transparent 55%)' }} />
      <OwnerHeader title={t('integ.title')} />
      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 pt-2 space-y-5">
        <p style={{ color: 'rgba(255,255,255,0.58)', fontSize: 13.5, maxWidth: 720 }}>{t('integ.subtitle')}</p>
        {ready && <MetaConnectionCard scope={metaScope} helpPath={helpPath} />}
      </div>
    </div>
  );
}
