import { useContext, useEffect, useState } from 'react';
import { useDashboardMode } from '@/contexts/DashboardModeContext';
import { useOwnerVenue } from '@/hooks/useOwnerVenue';
import { ManagerVenueContext } from '@/contexts/ManagerVenueContext';
import { useAuth } from '@/hooks/useAuth';

interface VenueData {
  id: string;
  name: string;
  city: string;
  address?: string;
  coverUrl?: string;
  logoUrl?: string;
  floorPlanUrl?: string;
  legalName?: string;
  siret?: string;
  vatNumber?: string;
}

interface VenueContextResult {
  venueId: string | null;
  venue: VenueData | null;
  loading: boolean;
  error: string | null;
  mode: 'owner' | 'manager' | 'organizer';
  /** Scope of this dashboard: a real venue, or an independent organizer (no venue). */
  scope: 'venue' | 'organizer';
  /** When scope === 'organizer', this is the organizer's user id (events.organizer_user_id). */
  organizerUserId: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook that returns dashboard scope information based on the current dashboard mode.
 *
 * - owner / manager → scoped to a venue (venueId is the club id).
 * - organizer       → scoped to a user (organizerUserId is the auth.uid of the organizer).
 *                      venueId stays null because organizers don't own a club.
 */
export function useVenueContext(): VenueContextResult {
  const { mode } = useDashboardMode();
  const { user } = useAuth();
  const ownerVenue = useOwnerVenue();
  const managerContext = useContext(ManagerVenueContext);

  // Organizer mode: no venue, scope by user id.
  if (mode === 'organizer') {
    return {
      venueId: null,
      venue: null,
      loading: !user,
      error: null,
      mode,
      scope: 'organizer',
      organizerUserId: user?.id ?? null,
      refetch: async () => {},
    };
  }

  if (mode === 'manager' && managerContext) {
    return {
      venueId: managerContext.venueId,
      venue: managerContext.venue,
      loading: managerContext.loading,
      error: managerContext.error,
      mode,
      scope: 'venue',
      organizerUserId: null,
      refetch: managerContext.refetch,
    };
  }

  // Default to owner
  return {
    venueId: ownerVenue.venueId,
    venue: ownerVenue.venue,
    loading: ownerVenue.loading,
    error: ownerVenue.error,
    mode,
    scope: 'venue',
    organizerUserId: null,
    refetch: ownerVenue.refetch,
  };
}
