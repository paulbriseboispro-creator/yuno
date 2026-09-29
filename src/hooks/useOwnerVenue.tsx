import { useEffect, useSyncExternalStore } from 'react';
import {
  ensureOwnerVenue, getOwnerVenueState, refetchOwnerVenue, subscribeOwnerVenue,
} from '@/lib/ownerVenueStore';

const IDLE = { venue: null, venueId: null, loading: false, error: null, refetch: refetchOwnerVenue } as const;

/**
 * Club du compte connecté : celui qu'il possède, sinon celui de son profil.
 * Lecture PARTAGÉE (src/lib/ownerVenueStore.ts) — monter ce hook dans dix
 * composants ne fait qu'une requête.
 *
 * `enabled: false` = ne rien lire (Console Organisateur, manager qui a déjà son
 * contexte) : `useVenueContext()` appelle ce hook sans condition.
 */
export function useOwnerVenue({ enabled = true }: { enabled?: boolean } = {}) {
  const s = useSyncExternalStore(subscribeOwnerVenue, getOwnerVenueState, getOwnerVenueState);
  useEffect(() => { if (enabled) void ensureOwnerVenue(); }, [enabled]);

  if (!enabled) return IDLE;
  const venue = s.owned ?? s.attached;
  return {
    venue,
    venueId: venue?.id ?? null,
    loading: s.loading,
    error: s.error === 'not_authenticated' ? 'Not authenticated' : s.error ? 'Failed to fetch venue' : null,
    refetch: refetchOwnerVenue,
  };
}
