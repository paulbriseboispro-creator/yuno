import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Storage keys
const PROMO_CODE_KEY = 'promoter_code';
const PROMO_VENUE_KEY = 'promoter_venue_id';
const PROMO_ORG_KEY = 'promoter_organizer_id';
const PROMO_EVENT_KEY = 'promoter_event_id';
const PROMO_SOURCE_KEY = 'promoter_source';
const PROMO_EXPIRY_KEY = 'promoter_expiry';
const PROMO_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Store promo code in both sessionStorage and localStorage (with expiration).
 *
 * La portée peut être un club OU un organisateur : une soirée d'organisateur n'a
 * pas de venue_id, et n'enregistrer que la portée club revenait à jeter le code.
 */
function storePromoCode(code: string, venueId: string | null, organizerUserId: string | null, eventId?: string, source?: string) {
  const expiry = Date.now() + PROMO_DURATION_MS;

  const write = (s: Storage) => {
    s.setItem(PROMO_CODE_KEY, code);
    // Toujours réécrire les deux portées (y compris à vide) : sinon un code
    // stocké pour un club précédent resterait collé au nouveau.
    s.setItem(PROMO_VENUE_KEY, venueId || '');
    s.setItem(PROMO_ORG_KEY, organizerUserId || '');
    if (eventId) s.setItem(PROMO_EVENT_KEY, eventId);
    if (source) s.setItem(PROMO_SOURCE_KEY, source);
  };

  write(sessionStorage);
  write(localStorage);
  localStorage.setItem(PROMO_EXPIRY_KEY, expiry.toString());
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
      let resolvedOrganizerId: string | undefined;

      // Une soirée d'organisateur (ou un co-event) n'a pas forcément de club :
      // on récupère les deux portées, club partenaire inclus.
      if (eventId && (!resolvedVenueId || !resolvedOrganizerId)) {
        const { data: event } = await supabase
          .from('events')
          .select('venue_id, partner_venue_id, organizer_user_id, partner_organizer_id')
          .eq('id', eventId)
          .maybeSingle();
        resolvedVenueId = resolvedVenueId || event?.venue_id || event?.partner_venue_id || undefined;
        resolvedOrganizerId = event?.organizer_user_id || event?.partner_organizer_id || undefined;
      }

      // On abandonnait ici dès qu'il n'y avait pas de club : pour une soirée
      // d'organisateur, le code était jeté, aucun clic n'était tracé et la vente
      // n'était jamais attribuée. Il suffit désormais d'une portée, quelle qu'elle soit.
      if (!resolvedVenueId && !resolvedOrganizerId) {
        console.warn('[PromoterTracking] Aucune portée (club ou organisateur), suivi ignoré');
        return;
      }

      storePromoCode(refCode, resolvedVenueId || null, resolvedOrganizerId || null, eventId, source);
      // track-promoter-click sait déjà résoudre la portée organisateur.
      trackPromoterClick(refCode, resolvedVenueId || '', eventId, source);

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
 * Code stocké pour la portée d'un événement : club hôte, club partenaire,
 * organisateur ou organisateur partenaire. À utiliser partout où l'événement
 * peut ne pas avoir de club (soirées d'organisateur, co-events).
 *
 * Le serveur revalide de toute façon le code contre les portées réelles de
 * l'événement, et depuis l'unicité par personne un code n'appartient qu'à un
 * seul promoteur : rendre un code hors portée est sans effet, mais le retenir
 * trop strictement faisait perdre des commissions.
 */
export function getStoredPromoCodeForScope(venueId?: string | null, organizerUserId?: string | null): string | null {
  const read = (s: Storage) => ({
    code: s.getItem(PROMO_CODE_KEY),
    venue: s.getItem(PROMO_VENUE_KEY),
    org: s.getItem(PROMO_ORG_KEY),
  });
  const matches = (r: { code: string | null; venue: string | null; org: string | null }) =>
    !!r.code && (
      (!!venueId && r.venue === venueId) ||
      (!!organizerUserId && r.org === organizerUserId)
    );

  const fromSession = read(sessionStorage);
  if (matches(fromSession)) return fromSession.code;

  clearExpiredLocalStorage();
  const expiry = localStorage.getItem(PROMO_EXPIRY_KEY);
  if (expiry && parseInt(expiry) > Date.now()) {
    const fromLocal = read(localStorage);
    if (matches(fromLocal)) return fromLocal.code;
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
