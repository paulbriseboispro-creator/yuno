import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { subDays, subHours, startOfDay } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import type { AnalyticsMode, DateRange } from '@/hooks/useAnalyticsData';

/**
 * "The night" analytics — what happened at the door, not just online.
 * For a club, who actually SHOWED UP matters as much as who paid: no-show rate,
 * real attendance (heads through the door), guestlist fill, and arrival peak hours.
 * All measurable from existing scan columns (entry_scanned / checked_in_at).
 */
export interface NightAnalytics {
  /** Paid ticket quantity. */
  ticketsSold: number;
  /** Scanned ticket quantity (entry_scanned). */
  ticketsScanned: number;
  /** 0–100, share of paid tickets that never came through the door. */
  ticketNoShowRate: number;
  /** Paid table reservations. */
  tablesBooked: number;
  /** Reservations that checked in. */
  tablesArrived: number;
  tableNoShowRate: number;
  /** Guestlist names registered. */
  guestlistSize: number;
  guestlistArrived: number;
  guestlistFillRate: number;
  /** Total heads through the door = scanned tickets + checked-in table guests + scanned guestlist. */
  attendance: number;
  /** Arrivals by Paris hour, for the real peak-arrival curve (vs purchase hour). */
  arrivalsByHour: { hour: string; arrivals: number }[];
}

const parisHour = (d: string | Date): number => Number(formatInTimeZone(new Date(d), PARIS_TIMEZONE, 'H'));

function getStartDate(dateRange: DateRange): Date | null {
  if (dateRange === '24h') return subHours(new Date(), 24);
  if (dateRange === '48h') return subHours(new Date(), 48);
  if (dateRange === '72h') return subHours(new Date(), 72);
  if (dateRange === '7days') return startOfDay(subDays(new Date(), 7));
  if (dateRange === '30days') return startOfDay(subDays(new Date(), 30));
  return null;
}

interface UseNightAnalyticsProps {
  venueId?: string | null;
  dateRange: DateRange;
  mode: AnalyticsMode;
  selectedEventId: string | null;
}

export function useNightAnalytics({ venueId, dateRange, mode, selectedEventId }: UseNightAnalyticsProps) {
  const [data, setData] = useState<NightAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const startDate = mode === 'event' ? null : getStartDate(dateRange);
      const eventFilter = mode === 'event' && selectedEventId ? selectedEventId : null;

      // Tickets (entry_scanned). Scope to venue events / period / single event.
      let tq = supabase
        .from('tickets')
        .select('quantity, entry_scanned, entry_scanned_at, events!inner(venue_id)')
        .eq('status', 'paid');
      if (eventFilter) tq = tq.eq('event_id', eventFilter);
      else { tq = tq.eq('events.venue_id', venueId); if (startDate) tq = tq.gte('created_at', startDate.toISOString()); }
      const { data: tickets } = await tq;

      // Table reservations (checked_in_at / entry_scanned).
      let rq = supabase
        .from('table_reservations')
        .select('guest_count, checked_in_at, entry_scanned, entry_scanned_at, events!inner(venue_id)')
        .eq('status', 'paid');
      if (eventFilter) rq = rq.eq('event_id', eventFilter);
      else { rq = rq.eq('events.venue_id', venueId); if (startDate) rq = rq.gte('created_at', startDate.toISOString()); }
      const { data: tables } = await rq;

      // Guestlist entries (joined through guest_lists for venue/event scope).
      let gq = supabase
        .from('guest_list_entries')
        .select('entry_scanned, entry_scanned_at, guest_lists!inner(venue_id, event_id)')
        .eq('guest_lists.venue_id', venueId);
      if (eventFilter) gq = gq.eq('guest_lists.event_id', eventFilter);
      const { data: guestlist } = await gq;

      const tk = tickets || [];
      const ticketsSold = tk.reduce((s, t: any) => s + (t.quantity || 0), 0);
      const ticketsScanned = tk.filter((t: any) => t.entry_scanned).reduce((s, t: any) => s + (t.quantity || 0), 0);
      const ticketNoShowRate = ticketsSold > 0 ? Math.max(0, (1 - ticketsScanned / ticketsSold) * 100) : 0;

      const tb = tables || [];
      const tablesBooked = tb.length;
      const arrivedTables = tb.filter((r: any) => r.checked_in_at || r.entry_scanned);
      const tablesArrived = arrivedTables.length;
      const tableNoShowRate = tablesBooked > 0 ? Math.max(0, (1 - tablesArrived / tablesBooked) * 100) : 0;
      const tableGuestsArrived = arrivedTables.reduce((s, r: any) => s + (r.guest_count || 1), 0);

      const gl = guestlist || [];
      const guestlistSize = gl.length;
      const guestlistArrived = gl.filter((g: any) => g.entry_scanned).length;
      const guestlistFillRate = guestlistSize > 0 ? (guestlistArrived / guestlistSize) * 100 : 0;

      const attendance = ticketsScanned + tableGuestsArrived + guestlistArrived;

      // Arrival curve from scan timestamps (real door peak, not purchase peak).
      const hourBuckets = new Array(24).fill(0);
      const addArrival = (ts: string | null | undefined, weight: number) => {
        if (!ts) return;
        hourBuckets[parisHour(ts)] += weight;
      };
      tk.forEach((t: any) => { if (t.entry_scanned) addArrival(t.entry_scanned_at, t.quantity || 1); });
      tb.forEach((r: any) => { if (r.checked_in_at || r.entry_scanned) addArrival(r.checked_in_at || r.entry_scanned_at, r.guest_count || 1); });
      gl.forEach((g: any) => { if (g.entry_scanned) addArrival(g.entry_scanned_at, 1); });
      const arrivalsByHour = hourBuckets
        .map((arrivals, hour) => ({ hour: `${hour}h`, arrivals }))
        .filter(d => d.arrivals > 0);

      setData({
        ticketsSold, ticketsScanned, ticketNoShowRate,
        tablesBooked, tablesArrived, tableNoShowRate,
        guestlistSize, guestlistArrived, guestlistFillRate,
        attendance, arrivalsByHour,
      });
    } catch (err) {
      console.error('Error fetching night analytics:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [venueId, dateRange, mode, selectedEventId]);

  useEffect(() => { if (venueId) fetch(); }, [venueId, fetch]);

  return { nightAnalytics: data, loading };
}
