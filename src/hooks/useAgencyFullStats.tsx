import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type PromoterStat = {
  promoter_id: string;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
  promo_code: string | null;
  agency_group_id: string | null;
  venue_id: string | null;
  venue_name: string | null;
  organizer_user_id: string | null;
  total_gross: number;
  total_margin: number;
  total_net: number;
  ticket_count: number;
  ticket_gross: number;
  ticket_commission: number;
  table_count: number;
  table_gross: number;
  table_commission: number;
  guest_list_count: number;
  events_covered: number;
  first_conversion_at: string | null;
  last_conversion_at: string | null;
  pending_amount: number;
  total_paid: number;
};

export type EventStat = {
  event_id: string;
  event_title: string;
  event_start_at: string;
  venue_id: string;
  venue_name: string;
  total_gross: number;
  total_margin: number;
  promoter_count: number;
  ticket_count: number;
  ticket_gross: number;
  table_count: number;
  table_gross: number;
  guest_list_count: number;
};

const n = (v: unknown) => Number(v || 0);

export function useAgencyFullStats(
  agencyId: string | null,
  dateFrom: Date | null,
  dateTo: Date | null,
) {
  const [promoterStats, setPromoterStats] = useState<PromoterStat[]>([]);
  const [eventStats, setEventStats] = useState<EventStat[]>([]);
  const [loading, setLoading] = useState(false);
  const db = supabase as any;

  const load = useCallback(async () => {
    if (!agencyId) return;
    setLoading(true);
    const params = {
      p_agency_id: agencyId,
      p_date_from: dateFrom?.toISOString() ?? null,
      p_date_to:   dateTo?.toISOString()   ?? null,
    };
    const [{ data: ps, error: e1 }, { data: es, error: e2 }] = await Promise.all([
      db.rpc('get_agency_promoter_full_stats', params),
      db.rpc('get_agency_event_full_stats',    params),
    ]);
    if (!e1) {
      setPromoterStats(((ps ?? []) as any[]).map(r => ({
        ...r,
        total_gross:       n(r.total_gross),
        total_margin:      n(r.total_margin),
        total_net:         n(r.total_net),
        ticket_count:      n(r.ticket_count),
        ticket_gross:      n(r.ticket_gross),
        ticket_commission: n(r.ticket_commission),
        table_count:       n(r.table_count),
        table_gross:       n(r.table_gross),
        table_commission:  n(r.table_commission),
        guest_list_count:  n(r.guest_list_count),
        events_covered:    n(r.events_covered),
        pending_amount:    n(r.pending_amount),
        total_paid:        n(r.total_paid),
      })));
    }
    if (!e2) {
      setEventStats(((es ?? []) as any[]).map(r => ({
        ...r,
        total_gross:      n(r.total_gross),
        total_margin:     n(r.total_margin),
        promoter_count:   n(r.promoter_count),
        ticket_count:     n(r.ticket_count),
        ticket_gross:     n(r.ticket_gross),
        table_count:      n(r.table_count),
        table_gross:      n(r.table_gross),
        guest_list_count: n(r.guest_list_count),
      })));
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyId, dateFrom?.toISOString(), dateTo?.toISOString()]);

  useEffect(() => { load(); }, [load]);

  return { promoterStats, eventStats, loading, refetch: load };
}
