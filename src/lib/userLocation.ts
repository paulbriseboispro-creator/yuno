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
}

/** Clear the manual pick so both surfaces fall back to device GPS (used by "use my location"). */
export function clearManualLocation(): void {
  sessionStorage.removeItem(MANUAL_CITY_KEY);
  sessionStorage.removeItem(MANUAL_COORDS_KEY);
}

/** Remember the city resolved from GPS / profile. Stays in auto-mode (no manual flag set). */
export function setResolvedCity(city: string): void {
  localStorage.setItem(CITY_KEY, city);
}
