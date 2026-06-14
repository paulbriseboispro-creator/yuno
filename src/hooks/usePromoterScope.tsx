import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { useVenueContext } from './useVenueContext';
import { useAuth } from './useAuth';

/**
 * Unified scope for promoter management — works for both venue (club) and organizer dashboards.
 *
 * Returns:
 *  - kind: 'venue' | 'organizer'
 *  - venueId / organizerId: the active context id
 *  - filterColumn: the column to filter promoters/templates/teams/etc by
 *  - filterValue: the value to filter by
 *  - loading: whether the scope is still resolving
 */
export type PromoterScope = {
  kind: 'venue' | 'organizer';
  venueId: string | null;
  organizerId: string | null;
  loading: boolean;
};

export function usePromoterScope(): PromoterScope {
  const { mode } = useDashboardMode();
  const { user, loading: authLoading } = useAuth();
  const { venue, loading: venueLoading } = useVenueContext();

  if (mode === 'organizer') {
    if (authLoading || !user) {
      return { kind: 'organizer', venueId: null, organizerId: null, loading: true };
    }
    return { kind: 'organizer', venueId: null, organizerId: user.id, loading: false };
  }

  if (venueLoading) {
    return { kind: 'venue', venueId: null, organizerId: null, loading: true };
  }
  return { kind: 'venue', venueId: venue?.id ?? null, organizerId: null, loading: !venue };
}
