import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { orgEventsOr, venueEventsOr } from '@/lib/coorg';
import type { ScopeEventOption } from '@/components/event-report/ReportTrend';

/** Les soirées de la portée, pour changer de soirée et pour comparer. */
export function useScopeEvents(scope: { venueId?: string | null; organizerUserId?: string | null }) {
  const [events, setEvents] = useState<ScopeEventOption[]>([]);
  const venueId = scope.venueId ?? null;
  const organizerUserId = scope.organizerUserId ?? null;
  useEffect(() => {
    if (!venueId && !organizerUserId) return;
    let cancelled = false;
    (async () => {
      const filter = venueId
        ? venueEventsOr(venueId)
        : orgEventsOr(organizerUserId);
      const { data } = await supabase
        .from('events')
        .select('id, title, start_at')
        .or(filter)
        .is('cancelled_at', null)
        .order('start_at', { ascending: false })
        .limit(120);
      if (!cancelled) setEvents((data ?? []).map((e) => ({ id: e.id, title: e.title, startAt: e.start_at })));
    })();
    return () => { cancelled = true; };
  }, [venueId, organizerUserId]);
  return events;
}
