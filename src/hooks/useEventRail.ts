import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** La portée lue : le club, ou l'organisateur (son équipe comprise). */
export interface RailScope { venueId?: string | null; organizerUserId?: string | null }

export interface RailEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  poster: string | null;
  phase: 'before' | 'live' | 'after';
  tickets: number;
  tables: number;
  guests: number;
  /** Emails distincts (même définition que la Communauté d'une soirée). */
  people: number;
  visits: number;
  /** `null` = l'appelant ne voit pas l'argent de cette soirée. */
  revenue: number | null;
}

/**
 * La colonne des soirées (`get_analytics_event_rail`) : une ligne par soirée de
 * la portée, avec le chiffre de chaque famille calculé comme la vue qu'elle ouvre.
 */
export function useEventRail(scope: RailScope) {
  const venueId = scope.venueId ?? null;
  const organizerUserId = scope.organizerUserId ?? null;
  const [events, setEvents] = useState<RailEvent[] | null>(null);
  const [money, setMoney] = useState(false);

  useEffect(() => {
    setEvents(null);
    if (!venueId && !organizerUserId) return;
    let alive = true;
    (async () => {
      const { data, error } = await supabase.rpc('get_analytics_event_rail' as never, {
        p_venue_id: venueId, p_organizer_user_id: organizerUserId, p_limit: 80,
      } as never);
      if (!alive) return;
      const res = data as unknown as { ok: boolean; money?: boolean; events?: RailEvent[] } | null;
      if (error || !res?.ok) { setEvents([]); return; }
      setMoney(!!res.money);
      setEvents(res.events ?? []);
    })();
    return () => { alive = false; };
  }, [venueId, organizerUserId]);

  return { events, money };
}
