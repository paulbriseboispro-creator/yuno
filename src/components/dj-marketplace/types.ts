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
}

export const EMPTY_FILTERS: MarketplaceFilters = {
  genre: null,
  city: null,
  playedVenue: null,
  minFollowers: null,
  minFee: null,
  maxFee: null,
  availableOn: null,
};

// Genre facet — MUST mirror YUNO_MUSIC_GENRES in src/pages/dj-app/DJProfile.tsx exactly.
// The server filter matches stored genres by case-insensitive equality, so any string
// here that isn't what DJs actually pick would silently return zero results.
export const DJ_GENRES = [
  'House', 'Techno', 'Rap / Hip-Hop', 'Afro / Shatta',
  'Reggaeton / Latino', 'Commercial / Hits', 'Electro / EDM', 'Open Format',
] as const;
