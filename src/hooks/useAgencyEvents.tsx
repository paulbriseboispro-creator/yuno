import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type AgencyUpcomingEvent = {
  event_id: string;
  title: string;
  start_at: string;
  venue_id: string | null;
  venue_name: string | null;
  organizer_user_id: string | null;
  is_active: boolean;
  assigned_promoter_count: number;
};

export function useAgencyEvents(agencyId: string | null, daysAhead = 30) {
  const [events, setEvents] = useState<AgencyUpcomingEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!agencyId) { setEvents([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await (supabase as any).rpc('get_agency_upcoming_events', {
      p_agency_id: agencyId,
      p_days_ahead: daysAhead,
    });
    setEvents((data as AgencyUpcomingEvent[]) ?? []);
    setLoading(false);
  }, [agencyId, daysAhead]);

  useEffect(() => { refetch(); }, [refetch]);

  return { events, loading, refetch };
}
