import { supabase } from '@/integrations/supabase/client';
import { bucketHourParis } from '@/lib/liveops/nightWindow';

/**
 * "Last comparable night" benchmark for the live pulse hero.
 *
 * Fetched once per page load (never inside the realtime refetch cycle):
 * grabs the venue's recently finished events (60 days), prefers the most
 * recent one on the same Paris weekday as the running event, and turns its
 * orders + entry scans into cumulative series indexed by minutes-since-start.
 * The hero then reads "where was that night at the same elapsed time".
 */

export interface CumulativePoint {
  /** Minutes since the comparable event's start_at. */
  minute: number;
  /** Cumulative value at that minute (entries or € revenue). */
  cum: number;
}

export interface ComparableNight {
  eventId: string;
  eventTitle: string;
  startAt: string;
  /** 'same_weekday' when we matched the weekday, 'most_recent' fallback. */
  match: 'same_weekday' | 'most_recent';
  entriesSeries: CumulativePoint[];
  revenueSeries: CumulativePoint[];
  totalEntries: number;
  totalRevenue: number;
}

function parisWeekday(iso: string): number {
  // bucketHourParis handles hours; for weekday we need a dedicated formatter.
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short' })
    .format(new Date(iso));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(day);
}

function buildCumulativeSeries(timestamps: { at: string; value: number }[], startAt: string): CumulativePoint[] {
  const startMs = new Date(startAt).getTime();
  const sorted = timestamps
    .map(t => ({ minute: Math.max(0, Math.floor((new Date(t.at).getTime() - startMs) / 60_000)), value: t.value }))
    .sort((a, b) => a.minute - b.minute);
  const series: CumulativePoint[] = [];
  let cum = 0;
  sorted.forEach(({ minute, value }) => {
    cum += value;
    const last = series[series.length - 1];
    if (last && last.minute === minute) last.cum = cum;
    else series.push({ minute, cum });
  });
  return series;
}

/** Cumulative value of a series at a given elapsed time (step function). */
export function seriesValueAt(series: CumulativePoint[], elapsedMinutes: number): number {
  let value = 0;
  for (const point of series) {
    if (point.minute > elapsedMinutes) break;
    value = point.cum;
  }
  return value;
}

export async function fetchComparableNight(
  venueId: string,
  currentEvent: { id: string; start_at: string },
): Promise<ComparableNight | null> {
  const nowIso = new Date().toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();

  const { data: candidates } = await supabase
    .from('events')
    .select('id, title, start_at, end_at')
    .eq('venue_id', venueId)
    .neq('id', currentEvent.id)
    .lt('end_at', nowIso)
    .gte('end_at', sixtyDaysAgo)
    .order('start_at', { ascending: false })
    .limit(12);

  if (!candidates || candidates.length === 0) return null;

  const currentWeekday = parisWeekday(currentEvent.start_at);
  const sameWeekday = candidates.find(c => parisWeekday(c.start_at) === currentWeekday);
  const chosen = sameWeekday ?? candidates[0];

  const [ordersRes, ticketsRes, tablesRes] = await Promise.all([
    supabase
      .from('orders')
      .select('created_at, total, service_fee, status')
      .eq('event_id', chosen.id)
      .in('status', ['paid', 'served']),
    supabase
      .from('tickets')
      .select('entry_scanned_at, total_price, service_fee, insurance_fee')
      .eq('event_id', chosen.id)
      .eq('status', 'paid'),
    supabase
      .from('table_reservations')
      .select('entry_scanned_at, deposit, status')
      .eq('event_id', chosen.id),
  ]);

  const orders = ordersRes.data || [];
  const tickets = ticketsRes.data || [];
  const tables = tablesRes.data || [];

  const entryEvents = [
    ...tickets.filter(t => t.entry_scanned_at).map(t => ({ at: t.entry_scanned_at as string, value: 1 })),
    ...tables.filter(t => t.entry_scanned_at).map(t => ({ at: t.entry_scanned_at as string, value: 1 })),
  ];
  // Revenue trajectory tracks the bar (orders) — tickets are mostly pre-sold
  // before doors and would flatten the "how is tonight pacing" signal.
  const revenueEvents = orders.map(o => ({
    at: o.created_at,
    value: Number(o.total || 0) - Number(o.service_fee || 0),
  }));

  const entriesSeries = buildCumulativeSeries(entryEvents, chosen.start_at);
  const revenueSeries = buildCumulativeSeries(revenueEvents, chosen.start_at);

  return {
    eventId: chosen.id,
    eventTitle: chosen.title,
    startAt: chosen.start_at,
    match: sameWeekday ? 'same_weekday' : 'most_recent',
    entriesSeries,
    revenueSeries,
    totalEntries: entriesSeries.length ? entriesSeries[entriesSeries.length - 1].cum : 0,
    totalRevenue: revenueSeries.length ? revenueSeries[revenueSeries.length - 1].cum : 0,
  };
}
