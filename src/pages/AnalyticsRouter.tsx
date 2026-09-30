/**
 * Aiguillage Analytics : le nouvel écran (v3) ou l'ancien (quatre familles),
 * selon `src/lib/analytics/an3Flag.ts`. Les deux pages restent des chunks
 * séparés : personne ne télécharge l'écran qu'il ne voit pas.
 */
import { lazy, Suspense } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useActingOrganizer } from '@/hooks/useActingOrganizer';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { OrgPageHeader } from '@/components/org-ui';
import { isAnalyticsV3 } from '@/lib/analytics/an3Flag';

const LegacyOwnerAnalytics = lazy(() => import('./OwnerAnalytics'));
const LegacyOrgAppAnalytics = lazy(() => import('./organizer-app/OrgAppAnalytics'));
const AnalyticsV3 = lazy(() => import('@/components/analytics/v3/AnalyticsV3').then((m) => ({ default: m.AnalyticsV3 })));

/** /owner/analytics et /manager/analytics. */
export default function OwnerAnalyticsRoute() {
  const [params] = useSearchParams();
  const { t } = useLanguage();
  const { venueId } = useVenueContext();
  const consolePrefix = useLocation().pathname.replace(/\/$/, '').replace(/\/analytics$/, '');
  if (!isAnalyticsV3(params)) return <Suspense fallback={<OwnerPageSkeleton />}><LegacyOwnerAnalytics /></Suspense>;
  return (
    <Suspense fallback={<OwnerPageSkeleton />}>
      <AnalyticsV3 scope={{ venueId }} consolePrefix={consolePrefix} header={<OwnerHeader title={t('owner.analytics')} />} />
    </Suspense>
  );
}

/** /organizer-app/analytics. */
export function OrgAnalyticsRoute() {
  const [params] = useSearchParams();
  const { t } = useLanguage();
  const { organizerId } = useActingOrganizer();
  if (!isAnalyticsV3(params)) return <Suspense fallback={<OwnerPageSkeleton />}><LegacyOrgAppAnalytics /></Suspense>;
  return (
    <Suspense fallback={<OwnerPageSkeleton />}>
      <AnalyticsV3 scope={{ organizerUserId: organizerId }} consolePrefix="/organizer-app"
        header={<div className="mx-auto max-w-[1440px] px-4 sm:px-6 pt-4"><OrgPageHeader title={t('owner.analytics')} /></div>} />
    </Suspense>
  );
}
