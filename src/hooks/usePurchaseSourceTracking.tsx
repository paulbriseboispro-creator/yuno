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

/* ---------------------------------------------------------------------------
 * Tracked links (named per-channel links — instagram, tiktok, newsletter…).
 * A click on /l/:code stores the tracked_link_id so that, after a Stripe
 * redirect, the checkout can attribute the purchase back to the link.
 *
 * Two storage scopes, same 6h TTL as the purchase source above:
 *  - per-event   : the link targets a specific event (key = event id).
 *  - global slot : the link targets a venue/organizer profile (permanent
 *    link). It attributes the *next* purchase the visitor makes within TTL,
 *    used as a fallback when no event-scoped link is set.
 * ------------------------------------------------------------------------- */
const TLINK_KEY_PREFIX = 'tracked_link__';
const TLINK_GLOBAL_KEY = 'tracked_link__active';

type StoredTrackedLink = { linkId: string; expiresAt: number };

function tlinkKey(eventId: string) {
  return `${TLINK_KEY_PREFIX}${eventId}`;
}

function writeTrackedLink(key: string, linkId: string) {
  try {
    const payload: StoredTrackedLink = { linkId, expiresAt: Date.now() + SOURCE_TTL_MS };
    sessionStorage.setItem(key, JSON.stringify(payload));
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore storage errors (private mode, quota)
  }
}

function readTrackedLink(key: string): string | null {
  const read = (storage: Storage): string | null => {
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredTrackedLink;
      if (parsed.expiresAt < Date.now()) {
        storage.removeItem(key);
        return null;
      }
      return parsed.linkId;
    } catch {
      return null;
    }
  };
  return read(sessionStorage) || read(localStorage);
}

/** Store a tracked link that targets a specific event. */
export function setTrackedLinkForEvent(eventId: string, linkId: string) {
  if (eventId && linkId) writeTrackedLink(tlinkKey(eventId), linkId);
}

/** Store a tracked link from a venue/organizer (permanent) link — global fallback. */
export function setActiveTrackedLink(linkId: string) {
  if (linkId) writeTrackedLink(TLINK_GLOBAL_KEY, linkId);
}

/**
 * Resolve the tracked link to attribute a checkout for `eventId`:
 * event-scoped link wins, otherwise the active (venue/organizer) link.
 */
export function getTrackedLinkForCheckout(eventId: string | undefined | null): string | null {
  if (eventId) {
    const scoped = readTrackedLink(tlinkKey(eventId));
    if (scoped) return scoped;
  }
  return readTrackedLink(TLINK_GLOBAL_KEY);
}

/**
 * Read a `?tl=<id>` param off the current URL (filet de sécurité after a
 * redirect) and persist it for the given event. Call on event pages.
 */
export function useResolveTrackedLink(eventId: string | undefined) {
  useEffect(() => {
    if (!eventId) return;
    try {
      const url = new URL(window.location.href);
      const tl = url.searchParams.get('tl');
      if (tl) {
        setTrackedLinkForEvent(eventId, tl);
        url.searchParams.delete('tl');
        window.history.replaceState({}, '', url.toString());
      }
    } catch {
      // ignore
    }
  }, [eventId]);
}
