/**
 * Marché d'une soirée pour l'analytics, quand la page n'a que son id (pages
 * Verify* de retour de Stripe). Une lecture légère de `events` ; en cas
 * d'échec (RLS, réseau), les ids seuls — l'événement part quand même.
 */
import { supabase } from '@/integrations/supabase/client';
import { marketProps } from '@/lib/geo';

export async function fetchEventMarket(
  eventId: string | null | undefined,
  venueId?: string | null,
): Promise<Record<string, string>> {
  const fallback = marketProps({ eventId, venueId });
  if (!eventId) return fallback;
  try {
    const { data } = await supabase
      .from('events')
      .select('timezone, location_city, venue_id, partner_venue_id, organizer_user_id')
      .eq('id', eventId)
      .maybeSingle();
    if (!data) return fallback;
    return marketProps({
      timezone: data.timezone,
      city: data.location_city,
      eventId,
      venueId: venueId ?? data.venue_id ?? data.partner_venue_id,
      organizerUserId: data.organizer_user_id,
    });
  } catch {
    return fallback;
  }
}
