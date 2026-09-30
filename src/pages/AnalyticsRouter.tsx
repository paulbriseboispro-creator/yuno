/**
 * Analytics (v3) : le même écran pour la Console Club, Manager et Organisateur,
 * chacun avec sa portée. L'ancien écran (quatre familles) a été retiré en phase 2.
 */
import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { useVenueContext } from '@/hooks/useVenueContext';
import { useActingOrganizer } from '@/hooks/useActingOrganizer';
import { OwnerHeader } from '@/components/OwnerHeader';
import { OwnerPageSkeleton } from '@/components/DashboardSkeleton';
import { OrgPageHeader } from '@/components/org-ui';

const AnalyticsV3 = lazy(() => import('@/components/analytics/v3/AnalyticsV3').then((m) => ({ default: m.AnalyticsV3 })));

/** /owner/analytics et /manager/analytics. */
export default function OwnerAnalyticsRoute() {
  const { t } = useLanguage();
  const { venueId } = useVenueContext();
  const consolePrefix = useLocation().pathname.replace(/\/$/, '').replace(/\/analytics$/, '');
  return (
    <Suspense fallback={<OwnerPageSkeleton />}>
      <AnalyticsV3 scope={{ venueId }} consolePrefix={consolePrefix} header={<OwnerHeader title={t('owner.analytics')} />} />
    </Suspense>
  );
}

/** /organizer-app/analytics. */
export function OrgAnalyticsRoute() {
  const { t } = useLanguage();
  const { organizerId } = useActingOrganizer();
  return (
    <Suspense fallback={<OwnerPageSkeleton />}>
      <AnalyticsV3 scope={{ organizerUserId: organizerId }} consolePrefix="/organizer-app"
        header={<div className="mx-auto max-w-[1440px] px-4 sm:px-6 pt-4"><OrgPageHeader title={t('owner.analytics')} /></div>} />
    </Suspense>
  );
}
