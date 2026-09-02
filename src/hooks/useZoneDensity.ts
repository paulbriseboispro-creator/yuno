import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { affiliateMinPrice } from '@/lib/eventPriceLabel';
import type { EventCardData } from '@/components/explore/EventCard';

/**
 * Densité de la zone — pilote la bascule automatique de l'Explore entre le
 * feed standard et les trois écrans « faible densité » (design
 * « Explore Paris - faible densite », claude.design) :
 *
 *   0 soirée à venir dans la zone                          -> 'empty'  (page de demande)
 *   1 soirée à venir                                       -> 'single' (découverte de la date unique)
 *   ≥ 2 à venir ET < LOW_DENSITY_WEEK_MAX sur 7 jours      -> 'low'    (page de semaine)
 *   sinon                                                  -> 'full'   (feed Explore standard)
 *
 * La « zone » suit exactement la règle du feed : rayon 50 km quand on a des
 * coordonnées, sinon correspondance de ville. « À venir » = fenêtre de
 * DENSITY_HORIZON_DAYS jours, soirées live incluses (end_at dans le futur).
 */
export const LOW_DENSITY_WEEK_MAX = 4;
const DENSITY_HORIZON_DAYS = 60;
const MAX_DIST_KM = 50;

export type ZoneDensityStatus = 'empty' | 'single' | 'low' | 'full';

export interface DensityEvent extends EventCardData {
  hasTickets: boolean;
  hasTables: boolean;
  hasGuestList: boolean;
  displayVenueId: string | null;
  venueAddress: string | null;
  /** Nom du lieu saisi sur l'event (soirées org-led sans club Yuno). */
  locationName: string | null;
  /** Logo d'un lieu en texte libre (soirée sans club Yuno) — `venues.logo_url` n'existe pas ici. */
  locationLogoUrl: string | null;
  /** Coordonnées du lieu (tri de proximité du rail « ailleurs sur Yuno »). */
  venueLat: number | null;
  venueLng: number | null;
  /** Avatar public de l'organisateur (soirées org-led). */
  organizerAvatarUrl?: string | null;
  /** Profil organisateur publiable (/o/:slug) — false = pas de lien. */
  organizerIsPublic?: boolean;
  /** Slug public du lieu affilié (navigation /affiliate-venue/:slug). */
  affiliateVenueSlug?: string | null;
}

export interface DensityVenue {
  id: string;
  name: string;
  city: string;
  coverUrl: string | null;
  logoUrl: string | null;
  isAffiliate: boolean;
  /** Groupe « organisateur » (soirées org-led sans club) — navigue vers /o/:slug. */
  isOrganizer?: boolean;
  slug?: string | null;
  dateCount: number;
  nextStartAt: string;
  minPrice: number | null;
  tablesOnly: boolean;
}

export interface ZoneDensity {
  status: ZoneDensityStatus;
  upcoming: DensityEvent[];
  weekCount: number;
  clubsCount: number;
  offersCount: number;
  venues: DensityVenue[];
  elsewhere: DensityEvent[];
  elsewhereCityCount: number;
}

const FULL_FALLBACK: ZoneDensity = {
  status: 'full',
  upcoming: [],
  weekCount: 0,
  clubsCount: 0,
  offersCount: 0,
  venues: [],
  elsewhere: [],
  elsewhereCityCount: 0,
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const toLocalDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function fetchZoneDensity(
  city: string,
  userLocation: { lat: number; lng: number } | null,
): Promise<ZoneDensity> {
  const now = new Date();
  const nowIso = now.toISOString();
  const horizon = new Date(now.getTime() + DENSITY_HORIZON_DAYS * 86400000);
  const weekEnd = new Date(now.getTime() + 7 * 86400000);

  // Centre de la zone pour le tri de proximité : les coordonnées de l'appareil
  // quand on les a, sinon un géocodage léger de la ville (best-effort — sans
  // réponse, le rail « ailleurs » retombe sur le tri par date).
  const zoneCenterPromise: Promise<{ lat: number; lng: number } | null> = userLocation
    ? Promise.resolve(userLocation)
    : (async () => {
        try {
          const token = import.meta.env.VITE_MAPBOX_TOKEN;
          if (!token || !city) return null;
          const res = await fetch(
            `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(city)}.json?access_token=${token}&types=place&limit=1`,
          );
          const data = await res.json();
          const f = data.features?.[0];
          return f?.center ? { lat: f.center[1], lng: f.center[0] } : null;
        } catch {
          return null;
        }
      })();

  const [eventsRes, venuesRes, roundsRes, glRes, affRes, zoneCenter] = await Promise.all([
    supabase
      .from('events')
      .select('id, slug, title, poster_url, start_at, end_at, venue_id, partner_venue_id, organizer_user_id, ticketing_enabled, tables_enabled, music_genre, music_genres, event_type, location_city, location_name, location_address, location_logo_url')
      .eq('is_active', true)
      .eq('visibility', 'public')
      .eq('is_discoverable', true)
      .gt('end_at', nowIso)
      .lte('start_at', horizon.toISOString())
      .order('start_at', { ascending: true })
      .limit(400),
    supabase
      .from('venues')
      .select('id, name, city, address, logo_url, cover_url, latitude, longitude')
      .eq('is_hidden', false),
    supabase.from('ticket_rounds').select('event_id, price, tickets_sold, max_tickets, is_active'),
    supabase.from('guest_lists').select('event_id').eq('is_active', true).eq('visible_on_club_page', true),
    supabase
      .from('affiliate_events')
      .select('id, name, slug, event_date, start_time, end_time, flyer_url, genres, price_from, is_free, tables_only, affiliate_venues(id, name, city, slug, cover_image_url, logo_url, lat, lng)')
      .in('status', ['published', 'featured'])
      .gte('event_date', toLocalDate(now))
      .lte('event_date', toLocalDate(horizon))
      .order('event_date', { ascending: true }),
    zoneCenterPromise,
  ]);

  const venueMap = new Map((venuesRes.data || []).map(v => [v.id, v]));

  const minPriceMap: Record<string, number> = {};
  const soldMap: Record<string, { sold: number; max: number }> = {};
  (roundsRes.data || []).forEach(tr => {
    if (tr.is_active) {
      const prev = minPriceMap[tr.event_id];
      if (prev === undefined || tr.price < prev) minPriceMap[tr.event_id] = tr.price;
    }
    if (!soldMap[tr.event_id]) soldMap[tr.event_id] = { sold: 0, max: 0 };
    soldMap[tr.event_id].sold += tr.tickets_sold || 0;
    soldMap[tr.event_id].max += tr.max_tickets || 0;
  });

  // Guest list « publique » = part active visible sur la page club — la même
  // porte que le bloc guest list d'EventDetails (les parts déléguées ne vivent
  // que derrière leur lien de partage).
  const publicGuestList = new Set<string>();
  (glRes.data || []).forEach(gl => {
    if (gl.event_id) publicGuestList.add(gl.event_id);
  });

  // Organisateurs (nom affiché + slug d'URL propre), comme le feed principal.
  const organizerUserIds = Array.from(
    new Set((eventsRes.data || []).map(e => e.organizer_user_id).filter(Boolean) as string[]),
  );
  const organizerMap = new Map<string, { display_name: string; slug: string | null; avatar_url: string | null; is_public: boolean }>();
  if (organizerUserIds.length > 0) {
    const { data: orgProfiles } = await supabase
      .from('organizer_profiles')
      .select('user_id, display_name, slug, avatar_url, is_public')
      .in('user_id', organizerUserIds);
    (orgProfiles || []).forEach(op =>
      organizerMap.set(op.user_id, {
        display_name: op.display_name,
        slug: op.slug,
        avatar_url: op.avatar_url,
        is_public: !!op.is_public,
      }),
    );
  }

  const allCards: DensityEvent[] = (eventsRes.data || []).flatMap(e => {
    const isOrganizerLed = !!e.organizer_user_id;
    const displayVenueId = e.venue_id || (isOrganizerLed ? e.partner_venue_id : null);
    const venue = displayVenueId ? venueMap.get(displayVenueId) : undefined;
    const organizerInfo = isOrganizerLed && e.organizer_user_id ? organizerMap.get(e.organizer_user_id) : undefined;

    // Soirée de club dont le lieu n'est pas un club visible (club démo womber,
    // club masqué, orphelin) : elle n'existe sur AUCUNE surface publique — on
    // la jette, on ne la laisse pas fuir dans « ailleurs sur Yuno ».
    if (!isOrganizerLed && !venue) return [];

    const sm = soldMap[e.id];
    const percentSold = sm && sm.max > 0 ? (sm.sold / sm.max) * 100 : 0;

    let distance: number | null = null;
    if (userLocation && venue?.latitude && venue?.longitude) {
      distance = haversineKm(userLocation.lat, userLocation.lng, venue.latitude, venue.longitude);
    }

    const genres =
      e.music_genres && e.music_genres.length > 0
        ? e.music_genres
        : e.music_genre
          ? [e.music_genre]
          : [];

    const venueName = isOrganizerLed && organizerInfo
      ? `${organizerInfo.display_name}${venue ? ` · ${venue.name}` : ''}`
      : venue?.name || '';

    const hasTickets = !!e.ticketing_enabled && minPriceMap[e.id] !== undefined;

    return [{
      id: e.id,
      slug: e.slug ?? null,
      organizerSlug: organizerInfo?.slug ?? null,
      title: e.title,
      posterUrl: e.poster_url,
      startAt: e.start_at,
      endAt: e.end_at,
      venueName,
      venueSlug: venue?.id || '',
      venueCity: venue?.city || e.location_city || '',
      minPrice: minPriceMap[e.id] ?? null,
      genres,
      interestedCount: 0,
      percentSold,
      tablesRemaining: null,
      isTrending: false,
      distance,
      eventType: e.event_type || 'club',
      isLive: e.start_at <= nowIso,
      isOrganizerLed,
      organizerName: organizerInfo?.display_name,
      organizerAvatarUrl: organizerInfo?.avatar_url ?? null,
      organizerIsPublic: organizerInfo?.is_public ?? false,
      hasTickets,
      hasTables: !!e.tables_enabled,
      hasGuestList: publicGuestList.has(e.id),
      displayVenueId,
      venueAddress: venue?.address || e.location_address || null,
      locationName: e.location_name || null,
      locationLogoUrl: e.location_logo_url || null,
      venueLat: venue?.latitude ?? null,
      venueLng: venue?.longitude ?? null,
    }];
  });

  const affiliateCards: DensityEvent[] = (affRes.data ?? []).flatMap(ae => {
    const venue = ae.affiliate_venues;
    if (!venue) return [];
    const startAt = `${ae.event_date}T${(ae.start_time || '22:00').substring(0, 5)}:00`;
    const endAt = `${ae.event_date}T${(ae.end_time || '05:30').substring(0, 5)}:00`;
    let distance: number | null = null;
    if (userLocation && venue.lat && venue.lng) {
      distance = haversineKm(userLocation.lat, userLocation.lng, venue.lat, venue.lng);
    }
    const minPrice = affiliateMinPrice(ae);
    return [{
      id: ae.id,
      title: ae.name,
      posterUrl: ae.flyer_url,
      startAt,
      endAt,
      venueName: venue.name,
      venueSlug: venue.id,
      venueCity: venue.city || '',
      minPrice,
      tablesOnly: !!ae.tables_only,
      genres: ae.genres || [],
      interestedCount: 0,
      percentSold: 0,
      tablesRemaining: null,
      isTrending: false,
      distance,
      eventType: 'affiliate',
      isAffiliate: true,
      affiliateEventSlug: ae.slug,
      hasTickets: !ae.tables_only && (minPrice !== null || !!ae.is_free),
      hasTables: !!ae.tables_only,
      hasGuestList: false,
      displayVenueId: `aff:${venue.id}`,
      venueAddress: null,
      locationName: null,
      locationLogoUrl: null,
      venueLat: venue.lat ?? null,
      venueLng: venue.lng ?? null,
      affiliateVenueSlug: venue.slug ?? null,
    }];
  });

  const merged = [...allCards, ...affiliateCards]
    .filter(e => new Date(e.endAt).getTime() > now.getTime())
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  const inZone = (e: DensityEvent): boolean => {
    if (userLocation && e.distance != null) return e.distance <= MAX_DIST_KM;
    if (city) return e.venueCity.toLowerCase().includes(city.toLowerCase());
    return true;
  };

  const upcoming = merged.filter(inZone);
  const weekCount = upcoming.filter(e => new Date(e.startAt).getTime() <= weekEnd.getTime()).length;

  // Ailleurs sur Yuno : les prochaines dates hors zone (rail de l'état vide),
  // sur tout l'horizon — une borne à 7 jours cachait la seule soirée native
  // (WOH 11.09) au profit des partenaires de la semaine.
  // Une soirée sans ville ne peut être « ailleurs » nulle part — exclue.
  // Tri : natives Yuno devant les partenaires, puis au plus près de la zone
  // vide (coordonnées inconnues = en queue de groupe), puis par date.
  const distToZone = (e: DensityEvent): number =>
    zoneCenter && e.venueLat != null && e.venueLng != null
      ? haversineKm(zoneCenter.lat, zoneCenter.lng, e.venueLat, e.venueLng)
      : Number.POSITIVE_INFINITY;
  const elsewhere = merged
    .filter(e => !inZone(e) && !!e.venueCity)
    .sort((a, b) =>
      (a.isAffiliate ? 1 : 0) - (b.isAffiliate ? 1 : 0)
      || distToZone(a) - distToZone(b)
      || new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, 8);
  const elsewhereCityCount = new Set(
    elsewhere.map(e => e.venueCity.toLowerCase()).filter(Boolean),
  ).size;

  // Agrégat par « maison » (rail du design 3c) : club Yuno, lieu affilié, ou
  // — pour les soirées org-led sans club — l'organisateur lui-même.
  const venueAgg = new Map<string, DensityVenue>();
  for (const e of upcoming) {
    const groupKey = e.displayVenueId
      || (e.isOrganizerLed && e.organizerName ? `org:${e.organizerSlug || e.organizerName}` : null);
    if (!groupKey) continue;
    const existing = venueAgg.get(groupKey);
    if (existing) {
      existing.dateCount += 1;
      if (e.minPrice !== null && (existing.minPrice === null || e.minPrice < existing.minPrice)) {
        existing.minPrice = e.minPrice;
      }
    } else if (e.isAffiliate) {
      venueAgg.set(groupKey, {
        id: e.venueSlug,
        name: e.venueName,
        city: e.venueCity,
        coverUrl: e.posterUrl,
        logoUrl: null,
        isAffiliate: true,
        slug: e.affiliateVenueSlug ?? null,
        dateCount: 1,
        nextStartAt: e.startAt,
        minPrice: e.minPrice,
        tablesOnly: !!e.tablesOnly,
      });
    } else if (!e.displayVenueId) {
      // Soirée org-led sans club : la « maison », c'est l'organisateur.
      venueAgg.set(groupKey, {
        id: groupKey,
        name: e.organizerName || e.venueName,
        city: e.venueCity,
        coverUrl: e.organizerAvatarUrl || e.posterUrl,
        logoUrl: e.organizerAvatarUrl ?? null,
        isAffiliate: false,
        isOrganizer: true,
        slug: e.organizerIsPublic ? e.organizerSlug ?? null : null,
        dateCount: 1,
        nextStartAt: e.startAt,
        minPrice: e.minPrice,
        tablesOnly: false,
      });
    } else {
      const venue = venueMap.get(e.displayVenueId);
      if (!venue) continue;
      venueAgg.set(groupKey, {
        id: venue.id,
        name: venue.name,
        city: venue.city,
        coverUrl: venue.cover_url || null,
        logoUrl: venue.logo_url || null,
        isAffiliate: false,
        dateCount: 1,
        nextStartAt: e.startAt,
        minPrice: e.minPrice,
        tablesOnly: false,
      });
    }
  }
  const venues = Array.from(venueAgg.values()).sort(
    (a, b) => new Date(a.nextStartAt).getTime() - new Date(b.nextStartAt).getTime(),
  );

  const offersCount = upcoming.reduce(
    (n, e) => n + (e.hasTickets ? 1 : 0) + (e.hasTables ? 1 : 0) + (e.hasGuestList ? 1 : 0),
    0,
  );

  const status: ZoneDensityStatus =
    upcoming.length === 0
      ? 'empty'
      : upcoming.length === 1
        ? 'single'
        : weekCount < LOW_DENSITY_WEEK_MAX
          ? 'low'
          : 'full';

  return {
    status,
    upcoming,
    weekCount,
    clubsCount: venues.length,
    offersCount,
    venues,
    elsewhere,
    elsewhereCityCount,
  };
}

export function useZoneDensity(city: string, userLocation: { lat: number; lng: number } | null) {
  const query = useQuery({
    queryKey: ['explore-density', city, userLocation?.lat ?? null, userLocation?.lng ?? null],
    queryFn: () => fetchZoneDensity(city, userLocation),
  });
  // Échec réseau -> feed standard (fail-open : ne jamais masquer l'Explore
  // derrière un écran de densité qu'on n'a pas pu calculer).
  const data = query.isError ? FULL_FALLBACK : query.data;
  return { density: data ?? FULL_FALLBACK, isLoading: query.isLoading && !query.isError };
}
