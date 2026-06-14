import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Resolves all event_ids AND venue_ids associated with an organizer
 * (as primary or partner). Used to broaden visitor_sessions queries
 * because anonymous traffic is most often tracked by venue page (the
 * organizer/event tag may be missing on older sessions or sessions that
 * never landed on the event detail page).
 */
export function useOrganizerEventIds(organizerUserId?: string | null) {
  const [eventIds, setEventIds] = useState<string[]>([]);
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizerUserId) {
      setEventIds([]);
      setVenueIds([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('events')
        .select('id, venue_id, partner_venue_id')
        .or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`);
      if (!cancelled) {
        const evs = data ?? [];
        setEventIds(evs.map((e: any) => e.id));
        const vSet = new Set<string>();
        evs.forEach((e: any) => {
          if (e.venue_id) vSet.add(e.venue_id);
          if (e.partner_venue_id) vSet.add(e.partner_venue_id);
        });
        setVenueIds([...vSet]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [organizerUserId]);

  return { eventIds, venueIds, loading };
}
