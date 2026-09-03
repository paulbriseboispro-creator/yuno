import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cityMatches } from '@/lib/userLocation';
import { affiliateMinPrice } from '@/lib/eventPriceLabel';
import type { EventCardData } from '@/components/explore/EventCard';
import { localTodayStr, type FeaturedMoment } from '@/data/featuredMoments';

// Soirées d'un moment éditorial : natives + affiliées publiées, ville du
// moment, fenêtre [max(aujourd'hui, startDate), endDate] — les soirs passés
// sortent du programme au fil de la quinzaine. Mêmes règles de visibilité que
// l'Explore (is_active/public/is_discoverable ; published/featured), aucune
// distinction d'agence : chaque soirée crédite la sienne via son propre lien.
//
// Partagé entre la bannière Explore (compteurs + flyers du collage) et la page
// programme : même queryKey → le tap sur la bannière ouvre une page déjà
// chargée depuis le cache react-query.

export interface MomentDayGroup {
  /** yyyy-MM-dd */
  date: string;
  events: EventCardData[];
}

export interface MomentEventsData {
  groups: MomentDayGroup[];
  total: number;
  clubCount: number;
  /** Jusqu'à 3 flyers (clubs distincts d'abord) pour le collage de la bannière. */
  flyers: string[];
}

const EMPTY: MomentEventsData = { groups: [], total: 0, clubCount: 0, flyers: [] };

async function fetchMomentEvents(moment: FeaturedMoment): Promise<MomentEventsData> {
  const today = localTodayStr();
  const fromDate = today > moment.startDate ? today : moment.startDate;
  const toDate = moment.endDate;
  // Sans suffixe Z : parsé en heure locale, cohérent avec les dates du moment.
  const startIso = new Date(`${fromDate}T00:00:00`).toISOString();
  const endIso = new Date(`${toDate}T23:59:59.999`).toISOString();

  const [eventsRes, venuesRes, affiliateRes] = await Promise.all([
    supabase
      .from('events')
      .select('id, slug, title, poster_url, start_at, end_at, venue_id, partner_venue_id, organizer_user_id, is_active, music_genre, music_genres, event_type, location_city')
      .eq('is_active', true)
      .eq('visibility', 'public')
      .eq('is_discoverable', true)
      .gte('start_at', startIso)
      .lte('start_at', endIso)
      .order('start_at', { ascending: true })
      .limit(500),
    supabase
      .from('venues')
      .select('id, name, city, cover_url, logo_url'),
    supabase
      .from('affiliate_events')
      .select('id, name, slug, event_date, start_time, flyer_url, genres, price_from, is_free, tables_only, affiliate_venues(id, name, city)')
      .in('status', ['published', 'featured'])
      .gte('event_date', fromDate)
      .lte('event_date', toDate)
      .order('event_date', { ascending: true }),
  ]);

  const venueMap = new Map((venuesRes.data || []).map(v => [v.id, v]));

  // Slugs d'orga pour les liens propres /events/:orgSlug/:eventSlug.
  const organizerUserIds = Array.from(
    new Set((eventsRes.data || []).map(e => e.organizer_user_id).filter(Boolean) as string[]),
  );
  const organizerSlugMap = new Map<string, string | null>();
  const eventIds = (eventsRes.data || []).map(e => e.id);
  // Bornés aux soirées du moment — jamais « toute la table » des tarifs.
  const [orgRes, ticketRes] = await Promise.all([
    organizerUserIds.length > 0
      ? supabase.from('organizer_profiles').select('user_id, slug').in('user_id', organizerUserIds)
      : Promise.resolve({ data: [] as { user_id: string; slug: string | null }[] }),
    eventIds.length > 0
      ? supabase.from('ticket_rounds').select('event_id, price, is_active').in('event_id', eventIds)
      : Promise.resolve({ data: [] as { event_id: string; price: number; is_active: boolean | null }[] }),
  ]);
  (orgRes.data || []).forEach(op => organizerSlugMap.set(op.user_id, op.slug));

  const minPriceMap: Record<string, number> = {};
  (ticketRes.data || []).forEach(tr => {
    if (tr.is_active) {
      const prev = minPriceMap[tr.event_id];
      if (prev === undefined || tr.price < prev) minPriceMap[tr.event_id] = tr.price;
    }
  });

  const regularCards: EventCardData[] = (eventsRes.data || []).flatMap(e => {
    const isOrganizerLed = !!e.organizer_user_id;
    const displayVenueId = e.venue_id || (isOrganizerLed ? e.partner_venue_id : null);
    const venue = displayVenueId ? venueMap.get(displayVenueId) : undefined;
    const venueCity = venue?.city || e.location_city || '';
    if (!cityMatches(venueCity, moment.city)) return [];
    const genres =
      (e.music_genres && e.music_genres.length > 0)
        ? (e.music_genres as string[])
        : e.music_genre ? [e.music_genre] : [];
    return [{
      id: e.id,
      slug: e.slug ?? null,
      organizerSlug: isOrganizerLed ? (organizerSlugMap.get(e.organizer_user_id!) ?? null) : null,
      title: e.title,
      posterUrl: e.poster_url,
      startAt: e.start_at,
      endAt: e.end_at,
      venueName: venue?.name || '',
      venueSlug: displayVenueId || '',
      venueCity,
      minPrice: minPriceMap[e.id] ?? null,
      genres,
      interestedCount: 0,
      percentSold: 0,
      tablesRemaining: null,
      isTrending: false,
      eventType: e.event_type || 'club',
      isOrganizerLed,
    }] as EventCardData[];
  });

  const affiliateCards: EventCardData[] = (affiliateRes.data || []).flatMap(ae => {
    const venue = ae.affiliate_venues;
    if (!venue) return [];
    if (!cityMatches(venue.city || '', moment.city)) return [];
    const startAt = `${ae.event_date}T${(ae.start_time || '22:00').substring(0, 5)}:00`;
    return [{
      id: ae.id,
      title: ae.name,
      posterUrl: ae.flyer_url,
      startAt,
      endAt: startAt,
      venueName: venue.name,
      venueSlug: venue.id,
      venueCity: venue.city || '',
      minPrice: affiliateMinPrice(ae),
      // Une soirée qui ne vend que des tables n'a pas de prix d'entrée :
      // sans ce drapeau elle s'affichait « Gratuit ».
      tablesOnly: !!ae.tables_only,
      genres: ae.genres || [],
      interestedCount: 0,
      percentSold: 0,
      tablesRemaining: null,
      isTrending: false,
      eventType: 'affiliate',
      isAffiliate: true,
      affiliateEventSlug: ae.slug,
    }] as EventCardData[];
  });

  const all = [...regularCards, ...affiliateCards].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  );

  const groups: MomentDayGroup[] = [];
  for (const ev of all) {
    const dateStr = ev.startAt.split('T')[0];
    const last = groups[groups.length - 1];
    if (last && last.date === dateStr) last.events.push(ev);
    else groups.push({ date: dateStr, events: [ev] });
  }

  const clubs = new Set(all.map(e => e.venueName.toLowerCase()).filter(Boolean));

  // Collage : un flyer par club d'abord (variété visuelle), complété si besoin.
  const flyers: string[] = [];
  const seenVenues = new Set<string>();
  for (const ev of all) {
    if (flyers.length >= 3) break;
    if (!ev.posterUrl || seenVenues.has(ev.venueSlug)) continue;
    seenVenues.add(ev.venueSlug);
    flyers.push(ev.posterUrl);
  }
  if (flyers.length < 3) {
    for (const ev of all) {
      if (flyers.length >= 3) break;
      if (ev.posterUrl && !flyers.includes(ev.posterUrl)) flyers.push(ev.posterUrl);
    }
  }

  return { groups, total: all.length, clubCount: clubs.size, flyers };
}

export function useMomentEvents(moment: FeaturedMoment | null): {
  data: MomentEventsData;
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: ['moment-events', moment?.id ?? 'none'],
    queryFn: () => fetchMomentEvents(moment as FeaturedMoment),
    enabled: !!moment,
  });
  return { data: query.data ?? EMPTY, isLoading: !!moment && query.isLoading };
}
