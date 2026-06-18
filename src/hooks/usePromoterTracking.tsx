import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Storage keys
const PROMO_CODE_KEY = 'promoter_code';
const PROMO_VENUE_KEY = 'promoter_venue_id';
const PROMO_EVENT_KEY = 'promoter_event_id';
const PROMO_SOURCE_KEY = 'promoter_source';
const PROMO_EXPIRY_KEY = 'promoter_expiry';
const PROMO_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Store promo code in both sessionStorage and localStorage (with expiration)
 */
function storePromoCode(code: string, venueId: string, eventId?: string, source?: string) {
  const expiry = Date.now() + PROMO_DURATION_MS;
  
  sessionStorage.setItem(PROMO_CODE_KEY, code);
  sessionStorage.setItem(PROMO_VENUE_KEY, venueId);
  if (eventId) sessionStorage.setItem(PROMO_EVENT_KEY, eventId);
  if (source) sessionStorage.setItem(PROMO_SOURCE_KEY, source);
  
  localStorage.setItem(PROMO_CODE_KEY, code);
  localStorage.setItem(PROMO_VENUE_KEY, venueId);
  localStorage.setItem(PROMO_EXPIRY_KEY, expiry.toString());
  if (eventId) localStorage.setItem(PROMO_EVENT_KEY, eventId);
  if (source) localStorage.setItem(PROMO_SOURCE_KEY, source);
  
}

/**
 * Clear expired localStorage data
 */
function clearExpiredLocalStorage() {
  const expiry = localStorage.getItem(PROMO_EXPIRY_KEY);
  if (expiry && parseInt(expiry) <= Date.now()) {
    localStorage.removeItem(PROMO_CODE_KEY);
    localStorage.removeItem(PROMO_VENUE_KEY);
    localStorage.removeItem(PROMO_EVENT_KEY);
    localStorage.removeItem(PROMO_SOURCE_KEY);
    localStorage.removeItem(PROMO_EXPIRY_KEY);
  }
}

export function usePromoterTracking(venueId?: string, routeEventId?: string) {
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const refCodeRaw = urlParams.get('ref');
    if (!refCodeRaw) return;

    const refCode = refCodeRaw.trim().toUpperCase();
    const source = urlParams.get('src') || undefined;
    const eventId = urlParams.get('event') || routeEventId || undefined;

    (async () => {
      let resolvedVenueId = venueId;

      if (!resolvedVenueId && eventId) {
        const { data: event } = await supabase
          .from('events')
          .select('venue_id')
          .eq('id', eventId)
          .maybeSingle();
        resolvedVenueId = event?.venue_id || undefined;
      }

      if (!resolvedVenueId) {
        console.warn('[PromoterTracking] Missing venueId, skipping track');
        return;
      }


      storePromoCode(refCode, resolvedVenueId, eventId, source);
      trackPromoterClick(refCode, resolvedVenueId, eventId, source);

      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('ref');
      newUrl.searchParams.delete('event');
      newUrl.searchParams.delete('src');
      window.history.replaceState({}, '', newUrl.toString());
    })();
  }, [venueId, routeEventId]);
}

/**
 * Track a promoter click (exported for direct use from PromoterHub)
 */
export async function trackPromoterClickExternal(promoCode: string, venueId: string, eventId?: string, source?: string) {
  return trackPromoterClick(promoCode, venueId, eventId, source);
}

/**
 * Store promo code externally (exported for direct use from PromoterHub)
 */
export function storePromoCodeExternal(code: string, venueId: string, eventId?: string, source?: string) {
  storePromoCode(code, venueId, eventId, source);
}

async function trackPromoterClick(promoCode: string, venueId: string, eventId?: string, source?: string) {
  try {
    const { data, error } = await supabase.functions.invoke('track-promoter-click', {
      body: {
        promoCode,
        venueId,
        eventId: eventId || null,
        source: source || null,
        userAgent: navigator.userAgent,
        referrer: document.referrer || null,
      },
    });

    if (error) {
      console.error('[PromoterTracking] Error tracking click:', error.message);
      return;
    }

  } catch (error) {
    console.error('[PromoterTracking] Error in trackPromoterClick:', error);
  }
}

/**
 * Get the stored promo code (tries sessionStorage first, then localStorage)
 */
export function getStoredPromoCode(): string | null {
  let code = sessionStorage.getItem(PROMO_CODE_KEY);
  if (code) return code;
  
  clearExpiredLocalStorage();
  
  const expiry = localStorage.getItem(PROMO_EXPIRY_KEY);
  if (expiry && parseInt(expiry) > Date.now()) {
    code = localStorage.getItem(PROMO_CODE_KEY);
    if (code) return code;
  }
  
  return null;
}

/**
 * Get the stored promo code only if it's for the specified venue
 */
export function getStoredPromoCodeForVenue(venueId: string): string | null {
  let code = sessionStorage.getItem(PROMO_CODE_KEY);
  let storedVenueId = sessionStorage.getItem(PROMO_VENUE_KEY);
  
  if (code && storedVenueId === venueId) return code;
  
  clearExpiredLocalStorage();
  
  const expiry = localStorage.getItem(PROMO_EXPIRY_KEY);
  if (expiry && parseInt(expiry) > Date.now()) {
    code = localStorage.getItem(PROMO_CODE_KEY);
    storedVenueId = localStorage.getItem(PROMO_VENUE_KEY);
    if (code && storedVenueId === venueId) return code;
  }
  
  return null;
}

/**
 * Get the venue ID associated with the stored promo code
 */
export function getStoredPromoVenueId(): string | null {
  let venueId = sessionStorage.getItem(PROMO_VENUE_KEY);
  if (venueId) return venueId;
  
  clearExpiredLocalStorage();
  
  const expiry = localStorage.getItem(PROMO_EXPIRY_KEY);
  if (expiry && parseInt(expiry) > Date.now()) {
    return localStorage.getItem(PROMO_VENUE_KEY);
  }
  
  return null;
}

/**
 * Get the event ID associated with the stored promo code
 */
export function getStoredPromoEventId(): string | null {
  let eventId = sessionStorage.getItem(PROMO_EVENT_KEY);
  if (eventId) return eventId;
  
  clearExpiredLocalStorage();
  
  const expiry = localStorage.getItem(PROMO_EXPIRY_KEY);
  if (expiry && parseInt(expiry) > Date.now()) {
    return localStorage.getItem(PROMO_EVENT_KEY);
  }
  
  return null;
}

/**
 * Get the source tag associated with the stored promo code
 */
export function getStoredPromoSource(): string | null {
  let source = sessionStorage.getItem(PROMO_SOURCE_KEY);
  if (source) return source;
  
  clearExpiredLocalStorage();
  
  const expiry = localStorage.getItem(PROMO_EXPIRY_KEY);
  if (expiry && parseInt(expiry) > Date.now()) {
    return localStorage.getItem(PROMO_SOURCE_KEY);
  }
  
  return null;
}

/**
 * Clear the stored promo code from both storages
 */
export function clearPromoCode() {
  sessionStorage.removeItem(PROMO_CODE_KEY);
  sessionStorage.removeItem(PROMO_VENUE_KEY);
  sessionStorage.removeItem(PROMO_EVENT_KEY);
  sessionStorage.removeItem(PROMO_SOURCE_KEY);
  localStorage.removeItem(PROMO_CODE_KEY);
  localStorage.removeItem(PROMO_VENUE_KEY);
  localStorage.removeItem(PROMO_EVENT_KEY);
  localStorage.removeItem(PROMO_SOURCE_KEY);
  localStorage.removeItem(PROMO_EXPIRY_KEY);
}
