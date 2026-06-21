// Shared user-location store for the public discovery surfaces (Explore home + ClubMap).
// Both pages read/write the SAME storage keys so a city the visitor chose on one screen
// (e.g. "Madrid") is respected on the other, instead of one of them silently falling back
// to the device GPS position. This module is the single source of truth for that contract.
//
// Storage contract:
//   sessionStorage 'yuno_manual_coords' -> JSON {lat,lng}: the manually-picked center (per tab session)
//   sessionStorage 'yuno_manual_city'   -> city name; its PRESENCE means "visitor picked manually,
//                                          do NOT override with GPS"
//   localStorage   'yuno_city'          -> last known city name (persists across sessions)

export interface Coords {
  lat: number;
  lng: number;
}

const MANUAL_COORDS_KEY = 'yuno_manual_coords';
const MANUAL_CITY_KEY = 'yuno_manual_city';
const CITY_KEY = 'yuno_city';
const CITY_PERSISTED_KEY = 'yuno_city_persisted';

/** Coords the visitor manually picked this session, or null. */
export function getManualCoords(): Coords | null {
  const saved = sessionStorage.getItem(MANUAL_COORDS_KEY);
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      /* corrupted value — treat as unset */
    }
  }
  return null;
}

/** True if the visitor manually chose a city this session (so we must NOT auto-geolocate over it). */
export function hasManualCity(): boolean {
  return !!sessionStorage.getItem(MANUAL_CITY_KEY);
}

/** Best known city name, with a sensible default. */
export function getStoredCity(fallback = 'Madrid'): string {
  return sessionStorage.getItem(MANUAL_CITY_KEY) || localStorage.getItem(CITY_KEY) || fallback;
}

/** Persist a manual location pick. Shared by Explore's city picker and the map's city search. */
export function setManualLocation(city: string, coords?: Coords): void {
  localStorage.setItem(CITY_KEY, city);
  sessionStorage.setItem(MANUAL_CITY_KEY, city);
  if (coords) sessionStorage.setItem(MANUAL_COORDS_KEY, JSON.stringify(coords));
  void persistCityToProfile(city);
}

/**
 * A2 — best-effort write of the visitor's city to their profile so SERVER-side features
 * (DJ line-up notifications, geo-filtered messaging) can target by location. The browser
 * keeps location in localStorage; without this the DB never learns where a follower is, so
 * the geo filter would match nobody. Guarded so it only writes when the city actually
 * changed and a session exists. Never blocks the UX.
 */
export async function persistCityToProfile(city: string): Promise<void> {
  try {
    const c = (city || '').trim();
    if (!c) return;
    if (localStorage.getItem(CITY_PERSISTED_KEY) === c) return;
    const { supabase } = await import('@/integrations/supabase/client');
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) return;
    const { error } = await supabase.from('profiles').update({ city: c }).eq('id', uid);
    if (!error) localStorage.setItem(CITY_PERSISTED_KEY, c);
  } catch {
    /* best-effort: location persistence must never break discovery surfaces */
  }
}

/** Clear the manual pick so both surfaces fall back to device GPS (used by "use my location"). */
export function clearManualLocation(): void {
  sessionStorage.removeItem(MANUAL_CITY_KEY);
  sessionStorage.removeItem(MANUAL_COORDS_KEY);
}

/** Remember the city resolved from GPS / profile. Stays in auto-mode (no manual flag set). */
export function setResolvedCity(city: string): void {
  localStorage.setItem(CITY_KEY, city);
  void persistCityToProfile(city);
}

/**
 * True when we actually KNOW where the visitor is — manual pick, or a city resolved from
 * GPS / profile (persisted in localStorage). The 'Madrid' default from getStoredCity() does
 * NOT count: it's a display fallback, not a signal. Location-scoped surfaces (/clubs, /djs)
 * only filter by proximity when this is true, so they never go mysteriously empty for a
 * visitor whose location we never learned.
 */
export function hasRealLocation(): boolean {
  return hasManualCity() || !!getManualCoords() || !!localStorage.getItem(CITY_KEY);
}

/** Great-circle distance in km between two lat/lng points. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Loose city-name match (case/accents/format tolerant) so "Paris" matches "paris", "Paris 11e". */
export function cityMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const norm = (s: string) =>
    s.toLowerCase().replace(/\s+/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** Radius (km) within which a venue counts as "near" the visitor — shared with Explore. */
export const NEAR_RADIUS_KM = 50;
