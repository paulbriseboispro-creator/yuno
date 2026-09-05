// ════════════════════════════════════════════════════════════════════
// Catalogue public de l'Explorer — UNE source, indépendante de la ville.
// ────────────────────────────────────────────────────────────────────
// Avant : chaque changement de ville (Ségovie → Paris) ou de date (Ce soir →
// Demain) rejouait ~20 requêtes Supabase, alors qu'AUCUNE d'entre elles ne
// dépendait de la ville : le filtrage se faisait de toute façon côté client.
// Le feed passait donc par un squelette complet à chaque changement — sur un
// réseau mobile, plusieurs secondes de blanc pour un simple choix de ville.
//
// Maintenant : le catalogue (soirées des 7 prochains jours + soirées en cours,
// lieux, compteurs, tarifs, genres) est chargé UNE fois, mis en cache par
// react-query, et l'Explorer DÉRIVE ses sections (carrousel du jour, semaine,
// clubs, DJs) par simple filtrage en mémoire. Changer de ville ou de date
// = 0 requête, rendu instantané.
//
// Les référentiels partagés (lieux, lieux affiliés, compteurs de favoris)
// passent par `queryClient.fetchQuery` : plusieurs appelants (catalogue,
// densité de zone, page carte) partagent la même requête en vol et le même
// cache, au lieu de la répéter chacun de leur côté.
// ════════════════════════════════════════════════════════════════════
import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import type { EventCardData } from '@/components/explore/EventCard';
import { affiliateMinPrice } from '@/lib/eventPriceLabel';

/** Fraîcheur des référentiels publics (lieux, compteurs) — 5 min, comme le QueryClient. */
export const PUBLIC_STALE_MS = 5 * 60 * 1000;

/** Rayon (km) dans lequel un lieu compte comme « dans la zone » du visiteur. */
export const ZONE_RADIUS_KM = 50;

export type PublicVenueRow = Pick<
  Tables<'venues'>,
  'id' | 'name' | 'city' | 'address' | 'logo_url' | 'cover_url' | 'latitude' | 'longitude' | 'is_hidden' | 'hidden_from_map'
>;
export type PublicAffiliateVenueRow = Pick<
  Tables<'affiliate_venues'>,
  'id' | 'name' | 'city' | 'slug' | 'cover_image_url' | 'logo_url' | 'lat' | 'lng' | 'genres' | 'is_active'
>;

export type FavoriteCountType = 'event' | 'club' | 'affiliate_event' | 'dj';

export interface Coords {
  lat: number;
  lng: number;
}

/** Carte d'une soirée du catalogue : EventCardData + ce qu'il faut pour la placer. */
export interface CatalogCard extends EventCardData {
  lat: number | null;
  lng: number | null;
  /** Clé de jour (yyyy-MM-dd) — regroupe les onglets « Cette semaine ». */
  dayKey: string;
  /** Prix min/max des vagues actives (bornes du curseur de filtre). */
  priceMin: number | null;
  priceMax: number | null;
}

export interface ExploreCatalog {
  /** Toutes les soirées de la fenêtre + celles en cours, triées par début. */
  cards: CatalogCard[];
  venues: PublicVenueRow[];
  affiliateVenues: PublicAffiliateVenueRow[];
  venueFavCounts: Record<string, number>;
  /** Bornes de la fenêtre chargée (ISO). */
  windowStart: string;
  windowEnd: string;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** yyyy-MM-dd en heure locale de l'appareil. */
export const toLocalDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Minuit local du jour donné. */
export const startOfLocalDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** 23:59:59.999 local du jour donné. */
export const endOfLocalDay = (d: Date): Date => {
  const e = startOfLocalDay(d);
  e.setHours(23, 59, 59, 999);
  return e;
};

// ── Référentiels partagés (dédupliqués par react-query) ──────────────

export function fetchPublicVenues(qc: QueryClient): Promise<PublicVenueRow[]> {
  return qc.fetchQuery({
    queryKey: ['public-venues'],
    staleTime: PUBLIC_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venues')
        .select('id, name, city, address, logo_url, cover_url, latitude, longitude, is_hidden, hidden_from_map')
        .eq('is_hidden', false);
      if (error) throw error;
      return (data ?? []) as PublicVenueRow[];
    },
  });
}

export function fetchPublicAffiliateVenues(qc: QueryClient): Promise<PublicAffiliateVenueRow[]> {
  return qc.fetchQuery({
    queryKey: ['public-affiliate-venues'],
    staleTime: PUBLIC_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('affiliate_venues')
        .select('id, name, city, slug, cover_image_url, logo_url, lat, lng, genres, is_active')
        .eq('is_active', true);
      if (error) throw error;
      return (data ?? []) as PublicAffiliateVenueRow[];
    },
  });
}

export function fetchFavoriteCounts(qc: QueryClient, type: FavoriteCountType): Promise<Record<string, number>> {
  return qc.fetchQuery({
    queryKey: ['public-favorite-counts', type],
    staleTime: PUBLIC_STALE_MS,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_public_favorite_counts', { _favorite_type: type });
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data ?? []).forEach((f) => {
        if (f.target_id) counts[f.target_id] = f.total_count;
      });
      return counts;
    },
  });
}

// ── Catalogue des soirées d'une fenêtre ──────────────────────────────

const EVENT_COLUMNS =
  'id, slug, title, poster_url, start_at, end_at, venue_id, partner_venue_id, organizer_user_id, is_active, max_tickets, ticketing_enabled, tables_enabled, music_genre, music_genres, event_type, location_city';

type EventRow = {
  id: string;
  slug: string | null;
  title: string;
  poster_url: string | null;
  start_at: string;
  end_at: string;
  venue_id: string | null;
  partner_venue_id: string | null;
  organizer_user_id: string | null;
  tables_enabled: boolean | null;
  music_genre: string | null;
  music_genres: string[] | null;
  event_type: string | null;
  location_city: string | null;
};

/**
 * Charge toutes les soirées publiques dont le début tombe dans [start, end]
 * (+ celles en cours si `includeLive`), enrichies de tout ce que l'Explorer
 * affiche. Aucun filtre de ville : c'est l'appelant qui scope, en mémoire.
 */
export async function fetchExploreCatalog(
  qc: QueryClient,
  range: { start: Date; end: Date },
  opts: { includeLive?: boolean } = {},
): Promise<ExploreCatalog> {
  const now = new Date();
  const nowIso = now.toISOString();
  const startIso = range.start.toISOString();
  const endIso = range.end.toISOString();
  const startDate = toLocalDate(range.start);
  const endDate = toLocalDate(range.end);

  // ── Vague 1 : tout ce qui ne dépend d'aucun id ──
  const [eventsRes, liveEventsRes, venues, affiliateVenues, favCounts, venueFavCounts, affiliateFavCounts, tableZonesRes, affiliateEventsRes] =
    await Promise.all([
      supabase
        .from('events')
        .select(EVENT_COLUMNS)
        .eq('is_active', true)
        .eq('visibility', 'public')
        .eq('is_discoverable', true)
        .gte('start_at', startIso)
        .lte('start_at', endIso)
        .order('start_at', { ascending: true })
        .limit(500),
      opts.includeLive
        ? supabase
            .from('events')
            .select(EVENT_COLUMNS)
            .eq('is_active', true)
            .eq('visibility', 'public')
            .eq('is_discoverable', true)
            .lt('start_at', nowIso)
            .gt('end_at', nowIso)
            .order('start_at', { ascending: true })
            .limit(100)
        : Promise.resolve({ data: [] as EventRow[], error: null }),
      fetchPublicVenues(qc),
      fetchPublicAffiliateVenues(qc),
      fetchFavoriteCounts(qc, 'event'),
      fetchFavoriteCounts(qc, 'club'),
      fetchFavoriteCounts(qc, 'affiliate_event'),
      supabase.from('table_zones').select('venue_id, tables_count'),
      supabase
        .from('affiliate_events')
        .select('id, name, slug, event_date, start_time, end_time, flyer_url, genres, price_from, is_free, tables_only, external_ticket_url, affiliate_venues(id, name, city, neighborhood, lat, lng)')
        .in('status', ['published', 'featured'])
        .gte('event_date', startDate)
        .lte('event_date', endDate)
        .order('event_date', { ascending: true }),
    ]);

  if (eventsRes.error) throw eventsRes.error;
  if (liveEventsRes.error) throw liveEventsRes.error;

  const regularEvents = (eventsRes.data ?? []) as EventRow[];
  const liveEvents = (liveEventsRes.data ?? []) as EventRow[];
  const liveIds = new Set(liveEvents.map((e) => e.id));
  const mergedEvents = [...liveEvents, ...regularEvents.filter((e) => !liveIds.has(e.id))];
  const eventIds = mergedEvents.map((e) => e.id);
  const organizerUserIds = Array.from(
    new Set(mergedEvents.map((e) => e.organizer_user_id).filter(Boolean) as string[]),
  );

  // ── Vague 2 : ce qui dépend des ids (bornés à la fenêtre, jamais « toute la table ») ──
  const [ticketRoundsRes, djSetsRes, orgProfilesRes, tablePacksRes] = await Promise.all([
    eventIds.length
      ? supabase.from('ticket_rounds').select('event_id, price, tickets_sold, max_tickets, is_active').in('event_id', eventIds)
      : Promise.resolve({ data: [] as { event_id: string; price: number; tickets_sold: number | null; max_tickets: number | null; is_active: boolean | null }[] }),
    eventIds.length
      ? supabase.from('dj_sets').select('event_id, music_genre').in('event_id', eventIds)
      : Promise.resolve({ data: [] as { event_id: string | null; music_genre: string | null }[] }),
    organizerUserIds.length
      ? supabase.from('organizer_profiles').select('user_id, display_name, slug').in('user_id', organizerUserIds)
      : Promise.resolve({ data: [] as { user_id: string; display_name: string; slug: string | null }[] }),
    // Prix plancher des tables : une soirée qui ne vend QUE des tables doit
    // dire « Table dès 300 € », pas rien (et surtout pas « Gratuit »).
    supabase.from('table_packs').select('venue_id, event_id, base_price').eq('is_active', true),
  ]);

  const tablePriceByEvent: Record<string, number> = {};
  const tablePriceByVenue: Record<string, number> = {};
  (tablePacksRes.data ?? []).forEach((pk) => {
    const price = Number(pk.base_price);
    if (!(price > 0)) return;
    if (pk.event_id) {
      tablePriceByEvent[pk.event_id] = Math.min(tablePriceByEvent[pk.event_id] ?? Infinity, price);
    } else if (pk.venue_id) {
      tablePriceByVenue[pk.venue_id] = Math.min(tablePriceByVenue[pk.venue_id] ?? Infinity, price);
    }
  });

  const venueMap = new Map(venues.map((v) => [v.id, v]));
  const organizerMap = new Map<string, { display_name: string; slug: string | null }>();
  (orgProfilesRes.data ?? []).forEach((op) =>
    organizerMap.set(op.user_id, { display_name: op.display_name, slug: op.slug }),
  );

  const genreMap: Record<string, Set<string>> = {};
  (djSetsRes.data ?? []).forEach((ds) => {
    if (ds.event_id && ds.music_genre) {
      (genreMap[ds.event_id] ??= new Set()).add(ds.music_genre);
    }
  });

  const tablesPerVenue: Record<string, number> = {};
  (tableZonesRes.data ?? []).forEach((tz) => {
    tablesPerVenue[tz.venue_id] = (tablesPerVenue[tz.venue_id] || 0) + (tz.tables_count || 0);
  });

  const priceMap: Record<string, { min: number; max: number }> = {};
  const soldMap: Record<string, { sold: number; max: number }> = {};
  (ticketRoundsRes.data ?? []).forEach((tr) => {
    if (tr.is_active) {
      const p = priceMap[tr.event_id];
      if (!p) priceMap[tr.event_id] = { min: tr.price, max: tr.price };
      else {
        p.min = Math.min(p.min, tr.price);
        p.max = Math.max(p.max, tr.price);
      }
    }
    const s = (soldMap[tr.event_id] ??= { sold: 0, max: 0 });
    s.sold += tr.tickets_sold || 0;
    s.max += tr.max_tickets || 0;
  });

  const cards: CatalogCard[] = mergedEvents.map((e) => {
    const isOrganizerLed = !!e.organizer_user_id;
    const displayVenueId = e.venue_id || (isOrganizerLed ? e.partner_venue_id : null);
    const venue = displayVenueId ? venueMap.get(displayVenueId) : undefined;
    const organizerInfo = isOrganizerLed && e.organizer_user_id ? organizerMap.get(e.organizer_user_id) : undefined;

    const sm = soldMap[e.id];
    const percentSold = sm && sm.max > 0 ? (sm.sold / sm.max) * 100 : 0;
    const interestedCount = favCounts[e.id] || 0;
    const tablesRem = e.tables_enabled && displayVenueId ? tablesPerVenue[displayVenueId] || null : null;

    const eventGenres =
      e.music_genres && e.music_genres.length > 0
        ? e.music_genres
        : e.music_genre
          ? [e.music_genre]
          : Array.from(genreMap[e.id] || []);

    const venueName =
      isOrganizerLed && organizerInfo
        ? `${organizerInfo.display_name}${venue ? ` · ${venue.name}` : ''}`
        : venue?.name || '';

    return {
      id: e.id,
      slug: e.slug ?? null,
      organizerSlug: organizerInfo?.slug ?? null,
      title: e.title,
      posterUrl: e.poster_url,
      startAt: e.start_at,
      endAt: e.end_at,
      venueName,
      venueSlug: venue?.id || '',
      // Soirée org-led sans club : la ville vit sur l'event lui-même.
      venueCity: venue?.city || e.location_city || '',
      minPrice: priceMap[e.id]?.min ?? null,
      priceMin: priceMap[e.id]?.min ?? null,
      priceMax: priceMap[e.id]?.max ?? null,
      // Tables sans billet : le libellé de prix parle de la table, pas de l'entrée.
      tablesOnly: !!e.tables_enabled && !priceMap[e.id],
      tableMinPrice: e.tables_enabled
        ? (tablePriceByEvent[e.id] ?? (displayVenueId ? tablePriceByVenue[displayVenueId] : undefined) ?? null)
        : null,
      genres: eventGenres,
      interestedCount,
      percentSold,
      tablesRemaining: tablesRem,
      isTrending: percentSold > 60 || interestedCount > 100,
      eventType: e.event_type || 'club',
      isLive: liveIds.has(e.id),
      isOrganizerLed,
      organizerName: organizerInfo?.display_name,
      lat: venue?.latitude ?? null,
      lng: venue?.longitude ?? null,
      // Regroupement par jour sur la date UTC de start_at (comportement
      // historique des onglets « Cette semaine » : une soirée à 00:30 reste
      // dans la nuit qui la précède).
      dayKey: e.start_at.slice(0, 10),
    };
  });

  const affiliateCards: CatalogCard[] = (affiliateEventsRes.data ?? []).flatMap((ae) => {
    const venue = ae.affiliate_venues;
    if (!venue) return [];
    const startAt = `${ae.event_date}T${(ae.start_time || '22:00').substring(0, 5)}:00`;
    const endAt = `${ae.event_date}T${(ae.end_time || '05:30').substring(0, 5)}:00`;
    const minPrice = affiliateMinPrice(ae);
    return [
      {
        id: ae.id,
        title: ae.name,
        posterUrl: ae.flyer_url,
        startAt,
        endAt,
        venueName: venue.name,
        venueSlug: venue.id,
        venueCity: venue.city || '',
        minPrice,
        priceMin: minPrice,
        priceMax: minPrice,
        // Une soirée qui ne vend que des tables n'a pas de prix d'entrée :
        // sans ce drapeau elle s'affichait « Gratuit ».
        tablesOnly: !!ae.tables_only,
        genres: ae.genres || [],
        interestedCount: affiliateFavCounts[ae.id] || 0,
        percentSold: 0,
        tablesRemaining: null,
        isTrending: false,
        eventType: 'affiliate',
        isAffiliate: true,
        affiliateEventSlug: ae.slug,
        lat: venue.lat ?? null,
        lng: venue.lng ?? null,
        dayKey: ae.event_date,
      },
    ];
  });

  const all = [...cards, ...affiliateCards].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );

  return {
    cards: all,
    venues,
    affiliateVenues,
    venueFavCounts,
    windowStart: startIso,
    windowEnd: endIso,
  };
}

// ── Filtrage de zone (mémoire) ───────────────────────────────────────

/** Une carte avec sa distance au visiteur (null si inconnue). */
export type PlacedCard = CatalogCard & { distance: number | null };

/**
 * Place chaque carte par rapport au visiteur et ne garde que la zone :
 * rayon de 50 km quand on a des coordonnées ET que le lieu en a, sinon
 * correspondance de ville (insensible à la casse). Même règle que la densité.
 */
export function placeInZone<T extends CatalogCard>(
  cards: T[],
  city: string,
  userLocation: Coords | null,
): (T & { distance: number | null })[] {
  const cityLc = city.toLowerCase();
  const out: (T & { distance: number | null })[] = [];
  for (const c of cards) {
    const distance =
      userLocation && c.lat != null && c.lng != null
        ? haversineKm(userLocation.lat, userLocation.lng, c.lat, c.lng)
        : null;
    const inZone =
      distance != null ? distance <= ZONE_RADIUS_KM : cityLc ? c.venueCity.toLowerCase().includes(cityLc) : true;
    if (inZone) out.push({ ...c, distance });
  }
  return out;
}

// ── DJs du catalogue ─────────────────────────────────────────────────

export interface CatalogDjs {
  djs: import('@/components/explore/ExploreDJCard').ExploreDJItem[];
  /** Soirées du catalogue où joue chaque DJ (id DJ → ids de soirées). */
  eventsByDj: Record<string, string[]>;
}

/**
 * DJs programmés sur les soirées données (toutes villes) + compteur d'abonnés.
 * L'Explorer filtre ensuite par zone en mémoire : changer de ville ne relance
 * rien. Bornée aux ids de la fenêtre, jamais « toute la table ».
 */
export async function fetchCatalogDjs(qc: QueryClient, eventIds: string[]): Promise<CatalogDjs> {
  const ids = eventIds.filter(Boolean);
  if (ids.length === 0) return { djs: [], eventsByDj: {} };

  const { data: links, error: linksError } = await supabase
    .from('event_djs')
    .select('event_id, dj_id')
    .in('event_id', ids);
  if (linksError) throw linksError;

  const eventsByDj: Record<string, string[]> = {};
  (links ?? []).forEach((l) => {
    if (l.dj_id && l.event_id) (eventsByDj[l.dj_id] ??= []).push(l.event_id);
  });
  const djIds = Object.keys(eventsByDj);
  if (djIds.length === 0) return { djs: [], eventsByDj: {} };

  const [followerMap, djsRes] = await Promise.all([
    fetchFavoriteCounts(qc, 'dj'),
    supabase
      .from('djs_public')
      .select('id, slug, handle, stage_name, first_name, last_name, profile_image_url, music_genres, is_verified, is_active')
      .in('id', djIds)
      .eq('is_active', true),
  ]);
  if (djsRes.error) throw djsRes.error;

  const djs = (djsRes.data ?? [])
    .map((d) => ({
      // La vue djs_public expose id nullable, mais .in('id', djIds) garantit sa présence.
      id: d.id as string,
      slug: d.slug,
      handle: d.handle ?? null,
      stageName: (d.stage_name || `${d.first_name ?? ''} ${d.last_name ?? ''}`).trim(),
      profileImageUrl: d.profile_image_url,
      musicGenres: d.music_genres || [],
      isVerified: !!d.is_verified,
      followersCount: followerMap[d.id as string] || 0,
    }))
    .filter((d) => d.stageName);

  return { djs, eventsByDj };
}
