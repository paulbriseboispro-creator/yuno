/**
 * Yuno Tickets › Analyses › Communauté : les trois vues de l'ancienne Analytics
 * que le lot 5 du plan combiné redessinera (décision de Paul du 24/10, à la
 * bascule : les garder joignables, ne rien perdre). Abonnés (croissance, portée
 * push, revenu des abonnés), Achats (comportement d'achat) et Public (âge, genre,
 * goûts musicaux) gardent leurs composants, dans la période choisie en haut.
 */
import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { Megaphone } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { AudienceDashboard } from '@/components/audience/AudienceDashboard';
import { PurchaseBehaviorView } from '@/components/analytics/PurchaseBehaviorView';
import { EventAudienceDemographics } from '@/components/analytics/EventAudienceDemographics';
import { AudienceInsights } from '@/components/analytics/AudienceInsights';
import { CommunityTastesView } from '@/components/analytics/families/CommunityTastesView';
import type { DateRange } from '@/hooks/useAnalyticsData';
import { useTixScope } from '@/tickets/analytics/scope';
import type { AnaPeriod } from '@/tickets/analytics/data';
import { periodWindow, type CommunityMoreView } from './communityMoreViews';

const LEGACY_RANGE: Record<AnaPeriod, DateRange> = { '24h': '24h', '48h': '48h', '7d': '7days', '30d': '30days', '90d': 'alltime', '12m': 'alltime' };

export function CommunityMore({ view, period }: { view: CommunityMoreView; period: AnaPeriod }) {
  const { t } = useLanguage();
  const { basePath } = useDashboardMode();
  const { rpc } = useTixScope();
  const venueId = rpc.p_venue_id ?? null;
  const organizerId = rpc.p_organizer_user_id ?? null;
  const win = useMemo(() => periodWindow(period), [period]);

  if (view === 'subscribers') {
    const subject = venueId ? { type: 'venue' as const, id: venueId } : organizerId ? { type: 'organizer' as const, id: organizerId } : null;
    if (!subject) return null;
    return (
      <AudienceDashboard
        subject={subject}
        actions={(
          <Link
            to={`${basePath}/push`}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{ background: '#E8192C', color: '#fff' }}
          >
            <Megaphone className="w-4 h-4" />
            {t('anf.notifyFollowers')}
          </Link>
        )}
      />
    );
  }
  if (view === 'purchase') {
    return <PurchaseBehaviorView venueId={venueId} organizerUserId={organizerId} dateRange={LEGACY_RANGE[period]} windowRange={win} />;
  }
  const scope = venueId ? { kind: 'venue' as const, id: venueId } : { kind: 'organizer' as const, id: organizerId as string };
  return (
    <div className="space-y-4">
      <EventAudienceDemographics scope={scope} from={win.from} to={win.to} />
      {organizerId && <AudienceInsights scope={scope} from={win.from} to={win.to} />}
      <CommunityTastesView scope={venueId ? { venueId } : { organizerUserId: organizerId }} />
    </div>
  );
}
