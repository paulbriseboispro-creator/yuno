import { useQuery } from '@tanstack/react-query';
import { forPublicPricing } from '@/types/ticketing';
import { supabase } from '@/integrations/supabase/client';
import { affiliateMinPrice } from '@/lib/eventPriceLabel';
import type { EventCardData } from '@/components/explore/EventCard';

/**
 * Charge les soirées citées par l'assistant, par id, pour les rendre en cartes.
 *
 * L'edge function ne renvoie que du texte : le front relit la base avec les
 * MÊMES filtres publics que l'Explore (is_active / public / is_discoverable).
 * Une soirée qui ne passe pas ces filtres ne rend aucune carte — l'assistant ne
 * peut donc pas faire apparaître une soirée privée en inventant un id.
 *
 * La carte porte deux arguments que l'Explore n'affiche pas et qui décident
 * souvent de la sortie : l'heure d'entrée gratuite (guest list) et le prix
 * plancher d'une table.
 */
export interface AssistantEventCardData extends EventCardData {
  /** Heure limite d'entrée gratuite (HH:MM) quand une guest list est ouverte. */
  freeBefore?: string | null;
  /** Prix plancher d'une table sur cette soirée. */
  tableMinPrice?: number | null;
}

async function fetchAssistantEvents(ids: string[]): Promise<AssistantEventCardData[]> {
  const { data: events } = await supabase
    .from('events')
    .select('id, slug, title, poster_url, start_at, end_at, venue_id, partner_venue_id, organizer_user_id, music_genre, music_genres, event_type, location_name, location_city, ticketing_enabled, tables_enabled')
    .in('id', ids)
    .eq('is_active', true)
    .eq('visibility', 'public')
    .eq('is_discoverable', true);

  const found = events || [];
  const foundIds = found.map((e) => e.id);
  // Ce qui n'est pas une soirée Yuno peut être une soirée partenaire.
  const affiliateIds = ids.filter((id) => !foundIds.includes(id));

  const venueIds = Array.from(new Set(
    found.map((e) => e.venue_id || e.partner_venue_id).filter(Boolean) as string[],
  ));
  const organizerIds = Array.from(new Set(
    found.map((e) => e.organizer_user_id).filter(Boolean) as string[],
  ));
  const EMPTY = { data: [] as never[] };

  const [venuesRes, orgsRes, roundsRes, guestListsRes, packsRes, affiliateRes] = await Promise.all([
    venueIds.length
      ? supabase.from('venues').select('id, name, city').in('id', venueIds)
      : EMPTY,
    organizerIds.length
      ? supabase.from('organizer_profiles').select('user_id, display_name, slug').in('user_id', organizerIds)
      : EMPTY,
    foundIds.length
      ? supabase.from('ticket_rounds').select('event_id, price, is_active, audience').in('event_id', foundIds)
      : EMPTY,
    foundIds.length
      ? supabase.from('guest_lists').select('event_id, free_before_time').in('event_id', foundIds).eq('is_active', true)
      : EMPTY,
    foundIds.length
      ? supabase.from('table_packs').select('event_id, venue_id, base_price').in('event_id', foundIds).eq('is_active', true)
      : EMPTY,
    affiliateIds.length
      ? supabase.from('affiliate_events')
          .select('id, name, slug, event_date, start_time, flyer_url, genres, price_from, is_free, tables_only, affiliate_venues(id, name, city)')
          .in('id', affiliateIds)
          .in('status', ['published', 'featured'])
      : EMPTY,
  ]);

  const venueMap = new Map((venuesRes.data || []).map((v) => [v.id, v]));
  const orgMap = new Map((orgsRes.data || []).map((o) => [o.user_id, o]));

  const minPrice: Record<string, number> = {};
  forPublicPricing(roundsRes.data || []).forEach((r) => {
    if (!r.is_active) return;
    if (minPrice[r.event_id] === undefined || r.price < minPrice[r.event_id]) minPrice[r.event_id] = r.price;
  });

  const tableMin: Record<string, number> = {};
  (packsRes.data || []).forEach((p) => {
    if (!p.event_id || !(Number(p.base_price) > 0)) return;
    const price = Number(p.base_price);
    if (tableMin[p.event_id] === undefined || price < tableMin[p.event_id]) tableMin[p.event_id] = price;
  });

  const freeBefore: Record<string, string> = {};
  (guestListsRes.data || []).forEach((g) => {
    if (g.event_id && g.free_before_time) freeBefore[g.event_id] = String(g.free_before_time).slice(0, 5);
  });

  const cards: AssistantEventCardData[] = found.map((e) => {
    const isOrganizerLed = !!e.organizer_user_id;
    const displayVenueId = e.venue_id || (isOrganizerLed ? e.partner_venue_id : null);
    const venue = displayVenueId ? venueMap.get(displayVenueId) : undefined;
    const org = isOrganizerLed && e.organizer_user_id ? orgMap.get(e.organizer_user_id) : undefined;
    const genres = e.music_genres?.length
      ? (e.music_genres as string[])
      : e.music_genre ? [e.music_genre] : [];
    return {
      id: e.id,
      slug: e.slug ?? null,
      organizerSlug: org?.slug ?? null,
      title: e.title,
      posterUrl: e.poster_url,
      startAt: e.start_at,
      endAt: e.end_at,
      // Soirée d'organisateur sans club : le lieu vit sur l'event lui-même.
      venueName: venue?.name || e.location_name || org?.display_name || '',
      venueSlug: displayVenueId || '',
      venueCity: venue?.city || e.location_city || '',
      minPrice: minPrice[e.id] ?? null,
      tablesOnly: !!e.tables_enabled && e.ticketing_enabled === false,
      tableMinPrice: tableMin[e.id] ?? null,
      freeBefore: freeBefore[e.id] ?? null,
      genres,
      interestedCount: 0,
      percentSold: 0,
      tablesRemaining: null,
      isTrending: false,
      eventType: e.event_type || 'club',
      isOrganizerLed,
      organizerName: org?.display_name,
    };
  });

  const affiliateCards: AssistantEventCardData[] = (affiliateRes.data || []).flatMap((ae) => {
    const venue = ae.affiliate_venues;
    if (!venue) return [];
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
      tablesOnly: !!ae.tables_only,
      genres: ae.genres || [],
      interestedCount: 0,
      percentSold: 0,
      tablesRemaining: null,
      isTrending: false,
      eventType: 'affiliate',
      isAffiliate: true,
      affiliateEventSlug: ae.slug,
    } as AssistantEventCardData];
  });

  // Respecter l'ordre dans lequel l'assistant les a cités.
  const byId = new Map([...cards, ...affiliateCards].map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as AssistantEventCardData[];
}

export function useAssistantEventCards(ids: string[]) {
  const key = [...ids].sort().join(',');
  return useQuery({
    queryKey: ['assistant-event-cards', key],
    queryFn: () => fetchAssistantEvents(ids),
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
