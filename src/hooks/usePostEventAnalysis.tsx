import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  computeNightStats,
  type NightInput,
  type NightStats,
  type TicketLite,
  type OrderLite,
  type TableLite,
  type VenueBenchmark,
} from '@/lib/hypePostEvent';
import { orderRevenue, ticketRevenue, tableRevenue } from '@/utils/fees';

export interface PostEventKPI {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
}

export interface TimelineDataPoint {
  time: string;
  orders: number;
  entries: number;
}

export interface WhatWorkedItem {
  id: string;
  label: string;
  type: 'positive' | 'negative';
  metric: string;
  value: string;
}

export interface CustomerInsight {
  returningRate: number;
  newCustomers: number;
  returningCustomers: number;
  topSegment: string;
  topDrink: string;
  topDrinkCount: number;
}

export interface ExtendedStatsData {
  attendance: number;
  attendanceChange?: number;
  showUpRate: number | null;
  sellThrough: number | null;
  revenuePerHead: number;
  revenuePerHeadChange?: number;
  avgOrderValue: number;
  drinksPerPerson: number;
  drinksPerPersonChange?: number;
  drinkRedemption: number | null;
  peakHourRevenue: number;
  peakHourLabel: string;
  tablesBooked: number;
  tablesRevenue: number;
  returningRate: number;
  medianArrival: string | null;
  refunds: number;
  netRevenue: number;
  hasScanData: boolean;
}

export interface Suggestion {
  id: string;
  text: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
}

export interface PostEventData {
  eventId: string | null;
  eventTitle: string;
  eventDate: Date | null;
  overallScore: number;
  scoreLabel: string;
  kpis: PostEventKPI[];
  extendedStats: ExtendedStatsData;
  timeline: TimelineDataPoint[];
  timelineInsights: string[];
  whatWorked: WhatWorkedItem[];
  customerInsights: CustomerInsight;
  suggestions: Suggestion[];
  notes: string;
  isAggregate?: boolean;
  // Stats brutes du moteur — consommées par le Night Report IA (payload backend).
  rawStats: NightStats;
}

type ItemsJson = { name?: string; qty?: number; quantity?: number }[];

export function usePostEventAnalysis(
  venueId: string | null,
  eventId?: string | null,
  organizerUserId?: string | null,
) {
  // Organizer scope: no venue, events keyed by organizer_user_id/partner_organizer_id,
  // and no drinks (organizers don't sell at the bar). The pure engine is reused as-is.
  const isOrg = !!organizerUserId && !venueId;
  const scopeReady = isOrg ? !!organizerUserId : !!venueId;
  const { t, language } = useLanguage();
  const tr = (key: string, params?: Record<string, string | number>) => {
    let s = t(key);
    if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{{${k}}}`, String(v));
    return s;
  };

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<{ id: string; title: string; date: Date }[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(eventId || null);
  const [postEventData, setPostEventData] = useState<PostEventData | null>(null);
  const [notes, setNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return events;
    const query = searchQuery.toLowerCase();
    return events.filter(
      (e) => e.title.toLowerCase().includes(query) || format(e.date, 'dd/MM/yyyy').includes(query),
    );
  }, [events, searchQuery]);

  useEffect(() => {
    if (!scopeReady) return;
    fetchPastEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, organizerUserId]);

  useEffect(() => {
    if (!scopeReady) return;
    if (events.length === 0 && loading) return;
    if (selectedEventId === null) {
      if (events.length > 0) buildReport(events.map((e) => e.id), true);
    } else {
      buildReport([selectedEventId], false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, organizerUserId, selectedEventId, events.length, language]);

  const fetchPastEvents = async () => {
    if (!scopeReady) return;
    let q = supabase
      .from('events')
      .select('id, title, start_at, end_at')
      .lt('end_at', new Date().toISOString())
      .order('start_at', { ascending: false })
      .limit(50);
    q = isOrg
      ? q.or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`)
      : q.eq('venue_id', venueId!);
    const { data } = await q;
    if (data) {
      setEvents(data.map((e) => ({ id: e.id, title: e.title, date: new Date(e.start_at) })));
    }
    setLoading(false);
  };

  // ── Venue benchmark from real scanned attendance of recent past events ──
  // We use the most recent (up to 12) completed events for representativeness,
  // and base the averages on REAL door scans (ticket_attendees + scanned table
  // guests). Events that were not scanned are excluded from the attendance
  // benchmark (their real attendance is unknown), so the reference isn't biased
  // downward. Sold tickets are only used as a fallback when NO past event was
  // ever scanned.
  const BENCHMARK_WINDOW = 12;
  const fetchBenchmark = async (excludeIds: string[]): Promise<VenueBenchmark> => {
    const past = events.filter((e) => !excludeIds.includes(e.id)).slice(0, BENCHMARK_WINDOW);
    const empty: VenueBenchmark = { eventsCount: 0, avgAttendance: null, avgRevenuePerHead: null, avgDrinksPerHead: null };
    if (!scopeReady || past.length === 0) return empty;
    const ids = past.map((e) => e.id);

    const [{ data: bt }, { data: bo }, { data: btab }] = await Promise.all([
      supabase
        .from('tickets')
        .select('quantity, total_price, service_fee, insurance_fee, refunded_at, refund_amount, event_id, ticket_attendees(entry_scanned)')
        .in('event_id', ids)
        .eq('status', 'paid'),
      // Organizers never sell drinks → no orders contribute to their benchmark.
      isOrg ? Promise.resolve({ data: [] as any[] }) : supabase
        .from('orders')
        .select('total, service_fee, refunded_at, refund_amount, items, event_id')
        .eq('venue_id', venueId!)
        .in('event_id', ids)
        .in('status', ['paid', 'served']),
      supabase
        .from('table_reservations')
        .select('total_price, service_fee, management_fee, guest_count, entry_scanned, refunded_at, refund_amount, event_id')
        .in('event_id', ids)
        .eq('status', 'paid'),
    ]);

    // Per-event accumulators.
    type Acc = { sold: number; scanned: number; netRev: number; drinks: number; sawScan: boolean };
    const byEvent = new Map<string, Acc>();
    const acc = (id: string) => {
      let a = byEvent.get(id);
      if (!a) { a = { sold: 0, scanned: 0, netRev: 0, drinks: 0, sawScan: false }; byEvent.set(id, a); }
      return a;
    };

    // netRev is CLUB NET: gross (Yuno fees excluded) − Stripe − refunds. The
    // benchmark must use the same basis as the report, never Yuno's cut.
    for (const t of bt || []) {
      const a = acc(t.event_id);
      const refunded = !!t.refunded_at;
      const r = ticketRevenue(t);
      a.sold += refunded ? 0 : t.quantity || 0;
      a.netRev += r.gross - r.stripe - (refunded ? Number(t.refund_amount) || 0 : 0);
      const attendees = (t.ticket_attendees as { entry_scanned: boolean | null }[]) || [];
      const sc = attendees.filter((x) => x.entry_scanned).length;
      a.scanned += sc;
      if (attendees.some((x) => x.entry_scanned)) a.sawScan = true;
    }
    for (const o of bo || []) {
      const a = acc(o.event_id);
      const refunded = !!o.refunded_at;
      const r = orderRevenue(o);
      a.netRev += r.gross - r.stripe - (refunded ? Number(o.refund_amount) || 0 : 0);
      for (const it of (o.items as ItemsJson) || []) a.drinks += it.qty || it.quantity || 0;
    }
    for (const tb of btab || []) {
      const a = acc(tb.event_id);
      const refunded = !!tb.refunded_at;
      const r = tableRevenue(tb);
      a.netRev += r.gross - r.stripe - (refunded ? Number(tb.refund_amount) || 0 : 0);
      if (tb.entry_scanned && !refunded) { a.scanned += Math.max(1, tb.guest_count || 1); a.sawScan = true; }
    }

    const all = [...byEvent.values()];
    const scannedEvents = all.filter((a) => a.sawScan && a.scanned > 0);

    if (scannedEvents.length > 0) {
      const sumAtt = scannedEvents.reduce((s, a) => s + a.scanned, 0);
      const sumRev = scannedEvents.reduce((s, a) => s + a.netRev, 0);
      const sumDrinks = scannedEvents.reduce((s, a) => s + a.drinks, 0);
      return {
        eventsCount: scannedEvents.length,
        avgAttendance: sumAtt / scannedEvents.length,
        avgRevenuePerHead: sumAtt > 0 ? sumRev / sumAtt : null,
        avgDrinksPerHead: sumAtt > 0 ? sumDrinks / sumAtt : null,
      };
    }

    // Fallback: no event was ever scanned → use sold tickets as a proxy.
    const sumSold = all.reduce((s, a) => s + a.sold, 0);
    const sumRev = all.reduce((s, a) => s + a.netRev, 0);
    const sumDrinks = all.reduce((s, a) => s + a.drinks, 0);
    return {
      eventsCount: all.length,
      avgAttendance: all.length > 0 ? sumSold / all.length : null,
      avgRevenuePerHead: sumSold > 0 ? sumRev / sumSold : null,
      avgDrinksPerHead: sumSold > 0 ? sumDrinks / sumSold : null,
    };
  };

  const buildReport = async (eventIds: string[], isAggregate: boolean) => {
    if (!scopeReady || eventIds.length === 0) return;
    try {
      setLoading(true);
      const numEvents = eventIds.length;

      // ── Fetch the real night data ──
      const [{ data: evRows }, { data: ticketRows }, { data: orderRows }, { data: tableRows }, { data: sessRows }] =
        await Promise.all([
          supabase.from('events').select('id, title, start_at, end_at, max_tickets').in('id', eventIds),
          supabase
            .from('tickets')
            .select('quantity, total_price, service_fee, insurance_fee, created_at, refunded_at, refund_amount, is_guest, user_email, ticket_attendees(entry_scanned, entry_scanned_at, drink_redeemed)')
            .in('event_id', eventIds)
            .eq('status', 'paid'),
          // Organizers don't sell drinks → no orders.
          isOrg ? Promise.resolve({ data: [] as any[] }) : supabase
            .from('orders')
            .select('total, service_fee, created_at, refunded_at, refund_amount, items, user_email')
            .eq('venue_id', venueId!)
            .in('event_id', eventIds)
            .in('status', ['paid', 'served']),
          supabase
            .from('table_reservations')
            .select('total_price, service_fee, management_fee, guest_count, created_at, entry_scanned, refunded_at, refund_amount')
            .in('event_id', eventIds)
            .eq('status', 'paid'),
          supabase.from('visitor_sessions').select('session_id').in('event_id', eventIds),
        ]);

      const evList = evRows || [];
      // Event window: single event = its window; aggregate = a synthetic 20:00→06:00 night.
      let eventStart: number;
      let eventEnd: number;
      if (!isAggregate && evList[0]) {
        eventStart = new Date(evList[0].start_at).getTime();
        eventEnd = new Date(evList[0].end_at).getTime();
      } else {
        const base = new Date();
        base.setHours(20, 0, 0, 0);
        eventStart = base.getTime();
        eventEnd = eventStart + 10 * 3_600_000;
      }
      const capacity = !isAggregate ? evList[0]?.max_tickets ?? null : null;

      // ── Shape rows for the engine ──
      // Revenue is CLUB GROSS (Yuno fees excluded via the canonical helpers);
      // each row carries its Stripe fee so net = gross − stripe − refunds.
      const tickets: TicketLite[] = (ticketRows || []).map((t) => {
        const r = ticketRevenue(t);
        return {
          quantity: t.quantity || 0,
          revenue: r.gross,
          stripe: r.stripe,
          createdAt: new Date(t.created_at).getTime(),
          refunded: !!t.refunded_at,
          refundAmount: Number(t.refund_amount) || 0,
          isGuest: !!t.is_guest,
          email: t.user_email ?? null,
          attendees: ((t.ticket_attendees as { entry_scanned: boolean | null; entry_scanned_at: string | null; drink_redeemed: boolean | null }[]) || []).map((a) => ({
            scanned: !!a.entry_scanned,
            scannedAt: a.entry_scanned_at ? new Date(a.entry_scanned_at).getTime() : null,
            drinkRedeemed: !!a.drink_redeemed,
          })),
        };
      });

      const orders: OrderLite[] = (orderRows || []).map((o) => {
        const r = orderRevenue(o);
        return {
          total: r.gross,
          stripe: r.stripe,
          createdAt: new Date(o.created_at).getTime(),
          refunded: !!o.refunded_at,
          refundAmount: Number(o.refund_amount) || 0,
          items: ((o.items as ItemsJson) || []).map((i) => ({ name: i.name || '', qty: i.qty || i.quantity || 0 })),
          email: o.user_email ?? null,
        };
      });

      const tables: TableLite[] = (tableRows || []).map((t) => {
        const r = tableRevenue(t);
        return {
          revenue: r.gross,
          stripe: r.stripe,
          guests: t.guest_count || 0,
          createdAt: new Date(t.created_at).getTime(),
          refunded: !!t.refunded_at,
          refundAmount: Number(t.refund_amount) || 0,
          scanned: !!t.entry_scanned,
        };
      });

      const pageViews = new Set((sessRows || []).map((s) => s.session_id)).size;

      // ── Audience split via venue_customers ──
      const buyerEmails = Array.from(
        new Set([...tickets.map((t) => t.email), ...orders.map((o) => o.email)].filter(Boolean) as string[]),
      ).slice(0, 800);
      let newCustomers = buyerEmails.length;
      let returningCustomers = 0;
      let topSegment: string | null = null;
      if (buyerEmails.length > 0 && isOrg) {
        // No venue_customers for organizers: a buyer is "returning" if they bought
        // at any of the organizer's OTHER past events.
        const otherIds = events.map((e) => e.id).filter((id) => !eventIds.includes(id));
        if (otherIds.length > 0) {
          const lc = buyerEmails.map((e) => e.toLowerCase());
          const [{ data: priorT }, { data: priorTab }] = await Promise.all([
            supabase.from('tickets').select('user_email').in('event_id', otherIds).eq('status', 'paid').in('user_email', buyerEmails),
            supabase.from('table_reservations').select('user_email').in('event_id', otherIds).eq('status', 'paid').in('user_email', buyerEmails),
          ]);
          const seen = new Set<string>();
          for (const r of [...(priorT || []), ...(priorTab || [])]) if (r.user_email) seen.add(r.user_email.toLowerCase());
          returningCustomers = lc.filter((e) => seen.has(e)).length;
          newCustomers = Math.max(0, buyerEmails.length - returningCustomers);
        }
      } else if (buyerEmails.length > 0) {
        const { data: vc } = await supabase
          .from('venue_customers')
          .select('email, order_count, ticket_count, customer_segment')
          .eq('venue_id', venueId!)
          .in('email', buyerEmails);
        const returning = (vc || []).filter((c) => (c.order_count || 0) + (c.ticket_count || 0) > 1);
        returningCustomers = returning.length;
        newCustomers = Math.max(0, buyerEmails.length - returningCustomers);
        const segCounts = new Map<string, number>();
        for (const c of vc || []) if (c.customer_segment) segCounts.set(c.customer_segment, (segCounts.get(c.customer_segment) || 0) + 1);
        const topSeg = [...segCounts.entries()].sort((a, b) => b[1] - a[1])[0];
        topSegment = topSeg ? topSeg[0] : null;
      }

      const benchmark = await fetchBenchmark(isAggregate ? [] : eventIds);

      const input: NightInput = {
        eventStart,
        eventEnd,
        capacity,
        tickets,
        orders,
        tables,
        pageViews,
        newCustomers,
        returningCustomers,
        topSegment,
        benchmark,
        numEvents,
      };

      const stats = computeNightStats(input);

      // ── Map NightStats → localized PostEventData ──
      setPostEventData(buildPostEventData(stats, {
        isAggregate,
        numEvents,
        eventId: isAggregate ? null : eventIds[0],
        eventTitle: isAggregate ? tr('postEvent.allEventsTitle', { count: numEvents }) : evList[0]?.title || '',
        eventDate: isAggregate ? null : evList[0] ? new Date(evList[0].start_at) : null,
        tr,
        notes: '',
      }));

      // Load saved notes for single events.
      if (!isAggregate) {
        const { data: savedNotes } = await supabase
          .from('event_notes' as never)
          .select('notes')
          .eq('event_id', eventIds[0])
          .maybeSingle();
        const notesValue = (savedNotes as { notes?: string } | null)?.notes || '';
        setNotes(notesValue);
        setPostEventData((prev) => (prev ? { ...prev, notes: notesValue } : prev));
      }
    } catch (error) {
      console.error('Error building post-event report:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveNotes = async (newNotes: string) => {
    if (!selectedEventId) return;
    setNotes(newNotes);
    setPostEventData((prev) => (prev ? { ...prev, notes: newNotes } : prev));
    await supabase
      .from('event_notes' as never)
      .upsert({ event_id: selectedEventId, notes: newNotes, updated_at: new Date().toISOString() } as never, { onConflict: 'event_id' });
  };

  return {
    loading,
    events,
    filteredEvents,
    selectedEventId,
    setSelectedEventId,
    postEventData,
    notes,
    saveNotes,
    searchQuery,
    setSearchQuery,
    refetch: () => (selectedEventId ? buildReport([selectedEventId], false) : buildReport(events.map((e) => e.id), true)),
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  Map the pure NightStats into the localized display structures.
// ════════════════════════════════════════════════════════════════════════════

interface MapCtx {
  isAggregate: boolean;
  numEvents: number;
  eventId: string | null;
  eventTitle: string;
  eventDate: Date | null;
  tr: (key: string, params?: Record<string, string | number>) => string;
  notes: string;
}

function buildPostEventData(s: NightStats, ctx: MapCtx): PostEventData {
  const { tr } = ctx;
  const eur = (n: number) => `${Math.round(n).toLocaleString()} €`;

  // ── Headline KPIs ──
  const kpis: PostEventKPI[] = [
    {
      label: tr('postEvent.kpi.attendance'),
      value: s.attendance > 0 ? s.attendance : s.ticketsSold,
      change: s.attendanceChangePct ?? undefined,
      changeLabel: s.hasScanData ? tr('postEvent.kpi.scanned') : tr('postEvent.kpi.sold'),
    },
    { label: tr('postEvent.kpi.netRevenue'), value: eur(s.netRevenue), changeLabel: s.refunds > 0 ? tr('postEvent.kpi.afterRefunds') : undefined },
    { label: tr('postEvent.kpi.ticketsSold'), value: s.ticketsSold, changeLabel: s.sellThroughPct != null ? `${Math.round(s.sellThroughPct)}% ${tr('postEvent.kpi.ofCapacity')}` : undefined },
    { label: tr('postEvent.kpi.drinksOrdered'), value: s.drinkCount, changeLabel: `${s.drinksPerHead.toFixed(1)} ${tr('postEvent.kpi.perHead')}` },
    { label: tr('postEvent.kpi.showUp'), value: s.showUpRatePct != null ? `${Math.round(s.showUpRatePct)}%` : '—', changeLabel: s.noShowRatePct != null ? `${Math.round(s.noShowRatePct)}% ${tr('postEvent.kpi.noShow')}` : undefined },
  ];

  // ── Extended stats (all real) ──
  const extendedStats: ExtendedStatsData = {
    attendance: s.attendance > 0 ? s.attendance : s.ticketsSold,
    attendanceChange: s.attendanceChangePct ?? undefined,
    showUpRate: s.showUpRatePct,
    sellThrough: s.sellThroughPct,
    revenuePerHead: s.revenuePerHead,
    revenuePerHeadChange: s.revenuePerHeadChangePct ?? undefined,
    avgOrderValue: s.avgOrderValue,
    drinksPerPerson: s.drinksPerHead,
    drinksPerPersonChange: s.drinksPerHeadChangePct ?? undefined,
    drinkRedemption: s.drinkRedemptionRatePct,
    peakHourRevenue: s.peakHourRevenue,
    peakHourLabel: s.peakHourLabel,
    tablesBooked: s.tablesBooked,
    tablesRevenue: s.tableRevenue,
    returningRate: s.returningRatePct,
    medianArrival: s.medianArrivalLabel,
    refunds: s.refunds,
    netRevenue: s.netRevenue,
    hasScanData: s.hasScanData,
  };

  // ── Timeline ──
  const timeline: TimelineDataPoint[] = s.timeline;

  // ── Timeline insights (real) ──
  const timelineInsights: string[] = [];
  if (s.peakHourLabel !== '—') {
    timelineInsights.push(tr('postEvent.ti.peakRevenueAt', { time: s.peakHourLabel, amount: eur(s.peakHourRevenue) }));
  }
  if (s.medianArrivalLabel) {
    timelineInsights.push(tr('postEvent.ti.medianArrival', { time: s.medianArrivalLabel }));
  }
  if (s.pctBeforeMidnight != null && s.pctBeforeMidnight < 30) {
    timelineInsights.push(tr('postEvent.ti.lateCrowd', { n: Math.round(100 - s.pctBeforeMidnight) }));
  } else if (s.pctBeforeMidnight != null && s.pctBeforeMidnight >= 55) {
    timelineInsights.push(tr('postEvent.ti.earlyCrowd', { n: Math.round(s.pctBeforeMidnight) }));
  }

  // ── What worked / what didn't (real signals) ──
  const whatWorked: WhatWorkedItem[] = [];
  if (s.showUpRatePct != null) {
    if (s.showUpRatePct >= 85) {
      whatWorked.push({ id: 'showup_high', label: tr('postEvent.ww.strongTurnout'), type: 'positive', metric: tr('postEvent.ww.showedUp', { n: Math.round(s.showUpRatePct) }), value: tr('postEvent.ww.lowNoShow') });
    } else if (s.showUpRatePct < 65) {
      whatWorked.push({ id: 'showup_low', label: tr('postEvent.ww.highNoShow'), type: 'negative', metric: tr('postEvent.ww.noShowMetric', { n: Math.round(s.noShowRatePct || 0) }), value: tr('postEvent.ww.tightenGuestlist') });
    }
  }
  if (s.sellThroughPct != null && s.sellThroughPct >= 90) {
    whatWorked.push({ id: 'sellout', label: tr('postEvent.ww.nearSellout'), type: 'positive', metric: tr('postEvent.ww.ofCapacitySold', { n: Math.round(s.sellThroughPct) }), value: tr('postEvent.ww.strongDemand') });
  }
  if (s.drinksPerHead >= 1.8) {
    whatWorked.push({ id: 'bar_high', label: tr('postEvent.ww.strongBar'), type: 'positive', metric: tr('postEvent.ww.perHeadDrinks', { n: s.drinksPerHead.toFixed(1) }), value: tr('postEvent.ww.highSpend') });
  } else if (s.drinkCount > 0 && s.drinksPerHead < 0.7) {
    whatWorked.push({ id: 'bar_low', label: tr('postEvent.ww.lowBarSpend'), type: 'negative', metric: tr('postEvent.ww.perHeadDrinks', { n: s.drinksPerHead.toFixed(1) }), value: tr('postEvent.ww.pushBar') });
  }
  if (s.returningRatePct >= 40) {
    whatWorked.push({ id: 'loyal', label: tr('postEvent.ww.loyalCrowd'), type: 'positive', metric: tr('postEvent.ww.returningMetric', { n: Math.round(s.returningRatePct) }), value: tr('postEvent.ww.strongBase') });
  }
  if (s.topDrink && s.topDrinkCount > 15) {
    whatWorked.push({ id: 'top_drink', label: tr('postEvent.ww.drinkWasHit', { drink: s.topDrink }), type: 'positive', metric: tr('postEvent.ww.sold', { n: s.topDrinkCount }), value: tr('postEvent.ww.topSellerNight') });
  }

  // ── Suggestions (real weaknesses) ──
  const suggestions: Suggestion[] = [];
  if (s.noShowRatePct != null && s.noShowRatePct > 30) {
    suggestions.push({ id: 'reduce_noshow', text: tr('postEvent.sg.reduceNoShow'), priority: 'high', category: 'operations' });
  }
  if (s.drinkCount > 0 && s.drinksPerHead < 1) {
    suggestions.push({ id: 'boost_bar', text: tr('postEvent.sg.boostBar'), priority: 'high', category: 'bar' });
  }
  if (s.sellThroughPct != null && s.sellThroughPct < 60) {
    suggestions.push({ id: 'fill_room', text: tr('postEvent.sg.fillRoom'), priority: 'high', category: 'marketing' });
  }
  if (s.returningRatePct < 25) {
    suggestions.push({ id: 'loyalty', text: tr('postEvent.sg.activateLoyalty'), priority: 'medium', category: 'crm' });
  }
  if (s.conversionRatePct != null && s.conversionRatePct < 3 && s.conversionRatePct > 0) {
    suggestions.push({ id: 'improve_page', text: tr('postEvent.sg.improvePage', { n: s.conversionRatePct.toFixed(1) }), priority: 'medium', category: 'marketing' });
  }
  if (s.pctBeforeMidnight != null && s.pctBeforeMidnight < 30) {
    suggestions.push({ id: 'early_incentive', text: tr('postEvent.sg.earlyIncentive'), priority: 'low', category: 'operations' });
  }
  if (s.drinkRedemptionRatePct != null && s.drinkRedemptionRatePct < 60) {
    suggestions.push({ id: 'drink_redeem', text: tr('postEvent.sg.pushRedemption', { n: Math.round(s.drinkRedemptionRatePct) }), priority: 'low', category: 'bar' });
  }
  if (suggestions.length === 0) {
    suggestions.push({ id: 'keep_going', text: tr('postEvent.sg.keepGoing'), priority: 'low', category: 'general' });
  }

  // ── Customer insights ──
  const customerInsights: CustomerInsight = {
    returningRate: s.returningRatePct,
    newCustomers: s.newCustomers,
    returningCustomers: s.returningCustomers,
    topSegment: s.topSegment || (s.returningRatePct > 50 ? tr('postEvent.seg.regulars') : tr('postEvent.seg.newVisitors')),
    topDrink: s.topDrink || '—',
    topDrinkCount: s.topDrinkCount,
  };

  const scoreLabel = ctx.isAggregate
    ? tr(`postEvent.score.${s.tier === 'excellent' ? 'excellentOverall' : s.tier === 'good' ? 'goodPerformance' : s.tier === 'average' ? 'averagePerformance' : 'needsImprovement'}`)
    : tr(`postEvent.score.${s.tier === 'excellent' ? 'excellentNight' : s.tier === 'good' ? 'goodNight' : s.tier === 'average' ? 'averageNight' : 'needsImprovement'}`);

  return {
    eventId: ctx.eventId,
    eventTitle: ctx.eventTitle,
    eventDate: ctx.eventDate,
    overallScore: s.overallScore,
    scoreLabel,
    kpis,
    extendedStats,
    timeline,
    timelineInsights,
    whatWorked,
    customerInsights,
    suggestions,
    notes: ctx.notes,
    isAggregate: ctx.isAggregate,
    rawStats: s,
  };
}
