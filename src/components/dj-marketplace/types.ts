// Shared types for the DJ Marketplace (Barreau C). One person = N `djs` rows, so
// everything here is keyed on the canonical person (user_id), mirroring the server RPCs.

export type ResidentScope = { type: 'venue' | 'organizer'; id: string; name: string | null };

export interface MarketplaceDJ {
  user_id: string;
  handle: string | null;
  slug: string | null;
  stage_name: string;
  city: string | null;
  country: string | null;
  profile_image_url: string | null;
  music_genres: string[];
  is_verified: boolean;
  rising: boolean;
  resident: boolean;
  resident_scopes: ResidentScope[];
  followers_count: number;
  min_fee: number | null;
  max_fee: number | null;
  currency: string | null;
  rate_note: string | null;
  available: boolean | null;
  completeness_pct: number;
  rank_score: number;
}

export type DiscoveryMode = 'fan' | 'booker';

export interface MarketplaceFilters {
  genre: string | null;
  city: string | null;
  playedVenue: string | null;
  minFollowers: number | null;
  minFee: number | null;
  maxFee: number | null;
  availableOn: string | null; // ISO date (yyyy-mm-dd)
  // Booker only: radius (km) around the origin city (`city` || the booker's home
  // city). null = "Partout" (no geo filter — exact `city` match falls back in).
  radiusKm: number | null;
}

export const EMPTY_FILTERS: MarketplaceFilters = {
  genre: null,
  city: null,
  playedVenue: null,
  minFollowers: null,
  minFee: null,
  maxFee: null,
  availableOn: null,
  radiusKm: null,
};

// Booker radius presets (km). null = "Partout". Default seeded on the Booking DJ
// page so a club/organizer first sees DJs around its own zone.
export const RADIUS_PRESETS: Array<{ km: number | null }> = [
  { km: 25 }, { km: 50 }, { km: 100 }, { km: 150 }, { km: null },
];
export const DEFAULT_BOOKER_RADIUS_KM = 50;

// Genre facet — MUST mirror YUNO_MUSIC_GENRES in src/pages/dj-app/DJProfile.tsx exactly.
// The server filter matches stored genres by case-insensitive equality, so any string
// here that isn't what DJs actually pick would silently return zero results.
export { MUSIC_GENRES as DJ_GENRES } from '@/lib/musicGenres';
