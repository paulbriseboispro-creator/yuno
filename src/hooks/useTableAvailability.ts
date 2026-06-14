import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useTableAvailability(eventId: string | undefined) {
  const [unavailableTableIds, setUnavailableTableIds] = useState<Set<string>>(new Set());
  /** Count of reservations where no table was requested (assign_on_arrival) — these still consume zone capacity */
  const [unplacedReservationCount, setUnplacedReservationCount] = useState(0);
  /** Number of active reservations per zone (pending/paid/confirmed). Used to enforce zone tables_count cap. */
  const [reservationsByZone, setReservationsByZone] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }

    const fetchAvailability = async () => {
      const { data } = await supabase
        .from('table_reservations')
        .select('requested_table_id, assigned_table_id, placement_status, guest_count, zone_id, status')
        .eq('event_id', eventId)
        .in('status', ['pending', 'paid', 'confirmed']);

      const ids = new Set<string>();
      const byZone: Record<string, number> = {};
      let unplaced = 0;

      (data || []).forEach((r: any) => {
        // A table is unavailable if it's requested/approved/assigned
        if (r.requested_table_id && ['requested', 'approved'].includes(r.placement_status || '')) {
          ids.add(r.requested_table_id);
        }
        if (r.assigned_table_id) {
          ids.add(r.assigned_table_id);
        }
        // Count assign_on_arrival reservations (no specific table chosen — staff will assign)
        if (r.placement_status === 'assign_on_arrival' && !r.assigned_table_id) {
          unplaced++;
        }
        // Zone occupancy tracking — every active reservation eats one slot.
        if (r.zone_id) {
          byZone[r.zone_id] = (byZone[r.zone_id] || 0) + 1;
        }
      });

      setUnavailableTableIds(ids);
      setUnplacedReservationCount(unplaced);
      setReservationsByZone(byZone);
      setLoading(false);
    };

    fetchAvailability();

    // Real-time subscription
    const channel = supabase
      .channel(`table-availability-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'table_reservations',
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          fetchAvailability();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  return { unavailableTableIds, unplacedReservationCount, reservationsByZone, loading };
}
