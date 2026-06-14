import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { subDays, subHours, differenceInDays, startOfDay, format } from 'date-fns';
import {
  computeForecast,
  type ForecastResult,
  type HistoricalEvent,
  type SalesPoint,
  type DemandSignals,
  type BaselineProfile,
} from '@/lib/hypeForecast';

export interface HypePillar {
  id: string;
  nameKey: string;
  score: number; // 0-10 scale
  metrics: {
    labelKey: string;
    value: string | number;
    change?: number;
    insightKey?: string;
    insightParams?: Record<string, string | number>;
  }[];
  insightKey: string;
  insightParams?: Record<string, string | number>;
  actions: {
    id: string;
    labelKey: string;
    descriptionKey: string;
    link?: string;
  }[];
}

export interface PreEventQuickStatsData {
  pageViews: number;
  pageViewsChange: number;
  cartAdds: number;
  cartRate: number;
  ticketsSold: number;
  ticketsChange: number;
  conversionRate: number;
  avgTimeOnPage: number;
  returningVisitors: number;
  favoritesCount: number;
  velocityLast12h: number;
  targetCompletion: number;
  maxTickets: number | null;
  totalRevenue: number;
  daysUntilEvent: number | null;
}

export interface TrendDataPoint {
  date: string;
  tickets: number;
  views: number;
}

export interface EventComparisonData {
  previousEventTitle: string;
  currentTickets: number;
  previousTickets: number;
  currentViews: number;
  previousViews: number;
  currentRevenue: number;
  previousRevenue: number;
  daysBeforeEvent: number;
}

export interface HypeScoreData {
  overallScore: number;
  level: 'low' | 'medium' | 'high' | 'fire';
  pillars: HypePillar[];
  quickStats: PreEventQuickStatsData;
  lastUpdated: Date;
  trendData: TrendDataPoint[];
  comparison: EventComparisonData | null;
  /** Real forecast — only populated for a specific upcoming event. */
  forecast: ForecastResult | null;
}

const DAY_MS = 86_400_000;

type TicketRow = {
  created_at: string;
  quantity: number;
  total_price: number | null;
  user_email: string | null;
};
type SessionRow = {
  session_id: string;
  visited_at: string;
  user_id: string | null;
  added_to_cart: boolean | null;
  proceeded_to_checkout: boolean | null;
  completed_order: boolean | null;
  duration_seconds: number | null;
  scroll_depth_max: number | null;
  is_returning: boolean | null;
  referrer_category: string | null;
  referrer_domain: string | null;
  utm_source: string | null;
};
type EventMeta = {
  presale_start_at?: string | null;
  public_sale_start_at?: string | null;
  created_at?: string | null;
};

/** Best-effort sale-open timestamp for an event. */
function resolveSaleStart(ev: {
  presale_start_at?: string | null;
  public_sale_start_at?: string | null;
  created_at?: string | null;
}, firstTicketAt: number | null, eventStart: number): number {
  const candidates = [ev.presale_start_at, ev.public_sale_start_at, ev.created_at]
    .filter(Boolean)
    .map((s) => new Date(s as string).getTime());
  if (firstTicketAt) candidates.push(firstTicketAt);
  const valid = candidates.filter((t) => t < eventStart);
  if (valid.length === 0) return eventStart - 14 * DAY_MS; // default 2-week window
  return Math.min(...valid);
}

/** Build a normalized 0..1 sales curve from a completed event's paid tickets. */
function buildHistoryCurve(
  tickets: { created_at: string; quantity: number }[],
  saleStart: number,
  eventStart: number,
): HistoricalEvent | null {
  if (tickets.length === 0) return null;
  const lead = Math.max(eventStart - saleStart, DAY_MS);
  const sorted = [...tickets].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  let cum = 0;
  const raw: { f: number; cum: number }[] = [];
  for (const tk of sorted) {
    cum += tk.quantity || 0;
    const f = Math.min(
      1,
      Math.max(0, (new Date(tk.created_at).getTime() - saleStart) / lead),
    );
    raw.push({ f, cum });
  }
  const finalSold = cum;
  if (finalSold <= 0) return null;
  const curve = raw.map((p) => ({ f: p.f, frac: p.cum / finalSold }));
  return { finalSold, capacity: null, curve };
}

/** Simple least-squares slope of daily ticket quantity over the last 7 days. */
function salesSlope(daily: number[]): number {
  const n = daily.length;
  if (n < 2) return 0;
  const xs = daily.map((_, i) => i);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = daily.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * daily[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

const to10 = (x01: number) => Math.round(clamp(x01, 0, 1) * 100) / 10;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function useHypeScore(venueId: string | null, eventId?: string | null) {
  const [loading, setLoading] = useState(true);
  const [hypeData, setHypeData] = useState<HypeScoreData | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHypeScore = useCallback(async () => {
    if (!venueId) return;

    try {
      const now = new Date();
      const nowMs = now.getTime();
      const last24h = subHours(now, 24);
      const last48h = subHours(now, 48);
      const last7days = subDays(now, 7);
      const last30days = subDays(now, 30);

      // ── Event-scoped sessions take priority; fall back to venue when no event ──
      const sessionCols =
        'session_id, visited_at, user_id, added_to_cart, proceeded_to_checkout, completed_order, duration_seconds, scroll_depth_max, is_returning, referrer_category, referrer_domain, utm_source';

      let eventSessionsQ = supabase
        .from('visitor_sessions')
        .select(sessionCols)
        .gte('visited_at', last30days.toISOString());
      eventSessionsQ = eventId
        ? eventSessionsQ.eq('event_id', eventId)
        : eventSessionsQ.eq('venue_id', venueId);

      // Venue baseline (always venue-wide), lighter select.
      const venueSessionsQ = supabase
        .from('visitor_sessions')
        .select('session_id, visited_at')
        .eq('venue_id', venueId)
        .gte('visited_at', last30days.toISOString());

      // Paid tickets for the target event (full history for pace curve).
      let ticketsQ = supabase
        .from('tickets')
        .select('created_at, quantity, total_price, user_email, events!inner(venue_id)')
        .eq('events.venue_id', venueId)
        .eq('status', 'paid');
      ticketsQ = eventId
        ? ticketsQ.eq('event_id', eventId)
        : ticketsQ.gte('created_at', last30days.toISOString());

      // Drink orders (engagement display).
      let orders24Q = supabase
        .from('orders')
        .select('*')
        .eq('venue_id', venueId)
        .gte('created_at', last24h.toISOString());
      if (eventId) orders24Q = orders24Q.eq('event_id', eventId);

      // Favorites (event-scoped when possible).
      const favQ = eventId
        ? supabase.from('favorites').select('created_at').eq('event_id', eventId).eq('favorite_type', 'event')
        : supabase.from('favorites').select('created_at').eq('venue_id', venueId);

      // Loyalty (venue base).
      const loyaltyQ = supabase
        .from('customer_loyalty')
        .select('current_balance')
        .eq('venue_id', venueId);

      // Self-reported baseline ("before Yuno" calibration).
      const baselineQ = supabase
        .from('venue_hype_baseline')
        .select('capacity, typical_attendance, sales_timing, sellout_frequency')
        .eq('venue_id', venueId)
        .maybeSingle();

      // Event details.
      const eventDataQ = eventId
        ? supabase
            .from('events')
            .select('max_tickets, start_at, created_at, presale_start_at, public_sale_start_at, title')
            .eq('id', eventId)
            .single()
        : null;

      const [
        { data: eventSessions },
        { data: venueSessions },
        { data: ticketRows },
        { data: orders24 },
        { data: favRows },
        { data: loyaltyData },
        { data: baselineRow },
      ] = await Promise.all([eventSessionsQ, venueSessionsQ, ticketsQ, orders24Q, favQ, loyaltyQ, baselineQ]);

      const baseline: BaselineProfile | null = baselineRow
        ? {
            typicalAttendance: baselineRow.typical_attendance ?? null,
            capacity: baselineRow.capacity ?? null,
            salesTiming: (baselineRow.sales_timing as BaselineProfile['salesTiming']) ?? null,
            selloutFrequency: (baselineRow.sellout_frequency as BaselineProfile['selloutFrequency']) ?? null,
          }
        : null;

      const eventSess = (eventSessions || []) as unknown as SessionRow[];
      const venueSess = (venueSessions || []) as { session_id: string; visited_at: string }[];
      const tickets = (ticketRows || []) as unknown as TicketRow[];
      const favs = (favRows || []) as { created_at: string }[];

      // Event meta + capacity.
      let maxTickets: number | null = null;
      let eventStartAt: string | null = null;
      let eventMeta: EventMeta | null = null;
      if (eventDataQ) {
        const { data } = await eventDataQ;
        eventMeta = data;
        maxTickets = data?.max_tickets ?? null;
        eventStartAt = data?.start_at ?? null;
      }

      // Capacity fallback: sum of ticket rounds when event.max_tickets is null.
      let capacity: number | null = maxTickets;
      if (eventId && capacity == null) {
        const { data: rounds } = await supabase
          .from('ticket_rounds')
          .select('max_tickets')
          .eq('event_id', eventId);
        if (rounds && rounds.length > 0) {
          capacity = rounds.reduce((s: number, r) => s + (r.max_tickets || 0), 0) || null;
        }
      }
      // Last resort: the venue's self-reported capacity.
      if (capacity == null && baseline?.capacity != null) {
        capacity = baseline.capacity;
      }

      // ── VIP tables (engagement display) ──
      let vipTableCount = 0;
      try {
        // supabase-js over-expands the generic on chained count/head filters
        // (TS2589), so we cast the builder to an untyped client here on purpose.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = (supabase.from('table_reservations') as any)
          .select('id', { count: 'exact', head: true })
          .eq('venue_id', venueId);
        if (eventId) q = q.eq('event_id', eventId);
        const res = await q;
        vipTableCount = res.count || 0;
      } catch {
        vipTableCount = 0;
      }

      // ════════════════════════════════════════════════
      //  SALES SERIES + CORE TICKET AGGREGATES
      // ════════════════════════════════════════════════
      const ticketsSorted = [...tickets].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      let cum = 0;
      const salesSeries: SalesPoint[] = ticketsSorted.map((tk) => {
        cum += tk.quantity || 0;
        return { t: new Date(tk.created_at).getTime(), cum };
      });
      const totalTicketsSold = cum;
      const totalTicketRevenue = tickets.reduce((s, t) => s + (t.total_price || 0), 0);
      const firstTicketAt = ticketsSorted.length
        ? new Date(ticketsSorted[0].created_at).getTime()
        : null;

      const ticketsSold24 = tickets
        .filter((t) => new Date(t.created_at) >= last24h)
        .reduce((s, t) => s + (t.quantity || 0), 0);
      const ticketsSold48 = tickets
        .filter((t) => new Date(t.created_at) >= last48h && new Date(t.created_at) < last24h)
        .reduce((s, t) => s + (t.quantity || 0), 0);

      // Daily ticket quantities over the last 7 days (for slope / acceleration).
      const dailyQty: number[] = [];
      for (let i = 6; i >= 0; i--) {
        const day = startOfDay(subDays(now, i));
        const next = startOfDay(subDays(now, i - 1));
        dailyQty.push(
          tickets
            .filter((t) => {
              const d = new Date(t.created_at);
              return d >= day && d < next;
            })
            .reduce((s, t) => s + (t.quantity || 0), 0),
        );
      }
      const recentDailySales = dailyQty.reduce((a, b) => a + b, 0) / 7;
      const slope7d = salesSlope(dailyQty);

      // ════════════════════════════════════════════════
      //  VISITOR / FUNNEL AGGREGATES (event-scoped)
      // ════════════════════════════════════════════════
      const uniq = (arr: { session_id: string }[]) => new Set(arr.map((v) => v.session_id)).size;
      const sess24 = eventSess.filter((v) => new Date(v.visited_at) >= last24h);
      const sess7d = eventSess.filter((v) => new Date(v.visited_at) >= last7days);
      const uniqueVisitors24 = uniq(sess24);
      const visitors7dDaily = uniq(sess7d) / 7;

      const baselineDaily = uniq(venueSess) / 30;
      const avgDailyViews = baselineDaily;
      const pageViewsChange =
        avgDailyViews > 0 ? ((uniqueVisitors24 - avgDailyViews) / avgDailyViews) * 100 : 0;

      // Funnel over the full 30d event window (more stable than 24h).
      const views = eventSess.length;
      const carts = eventSess.filter((v) => v.added_to_cart).length;
      const checkouts = eventSess.filter((v) => v.proceeded_to_checkout).length;
      const purchases = eventSess.filter((v) => v.completed_order).length;

      const withDur = sess24.filter((v) => v.duration_seconds && v.duration_seconds > 0);
      const avgTimeOnPage = withDur.length
        ? Math.round(withDur.reduce((s, v) => s + (v.duration_seconds || 0), 0) / withDur.length)
        : 0;
      const avgDurationAll = (() => {
        const w = eventSess.filter((v) => v.duration_seconds && v.duration_seconds > 0);
        return w.length ? w.reduce((s, v) => s + (v.duration_seconds || 0), 0) / w.length : 0;
      })();
      const avgScroll = (() => {
        const w = eventSess.filter((v) => v.scroll_depth_max != null);
        return w.length ? w.reduce((s, v) => s + (v.scroll_depth_max || 0), 0) / w.length : 0;
      })();
      const returningVisitorRate = eventSess.length
        ? eventSess.filter((v) => v.is_returning).length / eventSess.length
        : 0;
      const sourceDiversity = new Set(
        eventSess.map((v) => v.utm_source || v.referrer_domain || v.referrer_category).filter(Boolean),
      ).size;

      const cartAddsCount = sess24.filter((v) => v.added_to_cart).length;
      const cartRate = uniqueVisitors24 > 0 ? Math.min(100, (cartAddsCount / uniqueVisitors24) * 100) : 0;

      // ── Favorites velocity ──
      const favCount = favs.length;
      const favorites7d = favs.filter((f) => new Date(f.created_at) >= last7days).length;

      // ── Loyalty ──
      const loyaltyTotal = loyaltyData?.length || 0;
      const loyaltyActive = loyaltyData?.filter((m) => (m.current_balance || 0) > 0).length || 0;

      // ── Orders (drink) for engagement display ──
      const paidOrders24 = (orders24 || []).filter((o) => o.status === 'paid' || o.status === 'served');
      const orderRevenue24 = paidOrders24.reduce((s, o) => s + (o.total || 0), 0);

      // ════════════════════════════════════════════════
      //  HISTORICAL CURVE LEARNING (past completed events)
      // ════════════════════════════════════════════════
      const history: HistoricalEvent[] = [];
      let venueAvgFinal: number | null = null;
      const historicalBuyerEmails = new Set<string>();
      if (eventId) {
        const { data: pastEvents } = await supabase
          .from('events')
          .select('id, start_at, created_at, presale_start_at, public_sale_start_at, max_tickets')
          .eq('venue_id', venueId)
          .neq('id', eventId)
          .lt('start_at', now.toISOString())
          .gte('start_at', subDays(now, 240).toISOString())
          .order('start_at', { ascending: false })
          .limit(8);

        if (pastEvents && pastEvents.length > 0) {
          const ids = pastEvents.map((e) => e.id);
          const { data: pastTickets } = await supabase
            .from('tickets')
            .select('event_id, created_at, quantity, user_email')
            .in('event_id', ids)
            .eq('status', 'paid');

          const byEvent = new Map<string, { created_at: string; quantity: number }[]>();
          for (const tk of pastTickets || []) {
            if (!byEvent.has(tk.event_id)) byEvent.set(tk.event_id, []);
            byEvent.get(tk.event_id)!.push({ created_at: tk.created_at, quantity: tk.quantity });
            if (tk.user_email) historicalBuyerEmails.add(tk.user_email);
          }

          const finals: number[] = [];
          for (const ev of pastEvents) {
            const evTickets = byEvent.get(ev.id) || [];
            const evStart = new Date(ev.start_at).getTime();
            const firstAt = evTickets.length
              ? Math.min(...evTickets.map((t) => new Date(t.created_at).getTime()))
              : null;
            const saleStart = resolveSaleStart(ev, firstAt, evStart);
            const curve = buildHistoryCurve(evTickets, saleStart, evStart);
            if (curve) {
              curve.capacity = ev.max_tickets ?? null;
              history.push(curve);
              finals.push(curve.finalSold);
            }
          }
          if (finals.length > 0) {
            venueAvgFinal = finals.reduce((a, b) => a + b, 0) / finals.length;
          }
        }
      }

      // Returning-customer rate: this event's buyers seen at past events.
      const currentBuyerEmails = new Set(
        tickets.map((t) => t.user_email).filter(Boolean) as string[],
      );
      const returningCustomerRate =
        currentBuyerEmails.size > 0
          ? [...currentBuyerEmails].filter((e) => historicalBuyerEmails.has(e)).length /
            currentBuyerEmails.size
          : 0;

      // ════════════════════════════════════════════════
      //  RUN THE FORECAST ENGINE
      // ════════════════════════════════════════════════
      let forecast: ForecastResult | null = null;
      if (eventId && eventStartAt && new Date(eventStartAt).getTime() > nowMs) {
        const eventStart = new Date(eventStartAt).getTime();
        const saleStart = resolveSaleStart(eventMeta || {}, firstTicketAt, eventStart);
        const demand: DemandSignals = {
          visitors7dDaily,
          baselineDaily,
          views,
          carts,
          checkouts,
          purchases,
          avgDurationSec: avgDurationAll,
          scrollDepthMax: avgScroll,
          returningVisitorRate,
          favorites: favCount,
          favorites7d,
          sourceDiversity,
          salesSlope7d: slope7d,
          recentDailySales,
          returningCustomerRate,
          loyaltyActive,
          loyaltyTotal,
        };
        forecast = computeForecast({
          now: nowMs,
          eventStart,
          saleStart,
          capacity,
          currentSold: totalTicketsSold,
          salesSeries,
          history,
          demand,
          venueAvgFinal,
          baseline,
        });
      }

      // ════════════════════════════════════════════════
      //  7-DAY TREND
      // ════════════════════════════════════════════════
      const trendData: TrendDataPoint[] = [];
      for (let i = 6; i >= 0; i--) {
        const day = startOfDay(subDays(now, i));
        const next = startOfDay(subDays(now, i - 1));
        const dayTickets = tickets
          .filter((t) => {
            const d = new Date(t.created_at);
            return d >= day && d < next;
          })
          .reduce((s, t) => s + (t.quantity || 0), 0);
        const dayViews = new Set(
          eventSess
            .filter((v) => {
              const d = new Date(v.visited_at);
              return d >= day && d < next;
            })
            .map((v) => v.session_id),
        ).size;
        trendData.push({ date: format(day, 'MM/dd'), tickets: dayTickets, views: dayViews });
      }

      // ════════════════════════════════════════════════
      //  EVENT COMPARISON (kept — same-stage vs previous event)
      // ════════════════════════════════════════════════
      let comparison: EventComparisonData | null = null;
      if (eventId && eventStartAt) {
        try {
          const daysUntil = Math.max(0, differenceInDays(new Date(eventStartAt), now));
          const { data: prevEvents } = await supabase
            .from('events')
            .select('id, title, start_at')
            .eq('venue_id', venueId)
            .neq('id', eventId)
            .lt('start_at', now.toISOString())
            .order('start_at', { ascending: false })
            .limit(1);

          if (prevEvents && prevEvents.length > 0) {
            const prevEvent = prevEvents[0];
            const sameStageBefore = subDays(new Date(prevEvent.start_at), daysUntil);
            const { data: prevTickets } = await supabase
              .from('tickets')
              .select('quantity, total_price')
              .eq('event_id', prevEvent.id)
              .eq('status', 'paid')
              .lte('created_at', sameStageBefore.toISOString());
            const prevTicketCount = (prevTickets || []).reduce((s: number, t) => s + (t.quantity || 0), 0);
            const prevRevenue = (prevTickets || []).reduce((s: number, t) => s + (t.total_price || 0), 0);
            const { count: prevVisitorCount } = await supabase
              .from('visitor_sessions')
              .select('session_id', { count: 'exact', head: true })
              .eq('venue_id', venueId)
              .lte('visited_at', sameStageBefore.toISOString())
              .gte('visited_at', subDays(sameStageBefore, 7).toISOString());

            comparison = {
              previousEventTitle: prevEvent.title,
              currentTickets: totalTicketsSold,
              previousTickets: prevTicketCount,
              currentViews: uniq(eventSess),
              previousViews: prevVisitorCount || 0,
              currentRevenue: totalTicketRevenue,
              previousRevenue: prevRevenue,
              daysBeforeEvent: daysUntil,
            };
          }
        } catch (e) {
          console.warn('Could not fetch comparison data:', e);
        }
      }

      // ════════════════════════════════════════════════
      //  PILLARS  — built from the engine's normalized sub-scores
      // ════════════════════════════════════════════════
      // When no forecast (global view / past event), derive light fallbacks.
      const ss = forecast?.subScores ?? {
        reach: clamp(pageViewsChange > 0 ? 0.6 : 0.4, 0, 1),
        funnel: views > 0 ? clamp((carts / views) * 4, 0, 1) : 0,
        engagement: clamp(avgDurationAll / 90, 0, 1),
        conversion: views > 0 ? clamp((purchases / views) * 20, 0, 1) : 0,
        recurrence: clamp(returningCustomerRate * 0.6 + (loyaltyTotal > 0 ? loyaltyActive / loyaltyTotal : 0) * 0.4, 0, 1),
        momentum: clamp(0.5 + Math.tanh(slope7d / Math.max(1, recentDailySales + 1)) * 0.5, 0, 1),
        trajectory: 0.5,
      };

      const interestScore = to10(ss.reach);
      const engagementScore = to10(ss.funnel);
      const conversionScore = to10(ss.conversion);
      const recurrenceScore = to10(ss.recurrence);
      const momentumScore = to10(ss.momentum);

      const getInsightKey = (pillarId: string, score: number) => {
        const tier = score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low';
        return `hype.insight.${pillarId}.${tier}`;
      };

      const pillars: HypePillar[] = [
        {
          id: 'interest',
          nameKey: 'hype.pillar.interest',
          score: interestScore,
          metrics: [
            { labelKey: 'hype.metric.pageViews24h', value: uniqueVisitors24, change: Math.round(pageViewsChange), insightKey: 'hype.metricInsight.vsAvg', insightParams: { change: Math.round(pageViewsChange) } },
            { labelKey: 'hype.metric.returningVisitors', value: `${Math.round(returningVisitorRate * 100)}%`, insightKey: 'hype.metricInsight.returningCount', insightParams: { count: Math.round(returningVisitorRate * eventSess.length) } },
            { labelKey: 'hype.metric.avgDailyViews', value: Math.round(avgDailyViews), insightKey: uniqueVisitors24 > avgDailyViews ? 'hype.metricInsight.aboveAvg' : 'hype.metricInsight.belowAvg' },
          ],
          insightKey: getInsightKey('interest', interestScore),
          actions: [
            { id: 'share_social', labelKey: 'hype.action.shareSocial', descriptionKey: 'hype.action.shareSocialDesc' },
            { id: 'enable_push', labelKey: 'hype.action.enablePush', descriptionKey: 'hype.action.enablePushDesc' },
            { id: 'add_promo', labelKey: 'hype.action.addPromo', descriptionKey: 'hype.action.addPromoDesc', link: '/promoters' },
          ],
        },
        {
          id: 'engagement',
          nameKey: 'hype.pillar.engagement',
          score: engagementScore,
          metrics: [
            { labelKey: 'hype.metric.drinkOrders24h', value: paidOrders24.length, insightKey: 'hype.metricInsight.ordersToday', insightParams: { count: paidOrders24.length } },
            { labelKey: 'hype.metric.ticketsSold24h', value: ticketsSold24, insightKey: 'hype.metricInsight.totalTickets', insightParams: { count: totalTicketsSold } },
            { labelKey: 'hype.metric.vipTables', value: vipTableCount, insightKey: vipTableCount > 0 ? 'hype.metricInsight.tablesBooked' : 'hype.metricInsight.noTables', insightParams: { count: vipTableCount } },
            { labelKey: 'hype.metric.favorites', value: favCount, insightKey: favCount > 0 ? 'hype.metricInsight.usersSaved' : 'hype.metricInsight.noFavorites', insightParams: { count: favCount } },
          ],
          insightKey: getInsightKey('engagement', engagementScore),
          actions: [
            { id: 'add_drink_pack', labelKey: 'hype.action.addDrinkPack', descriptionKey: 'hype.action.addDrinkPackDesc' },
            { id: 'highlight_lineup', labelKey: 'hype.action.highlightLineup', descriptionKey: 'hype.action.highlightLineupDesc' },
            { id: 'add_gallery', labelKey: 'hype.action.addGallery', descriptionKey: 'hype.action.addGalleryDesc' },
          ],
        },
        {
          id: 'conversion',
          nameKey: 'hype.pillar.conversion',
          score: conversionScore,
          metrics: [
            { labelKey: 'hype.metric.uniqueBuyers24h', value: currentBuyerEmails.size, insightKey: 'hype.metricInsight.ordersAndTickets', insightParams: { orders: paidOrders24.length, tickets: ticketsSold24 } },
            { labelKey: 'hype.metric.revenue24h', value: `${(orderRevenue24).toFixed(0)}€`, insightKey: orderRevenue24 > 0 ? 'hype.metricInsight.revenueFlowing' : 'hype.metricInsight.noRevenue' },
            { labelKey: 'hype.metric.conversionRate', value: `${views > 0 ? ((purchases / views) * 100).toFixed(1) : '0.0'}%`, insightKey: views > 0 && purchases / views >= 0.03 ? 'hype.metricInsight.strongConversion' : 'hype.metricInsight.lowConversion' },
          ],
          insightKey: getInsightKey('conversion', conversionScore),
          actions: [
            { id: 'early_bird', labelKey: 'hype.action.earlyBird', descriptionKey: 'hype.action.earlyBirdDesc' },
            { id: 'bundle_offer', labelKey: 'hype.action.bundleOffer', descriptionKey: 'hype.action.bundleOfferDesc' },
            { id: 'scarcity', labelKey: 'hype.action.scarcity', descriptionKey: 'hype.action.scarcityDesc' },
          ],
        },
        {
          id: 'recurrence',
          nameKey: 'hype.pillar.recurrence',
          score: recurrenceScore,
          metrics: [
            { labelKey: 'hype.metric.returningCustomers', value: `${Math.round(returningCustomerRate * 100)}%`, insightKey: 'hype.metricInsight.repeatBuyers', insightParams: { count: [...currentBuyerEmails].filter((e) => historicalBuyerEmails.has(e)).length } },
            { labelKey: 'hype.metric.activeLoyalty', value: loyaltyActive, insightKey: 'hype.metricInsight.loyaltyStats', insightParams: { total: loyaltyTotal, rate: loyaltyTotal > 0 ? Math.round((loyaltyActive / loyaltyTotal) * 100) : 0 } },
            { labelKey: 'hype.metric.totalLoyalty', value: loyaltyTotal, insightKey: loyaltyTotal > 0 ? 'hype.metricInsight.withBalance' : 'hype.metricInsight.noLoyalty', insightParams: { count: loyaltyActive } },
          ],
          insightKey: getInsightKey('recurrence', recurrenceScore),
          actions: [
            { id: 'loyalty_bonus', labelKey: 'hype.action.loyaltyBonus', descriptionKey: 'hype.action.loyaltyBonusDesc' },
            { id: 'vip_access', labelKey: 'hype.action.vipAccess', descriptionKey: 'hype.action.vipAccessDesc' },
            { id: 'referral', labelKey: 'hype.action.referral', descriptionKey: 'hype.action.referralDesc' },
          ],
        },
        {
          id: 'momentum',
          nameKey: 'hype.pillar.momentum',
          score: momentumScore,
          metrics: [
            { labelKey: 'hype.metric.visits12h', value: uniq(sess24.filter((v) => new Date(v.visited_at) >= subHours(now, 12))), change: Math.round(pageViewsChange), insightKey: pageViewsChange > 0 ? 'hype.metricInsight.trafficUp' : 'hype.metricInsight.trafficDown' },
            { labelKey: 'hype.metric.orders12h', value: paidOrders24.filter((o) => new Date(o.created_at) >= subHours(now, 12)).length, change: Math.round((slope7d / Math.max(1, recentDailySales)) * 100), insightKey: slope7d >= 0 ? 'hype.metricInsight.salesUp' : 'hype.metricInsight.salesDown' },
            { labelKey: 'hype.metric.tickets12h', value: ticketsSold24, insightKey: ticketsSold24 > 0 ? 'hype.metricInsight.ticketsMoving' : 'hype.metricInsight.noRecentTickets' },
            { labelKey: 'hype.metric.viralSpike', value: forecast && forecast.paceStatus === 'ahead' ? '✓' : '—', insightKey: forecast && forecast.paceStatus === 'ahead' ? 'hype.metricInsight.trending' : 'hype.metricInsight.noSpike' },
          ],
          insightKey: getInsightKey('momentum', momentumScore),
          actions: [
            { id: 'flash_sale', labelKey: 'hype.action.flashSale', descriptionKey: 'hype.action.flashSaleDesc' },
            { id: 'countdown', labelKey: 'hype.action.countdown', descriptionKey: 'hype.action.countdownDesc' },
            { id: 'influencer', labelKey: 'hype.action.influencer', descriptionKey: 'hype.action.influencerDesc' },
          ],
        },
      ];

      // Overall score: forecast-driven when available, else weighted pillar avg.
      let overallScore: number;
      let level: HypeScoreData['level'];
      if (forecast) {
        overallScore = forecast.overallScore10;
        level = forecast.level;
      } else {
        const weights = { interest: 0.2, engagement: 0.2, conversion: 0.25, recurrence: 0.15, momentum: 0.2 };
        overallScore =
          interestScore * weights.interest +
          engagementScore * weights.engagement +
          conversionScore * weights.conversion +
          recurrenceScore * weights.recurrence +
          momentumScore * weights.momentum;
        overallScore = Math.round(overallScore * 10) / 10;
        level = overallScore >= 8 ? 'fire' : overallScore >= 6 ? 'high' : overallScore >= 4 ? 'medium' : 'low';
      }

      const daysUntilEvent = eventStartAt ? Math.max(0, differenceInDays(new Date(eventStartAt), now)) : null;
      const conversionRatePct = views > 0 ? Math.min(100, (purchases / views) * 100) : 0;

      const quickStats: PreEventQuickStatsData = {
        pageViews: uniqueVisitors24,
        pageViewsChange: Math.round(pageViewsChange),
        cartAdds: cartAddsCount,
        cartRate,
        ticketsSold: totalTicketsSold,
        ticketsChange: ticketsSold48 > 0 ? Math.round(((ticketsSold24 - ticketsSold48) / ticketsSold48) * 100) : ticketsSold24 > 0 ? 100 : 0,
        conversionRate: conversionRatePct,
        avgTimeOnPage,
        returningVisitors: Math.round(returningVisitorRate * eventSess.length),
        favoritesCount: favCount,
        velocityLast12h: ticketsSold24,
        targetCompletion: capacity ? Math.min(100, Math.round((totalTicketsSold / capacity) * 100)) : Math.min(100, totalTicketsSold),
        maxTickets: capacity,
        totalRevenue: totalTicketRevenue + orderRevenue24,
        daysUntilEvent,
      };

      setHypeData({
        overallScore,
        level,
        pillars,
        quickStats,
        lastUpdated: new Date(),
        trendData,
        comparison,
        forecast,
      });
    } catch (error) {
      console.error('Error fetching hype score:', error);
    } finally {
      setLoading(false);
    }
  }, [venueId, eventId]);

  useEffect(() => {
    if (!venueId) return;
    setLoading(true);
    fetchHypeScore();
    intervalRef.current = setInterval(fetchHypeScore, 60000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [venueId, eventId, fetchHypeScore]);

  const getCheckedActions = (): string[] => {
    try {
      return JSON.parse(localStorage.getItem(`hype_checklist_${venueId}_${eventId || 'global'}`) || '[]');
    } catch {
      return [];
    }
  };

  const toggleCheckAction = (actionId: string) => {
    const key = `hype_checklist_${venueId}_${eventId || 'global'}`;
    const current = getCheckedActions();
    const updated = current.includes(actionId)
      ? current.filter((id: string) => id !== actionId)
      : [...current, actionId];
    localStorage.setItem(key, JSON.stringify(updated));
    return updated;
  };

  return {
    loading,
    hypeData,
    refetch: fetchHypeScore,
    getCheckedActions,
    toggleCheckAction,
  };
}
