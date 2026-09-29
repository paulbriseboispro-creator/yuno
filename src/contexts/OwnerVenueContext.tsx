import { createContext, useContext, useEffect, useSyncExternalStore, ReactNode } from 'react';
import {
  ensureOwnerVenue, getOwnerVenueState, refetchOwnerVenue, subscribeOwnerVenue,
  type OwnerVenue,
} from '@/lib/ownerVenueStore';

interface OwnerVenueContextType {
  venue: OwnerVenue | null;
  venueId: string | null;
  loading: boolean;
  /** `no_venue_assigned` | `fetch_failed` | `Not authenticated` | null */
  error: string | null;
  refetch: () => Promise<void>;
}

const OwnerVenueContext = createContext<OwnerVenueContextType | undefined>(undefined);

/**
 * Club PROPRIÉTAIRE du compte (`venues.owner_id`) pour toute la Console Club.
 * Même lecture partagée que `useOwnerVenue()` (src/lib/ownerVenueStore.ts) :
 * la barre latérale, la garde et les pages ne relisent plus chacune le club.
 */
export function OwnerVenueProvider({ children }: { children: ReactNode }) {
  const s = useSyncExternalStore(subscribeOwnerVenue, getOwnerVenueState, getOwnerVenueState);
  useEffect(() => { void ensureOwnerVenue(); }, []);

  const venue = s.owned;
  const error = s.loading
    ? null
    : s.error === 'not_authenticated'
      ? 'Not authenticated'
      : s.error ?? (venue ? null : 'no_venue_assigned');

  return (
    <OwnerVenueContext.Provider value={{
      venue,
      venueId: venue?.id ?? null,
      loading: s.loading,
      error,
      refetch: refetchOwnerVenue,
    }}>
      {children}
    </OwnerVenueContext.Provider>
  );
}

export function useOwnerVenueContext() {
  const context = useContext(OwnerVenueContext);
  if (context === undefined) {
    throw new Error('useOwnerVenueContext must be used within an OwnerVenueProvider');
  }
  return context;
}
