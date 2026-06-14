/**
 * Tracks the purchase source for an event (where the user came from
 * to land on the ticket/table checkout). Used for analytics on
 * collaborative events between an organizer and a venue.
 *
 * Sources:
 *  - venue_profile      : came from /club/:slug
 *  - organizer_profile  : came from /o/:slug
 *  - dj_profile         : came from /dj/:slug
 *  - explore            : came from /explore or /map
 *  - promoter           : came via a promoter link (?ref=)
 *  - direct             : direct link / unknown
 */
import { useEffect } from 'react';

export type PurchaseSource =
  | 'venue_profile'
  | 'organizer_profile'
  | 'dj_profile'
  | 'explore'
  | 'promoter'
  | 'direct';

const SOURCE_KEY_PREFIX = 'purchase_source__';
const SOURCE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

type StoredSource = { source: PurchaseSource; expiresAt: number };

function storeKey(eventId: string) {
  return `${SOURCE_KEY_PREFIX}${eventId}`;
}

export function setPurchaseSource(eventId: string, source: PurchaseSource) {
  try {
    const payload: StoredSource = {
      source,
      expiresAt: Date.now() + SOURCE_TTL_MS,
    };
    sessionStorage.setItem(storeKey(eventId), JSON.stringify(payload));
    localStorage.setItem(storeKey(eventId), JSON.stringify(payload));
  } catch {
    // ignore storage errors (private mode, quota)
  }
}

export function getPurchaseSource(eventId: string): PurchaseSource | null {
  const read = (storage: Storage): PurchaseSource | null => {
    try {
      const raw = storage.getItem(storeKey(eventId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredSource;
      if (parsed.expiresAt < Date.now()) {
        storage.removeItem(storeKey(eventId));
        return null;
      }
      return parsed.source;
    } catch {
      return null;
    }
  };
  return read(sessionStorage) || read(localStorage);
}

export function clearPurchaseSource(eventId: string) {
  try {
    sessionStorage.removeItem(storeKey(eventId));
    localStorage.removeItem(storeKey(eventId));
  } catch {
    // ignore
  }
}

/**
 * Hook used on profile/listing pages: marks every event displayed
 * with the source so when the user clicks through, we know where
 * they came from even after a Stripe redirect.
 */
export function useTagEventsSource(eventIds: string[], source: PurchaseSource) {
  useEffect(() => {
    if (!eventIds || eventIds.length === 0) return;
    eventIds.forEach((id) => {
      if (id) setPurchaseSource(id, source);
    });
  }, [eventIds.join('|'), source]);
}

/**
 * Hook used on the EventDetails page: if no source has been recorded
 * yet for this event, fall back to a sensible default based on the
 * incoming URL / referrer.
 */
export function useResolvePurchaseSource(eventId: string | undefined, fallback: PurchaseSource = 'direct') {
  useEffect(() => {
    if (!eventId) return;
    const existing = getPurchaseSource(eventId);
    if (existing) return;

    const url = new URL(window.location.href);
    const srcParam = url.searchParams.get('src') as PurchaseSource | null;
    if (srcParam && isValidSource(srcParam)) {
      setPurchaseSource(eventId, srcParam);
      url.searchParams.delete('src');
      window.history.replaceState({}, '', url.toString());
      return;
    }

    // Promoter takes precedence (separate flow already stores promo code)
    if (url.searchParams.get('ref')) {
      setPurchaseSource(eventId, 'promoter');
      return;
    }

    // Best-effort referrer-based detection
    const ref = document.referrer || '';
    if (ref.includes('/explore') || ref.includes('/map')) {
      setPurchaseSource(eventId, 'explore');
      return;
    }
    if (ref.includes('/o/')) {
      setPurchaseSource(eventId, 'organizer_profile');
      return;
    }
    if (ref.includes('/club/')) {
      setPurchaseSource(eventId, 'venue_profile');
      return;
    }
    if (ref.includes('/dj/')) {
      setPurchaseSource(eventId, 'dj_profile');
      return;
    }

    setPurchaseSource(eventId, fallback);
  }, [eventId, fallback]);
}

function isValidSource(s: string): s is PurchaseSource {
  return ['venue_profile', 'organizer_profile', 'dj_profile', 'explore', 'promoter', 'direct'].includes(s);
}
