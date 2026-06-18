import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { subDays, subHours, startOfDay } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { PARIS_TIMEZONE } from '@/lib/timezone';
import { orderRevenue, ticketRevenue, tableRevenue } from '@/utils/fees';

export type AnalyticsMode = 'global' | 'event';
export type DateRange = '24h' | '48h' | '72h' | '7days' | '30days' | 'alltime';

/** Group a timestamp by Paris day / Paris hour, so charts match club-local time, not the browser. */
const parisDay = (d: string | Date): string => formatInTimeZone(new Date(d), PARIS_TIMEZONE, 'yyyy-MM-dd');
const parisHour = (d: string | Date): number => Number(formatInTimeZone(new Date(d), PARIS_TIMEZONE, 'H'));

/** Aggregate club totals for one period — used to compute real "vs previous period" deltas. */
export interface PeriodTotals { revenue: number; orders: number; guests: number; }

export interface DrinkAnalytics {
  totalRevenue: number;
  netRevenue: number;
  stripeFee: number;
  partialRefunded: number;
  totalOrders: number;
  avgOrderValue: number;
  uniqueCustomers: number;
  topProducts: { name: string; quantity: number; revenue: number }[];
  revenueByDay: { date: string; revenue: number; orders: number }[];
  ordersByStatus: { status: string; count: number }[];
  categoryData: { name: string; value: number; color: string }[];
  hourlyData: { hour: string; orders: number; revenue: number }[];
  rushHours: string;
  visitors: number;
  addedToCart: number;
  proceededToCheckout: number;
  conversionRate: number;
  cartConversionRate: number;
  checkoutConversionRate: number;
}

export interface TicketAnalytics {
  totalRevenue: number;
  netRevenue: number;
  stripeFee: number;
  partialRefunded: number;
  totalTickets: number;
  avgTicketPrice: number;
  uniqueCustomers: number;
  ticketsByEvent: { eventTitle: string; quantity: number; revenue: number }[];
  ticketsByRound: { roundName: string; quantity: number; revenue: number; maxTickets: number; ticketsSold: number; position: number }[];
  ticketsByType: { ticketType: string; quantity: number; revenue: number; share: number }[];
  revenueByDay: { date: string; revenue: number; tickets: number }[];
  hourlyData: { hour: string; tickets: number; revenue: number }[];
  // Launch metrics
  waitlistSize: number;
  presaleBuyers: number;
  presaleRevenue: number;
  presaleConversionRate: number | null;
  demandRatio: number;
  velocityMilestones: { label: string; time: string | null }[];
  cumulativeSales: { minutesSinceLaunch: number; ticketsSold: number }[];
  presaleVsPublic: { name: string; value: number; color: string }[];
}

export interface TableAnalytics {
  totalRevenue: number;
  netRevenue: number;
  stripeFee: number;
  partialRefunded: number;
  totalReservations: number;
  avgReservationValue: number;
  uniqueCustomers: number;
  reservationsByZone: { zoneName: string; count: number; revenue: number }[];
  reservationsByEvent: { eventTitle: string; count: number; revenue: number }[];
  revenueByDay: { date: string; revenue: number; reservations: number }[];
  hourlyData: { hour: string; reservations: number; revenue: number }[];
}

export interface RefundAnalytics {
  totalRefunded: number;
  totalRefundCount: number;
  refundsByType: { type: string; count: number; amount: number }[];
  refundsByDay: { date: string; amount: number; count: number }[];
  refundsByReason: { reason: string; count: number; amount: number }[];
  refundRate: number;
  avgRefundAmount: number;
}

export interface EventInfo {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  isUpcoming: boolean;
  ticketingEnabled: boolean;
  tablesEnabled: boolean;
  maxTickets: number | null;
}

export type AnalyticsScope = 'venue' | 'organizer';

interface UseAnalyticsDataProps {
  venueId?: string | null;
  /** When scope='organizer', filter all queries through events of this organizer. */
  organizerUserId?: string | null;
  /** Default 'venue' to preserve existing club behaviour. */
  scope?: AnalyticsScope;
  dateRange: DateRange;
  mode: AnalyticsMode;
  selectedEventId: string | null;
}

function getStartDate(dateRange: DateRange): Date | null {
  if (dateRange === '24h') return subHours(new Date(), 24);
  if (dateRange === '48h') return subHours(new Date(), 48);
  if (dateRange === '72h') return subHours(new Date(), 72);
  if (dateRange === '7days') return startOfDay(subDays(new Date(), 7));
  if (dateRange === '30days') return startOfDay(subDays(new Date(), 30));
  return null;
}

/**
 * Convert the page's period selector into an ISO {from, to} window so web-traffic
 * sections (acquisition, engagement, audience) can share the SAME period control
 * as the rest of the analytics page instead of carrying their own filter.
 * 'alltime' falls back to a fixed early date.
 */
export function dateRangeToWindow(dateRange: DateRange): { from: string; to: string } {
  const start = getStartDate(dateRange) ?? new Date('2020-01-01');
  return { from: start.toISOString(), to: new Date().toISOString() };
}

/** Length of the selected window in ms — null for ranges without a fixed length (all-time). */
function getWindowMs(dateRange: DateRange): number | null {
  const H = 3_600_000, D = 86_400_000;
  switch (dateRange) {
    case '24h': return 24 * H;
    case '48h': return 48 * H;
    case '72h': return 72 * H;
    case '7days': return 7 * D;
    case '30days': return 30 * D;
    default: return null;
  }
}

/**
 * Fetch aggregate club totals for the period strictly before `start` of equal length,
 * so the KPI cards can show a real "vs previous period" delta (not a hardcoded number).
 * Venue/global scope only — deltas aren't meaningful for a single event or all-time.
 */
async function fetchPreviousTotals(venueId: string, prevStart: Date, prevEnd: Date): Promise<PeriodTotals> {
  const lo = prevStart.toISOString();
  const hi = prevEnd.toISOString();
  const [ordersRes, ticketsRes, tablesRes] = await Promise.all([
    supabase.from('orders').select('total, service_fee, refund_amount, user_email, status')
      .eq('venue_id', venueId).gte('created_at', lo).lt('created_at', hi),
    supabase.from('tickets').select('total_price, service_fee, insurance_fee, refund_amount, quantity, user_email, events!inner(venue_id)')
      .eq('status', 'paid').eq('events.venue_id', venueId).gte('created_at', lo).lt('created_at', hi),
    supabase.from('table_reservations').select('total_price, service_fee, management_fee, refund_amount, user_email, events!inner(venue_id)')
      .eq('status', 'paid').eq('events.venue_id', venueId).gte('created_at', lo).lt('created_at', hi),
  ]);
  const paidOrders = (ordersRes.data || []).filter(o => o.status === 'paid' || o.status === 'served');
  const tickets = ticketsRes.data || [];
  const tables = tablesRes.data || [];
  const revenue =
    paidOrders.reduce((s, o) => s + orderRevenue(o).gross, 0) +
    tickets.reduce((s, t) => s + ticketRevenue(t).gross, 0) +
    tables.reduce((s, t) => s + tableRevenue(t).gross, 0);
  const orders = paidOrders.length + tickets.reduce((s, t: any) => s + (t.quantity || 0), 0) + tables.length;
  const guests = new Set<string>();
  [...paidOrders, ...tickets, ...tables].forEach((r: any) => { if (r.user_email) guests.add(r.user_email); });
  return { revenue, orders, guests: guests.size };
}

export function useAnalyticsData({
  venueId,
  organizerUserId,
  scope = 'venue',
  dateRange,
  mode,
  selectedEventId,
}: UseAnalyticsDataProps) {
  const [drinkAnalytics, setDrinkAnalytics] = useState<DrinkAnalytics | null>(null);
  const [ticketAnalytics, setTicketAnalytics] = useState<TicketAnalytics | null>(null);
  const [tableAnalytics, setTableAnalytics] = useState<TableAnalytics | null>(null);
  const [refundAnalytics, setRefundAnalytics] = useState<RefundAnalytics | null>(null);
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [currentTotals, setCurrentTotals] = useState<PeriodTotals | null>(null);
  const [previousTotals, setPreviousTotals] = useState<PeriodTotals | null>(null);
  const [uniqueGuestsTotal, setUniqueGuestsTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  /** When true, the hook is configured for an organizer (no venue, no drinks). */
  const isOrganizerScope = scope === 'organizer';

  const fetchEvents = useCallback(async () => {
    let query = supabase
      .from('events')
      .select('id, title, start_at, end_at, ticketing_enabled, tables_enabled, max_tickets')
      .order('start_at', { ascending: false })
      .limit(50);

    if (isOrganizerScope) {
      if (!organizerUserId) return;
      // Events where the user is the lead organizer OR the partner organizer.
      query = query.or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`);
    } else {
      if (!venueId) return;
      query = query.eq('venue_id', venueId);
    }

    const { data } = await query;

    if (data) {
      setEvents(data.map(e => ({
        id: e.id,
        title: e.title,
        startAt: e.start_at,
        endAt: e.end_at,
        isUpcoming: new Date(e.start_at) > new Date(),
        ticketingEnabled: e.ticketing_enabled,
        tablesEnabled: e.tables_enabled,
        maxTickets: e.max_tickets,
      })));
    }
  }, [venueId, organizerUserId, isOrganizerScope]);

  const fetchAnalytics = useCallback(async () => {
    // In event-mode with an explicit eventId, allow the query even when
    // venueId is null (organizer-led co-events have venue_id NULL).
    const eventScopeOnly = mode === 'event' && !!selectedEventId;
    if (!isOrganizerScope && !venueId && !eventScopeOnly) return;
    if (isOrganizerScope && !organizerUserId) return;
    try {
      setLoading(true);
      const startDate = mode === 'event' ? null : getStartDate(dateRange);

      // === In organizer scope, pre-fetch the list of authorized event ids ===
      let scopedEventIds: string[] | null = null;
      if (isOrganizerScope) {
        const { data: orgEvents } = await supabase
          .from('events')
          .select('id')
          .or(`organizer_user_id.eq.${organizerUserId},partner_organizer_id.eq.${organizerUserId}`);
        scopedEventIds = (orgEvents ?? []).map(e => e.id);
        // No events yet → return empty analytics gracefully
        if (scopedEventIds.length === 0) {
          setDrinkAnalytics(null);
          setTicketAnalytics({
            totalRevenue: 0, netRevenue: 0, stripeFee: 0, partialRefunded: 0, totalTickets: 0, avgTicketPrice: 0, uniqueCustomers: 0,
            ticketsByEvent: [], ticketsByRound: [], ticketsByType: [], revenueByDay: [], hourlyData: [],
            waitlistSize: 0, presaleBuyers: 0, presaleRevenue: 0, presaleConversionRate: null, demandRatio: 0,
            velocityMilestones: [], cumulativeSales: [], presaleVsPublic: [],
          });
          setTableAnalytics({
            totalRevenue: 0, netRevenue: 0, stripeFee: 0, partialRefunded: 0, totalReservations: 0, avgReservationValue: 0,
            uniqueCustomers: 0, reservationsByZone: [], reservationsByEvent: [], revenueByDay: [], hourlyData: [],
          });
          setRefundAnalytics({
            totalRefunded: 0, totalRefundCount: 0, refundsByType: [], refundsByDay: [], refundsByReason: [],
            refundRate: 0, avgRefundAmount: 0,
          });
          setCurrentTotals({ revenue: 0, orders: 0, guests: 0 });
          setPreviousTotals(null);
          setUniqueGuestsTotal(0);
          setLoading(false);
          return;
        }
      }

      // === ORDERS (drinks) ===
      let allOrders: any[] | null = null;
      if (!isOrganizerScope && venueId) {
        let ordersQuery = supabase.from('orders').select('*').eq('venue_id', venueId);
        if (mode === 'event' && selectedEventId) {
          ordersQuery = ordersQuery.eq('event_id', selectedEventId);
        } else if (startDate) {
          ordersQuery = ordersQuery.gte('created_at', startDate.toISOString());
        }
        const { data } = await ordersQuery;
        allOrders = data;
      } else if (eventScopeOnly) {
        const { data } = await supabase.from('orders').select('*').eq('event_id', selectedEventId!);
        allOrders = data;
      }

      // === TICKETS ===
      let ticketsQuery = supabase
        .from('tickets')
        .select(`*, events!inner(venue_id, title), ticket_rounds(name, max_tickets, tickets_sold, position, ticket_type)`)
        .eq('status', 'paid');
      // PRIORITY: when an event is explicitly selected, ALWAYS scope to that event
      // — independently of organizer/venue scope. This fixes the bug where org-scope
      // analytics ignored the event filter and returned all events of the organizer.
      if (mode === 'event' && selectedEventId) {
        ticketsQuery = ticketsQuery.eq('event_id', selectedEventId);
      } else if (isOrganizerScope) {
        ticketsQuery = ticketsQuery.in('event_id', scopedEventIds!);
        if (startDate) ticketsQuery = ticketsQuery.gte('created_at', startDate.toISOString());
      } else if (eventScopeOnly) {
        ticketsQuery = ticketsQuery.eq('event_id', selectedEventId!);
      } else {
        ticketsQuery = ticketsQuery.eq('events.venue_id', venueId!);
        if (startDate) ticketsQuery = ticketsQuery.gte('created_at', startDate.toISOString());
      }
      const { data: allTickets } = await ticketsQuery;

      // === TABLE RESERVATIONS ===
      let tableQuery = supabase
        .from('table_reservations')
        .select(`*, events!inner(venue_id, title), table_zones(name)`)
        .eq('status', 'paid');
      if (mode === 'event' && selectedEventId) {
        tableQuery = tableQuery.eq('event_id', selectedEventId);
      } else if (isOrganizerScope) {
        tableQuery = tableQuery.in('event_id', scopedEventIds!);
        if (startDate) tableQuery = tableQuery.gte('created_at', startDate.toISOString());
      } else if (eventScopeOnly) {
        tableQuery = tableQuery.eq('event_id', selectedEventId!);
      } else {
        tableQuery = tableQuery.eq('events.venue_id', venueId!);
        if (startDate) tableQuery = tableQuery.gte('created_at', startDate.toISOString());
      }
      const { data: allTableReservations } = await tableQuery;
      console.debug('[useAnalyticsData]', { scope, mode, selectedEventId, ticketRows: allTickets?.length ?? 0, tableRows: allTableReservations?.length ?? 0 });

      // === VISITOR SESSIONS ===
      let visitorSessions: any[] | null = null;
      if (!isOrganizerScope && venueId) {
        let visitorQuery = supabase.from('visitor_sessions').select('*').eq('venue_id', venueId) as any;
        if (mode === 'event' && selectedEventId) {
          visitorQuery = visitorQuery.eq('event_id', selectedEventId);
        } else if (startDate) {
          visitorQuery = visitorQuery.gte('visited_at', startDate.toISOString());
        }
        const { data } = await visitorQuery;
        visitorSessions = data;
      }

      // === WAITLIST (for launch metrics) ===
      let waitlistCount = 0;
      if (mode === 'event' && selectedEventId) {
        const { count } = await supabase
          .from('ticket_waitlist')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', selectedEventId);
        waitlistCount = count || 0;
      }

      // ==================== PROCESS DRINK ANALYTICS (venue scope only) ====================
      const paidOrders = allOrders?.filter(o => o.status === 'paid' || o.status === 'served') || [];
      const totalOrders = paidOrders.length;
      // Function-scoped so the period totals below can read it (drink vars are block-scoped to the else).
      let drinkGrossForTotals = 0;

      if (isOrganizerScope) {
        // Organizers do not sell drinks — analytics not applicable.
        setDrinkAnalytics(null);
      } else {
        // Club revenue base (Yuno service fee excluded) — see src/utils/fees.ts.
        const drinkRev = paidOrders.reduce((acc, o) => {
          const r = orderRevenue(o);
          acc.gross += r.gross; acc.refunded += r.refunded; acc.stripe += r.stripe;
          return acc;
        }, { gross: 0, refunded: 0, stripe: 0 });
        const drinkTotalRevenue = drinkRev.gross;
        drinkGrossForTotals = drinkRev.gross;
        const drinkStripeFee = drinkRev.stripe;
        const drinkNetRevenue = drinkRev.gross - drinkRev.refunded - drinkRev.stripe;
        const avgOrderValue = totalOrders > 0 ? drinkTotalRevenue / totalOrders : 0;
        const uniqueDrinkCustomers = new Set(paidOrders.map(o => o.user_email).filter(Boolean)).size;

        const productCounts: Record<string, { quantity: number; revenue: number }> = {};
        paidOrders.forEach(order => {
          const items = order.items as any[];
          items.forEach(item => {
            if (!productCounts[item.name]) productCounts[item.name] = { quantity: 0, revenue: 0 };
            productCounts[item.name].quantity += item.qty;
            productCounts[item.name].revenue += item.unitPrice * item.qty;
          });
        });
        const topProducts = Object.entries(productCounts)
          .map(([name, data]) => ({ name, ...data }))
          .filter(p => !isNaN(p.revenue) && !isNaN(p.quantity) && p.quantity > 0)
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10);

        const drinkRevenueByDay: Record<string, { revenue: number; orders: number }> = {};
        paidOrders.forEach(order => {
          const date = parisDay(order.created_at);
          if (!drinkRevenueByDay[date]) drinkRevenueByDay[date] = { revenue: 0, orders: 0 };
          drinkRevenueByDay[date].revenue += orderRevenue(order).gross;
          drinkRevenueByDay[date].orders += 1;
        });
        const drinkRevenueByDayArray = Object.entries(drinkRevenueByDay)
          .map(([date, data]) => ({ date, ...data }))
          .sort((a, b) => a.date.localeCompare(b.date));

        const statusCounts: Record<string, number> = {};
        allOrders?.forEach(order => {
          const status = order.status === 'pending' ? 'pending' : order.status === 'paid' ? 'paid' : 'served';
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        const ordersByStatus = Object.entries(statusCounts).map(([status, count]) => ({ status, count }));

        // Category data
        const { data: drinksData } = await supabase.from('drinks').select('id, collection, name').eq('venue_id', venueId!);
        const drinkMap = new Map(drinksData?.map(d => [d.id, { collection: d.collection, name: d.name }]) || []);
        const drinkSales: Record<string, { name: string; qty: number; revenue: number }> = {};
        paidOrders.forEach(order => {
          const items = order.items as any[];
          items.forEach(item => {
            if (!drinkSales[item.drinkId]) drinkSales[item.drinkId] = { name: item.name, qty: 0, revenue: 0 };
            drinkSales[item.drinkId].qty += item.qty;
            drinkSales[item.drinkId].revenue += item.unitPrice * item.qty;
          });
        });

        const validCollections = ['drink', 'shot', 'soft'];
        const categoryMap: Record<string, number> = {};
        Object.entries(drinkSales).forEach(([drinkId, sales]) => {
          const drink = drinkMap.get(drinkId);
          const collection = drink?.collection || 'drink';
          const normalizedCollection = validCollections.includes(collection) ? collection : 'drink';
          categoryMap[normalizedCollection] = (categoryMap[normalizedCollection] || 0) + sales.revenue;
        });
        const collectionColors: Record<string, string> = {
          drink: 'hsl(0 85% 50%)', shot: 'hsl(160 84% 39%)', bottle: 'hsl(199 89% 48%)', soft: 'hsl(38 92% 50%)',
        };
        const categoryData = Object.entries(categoryMap)
          .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value, color: collectionColors[name] || '#6B7280' }))
          .filter(c => c.value > 0);

        const hourlyData = Array.from({ length: 24 }, (_, hour) => {
          const hourOrders = paidOrders.filter(o => parisHour(o.created_at) === hour);
          return { hour: `${hour}h`, orders: hourOrders.length, revenue: hourOrders.reduce((sum, o) => sum + orderRevenue(o).gross, 0) };
        }).filter(d => d.orders > 0);
        const rushHours = [...hourlyData].sort((a, b) => b.orders - a.orders).slice(0, 3).map(h => h.hour).join(', ');

        // Conversion is measured from a single source — visitor sessions — so the
        // funnel stages reconcile. (Previously a Math.max() with the orders count
        // could inflate the rate when session tracking and orders disagreed.)
        const visitors = visitorSessions?.length || 0;
        const addedToCart = visitorSessions?.filter(v => v.added_to_cart).length || 0;
        const proceededToCheckout = visitorSessions?.filter(v => v.proceeded_to_checkout).length || 0;
        const completedFromSessions = visitorSessions?.filter(v => v.completed_order).length || 0;
        const conversionRate = visitors > 0 ? Math.min((completedFromSessions / visitors) * 100, 100) : 0;
        const cartConversionRate = addedToCart > 0 ? Math.min((proceededToCheckout / addedToCart) * 100, 100) : 0;
        const checkoutConversionRate = proceededToCheckout > 0 ? Math.min((completedFromSessions / proceededToCheckout) * 100, 100) : 0;

        setDrinkAnalytics({
          totalRevenue: drinkTotalRevenue, netRevenue: drinkNetRevenue, stripeFee: drinkStripeFee,
          partialRefunded: drinkRev.refunded,
          totalOrders, avgOrderValue, uniqueCustomers: uniqueDrinkCustomers, topProducts,
          revenueByDay: drinkRevenueByDayArray, ordersByStatus, categoryData, hourlyData,
          rushHours: rushHours || 'N/A', visitors, addedToCart, proceededToCheckout,
          conversionRate, cartConversionRate, checkoutConversionRate,
        });
      }

      // ==================== PROCESS TICKET ANALYTICS ====================
      const paidTickets = allTickets || [];
      // Club revenue = total_price − service_fee − insurance_fee (== unit_price×qty face value).
      // Stripe is charged on the full client-paid total_price, not the face value.
      const ticketRev = paidTickets.reduce((acc, t: any) => {
        const r = ticketRevenue(t);
        acc.gross += r.gross; acc.refunded += r.refunded; acc.stripe += r.stripe;
        return acc;
      }, { gross: 0, refunded: 0, stripe: 0 });
      const ticketTotalRevenue = ticketRev.gross;
      const ticketStripeFee = ticketRev.stripe;
      const ticketNetRevenue = ticketRev.gross - ticketRev.refunded - ticketRev.stripe;
      const totalTicketQuantity = paidTickets.reduce((sum, t) => sum + t.quantity, 0);
      const avgTicketPrice = totalTicketQuantity > 0 ? ticketTotalRevenue / totalTicketQuantity : 0;
      const uniqueTicketCustomers = new Set(paidTickets.map(t => t.user_email).filter(Boolean)).size;

      // Tickets by event
      const eventCounts: Record<string, { quantity: number; revenue: number }> = {};
      paidTickets.forEach((ticket: any) => {
        const eventTitle = ticket.events?.title || 'Unknown Event';
        if (!eventCounts[eventTitle]) eventCounts[eventTitle] = { quantity: 0, revenue: 0 };
        eventCounts[eventTitle].quantity += ticket.quantity;
        eventCounts[eventTitle].revenue += Number(ticket.unit_price) * ticket.quantity;
      });
      const ticketsByEvent = Object.entries(eventCounts).map(([eventTitle, data]) => ({ eventTitle, ...data })).sort((a, b) => b.revenue - a.revenue);

      // Tickets by round (phase)
      const roundCounts: Record<string, { quantity: number; revenue: number; maxTickets: number; ticketsSold: number; position: number }> = {};
      paidTickets.forEach((ticket: any) => {
        const roundName = ticket.ticket_rounds?.name || 'Unknown Round';
        if (!roundCounts[roundName]) roundCounts[roundName] = { quantity: 0, revenue: 0, maxTickets: ticket.ticket_rounds?.max_tickets || 0, ticketsSold: ticket.ticket_rounds?.tickets_sold || 0, position: ticket.ticket_rounds?.position || 0 };
        roundCounts[roundName].quantity += ticket.quantity;
        roundCounts[roundName].revenue += Number(ticket.unit_price) * ticket.quantity;
      });
      const ticketsByRound = Object.entries(roundCounts).map(([roundName, data]) => ({ roundName, ...data })).sort((a, b) => a.position - b.position);

      // Tickets by type
      const typeCounts: Record<string, { quantity: number; revenue: number }> = {};
      paidTickets.forEach((ticket: any) => {
        const ticketType = ticket.ticket_type || ticket.ticket_rounds?.ticket_type || 'standard';
        if (!typeCounts[ticketType]) typeCounts[ticketType] = { quantity: 0, revenue: 0 };
        typeCounts[ticketType].quantity += ticket.quantity;
        typeCounts[ticketType].revenue += Number(ticket.unit_price) * ticket.quantity;
      });
      const ticketsByType = Object.entries(typeCounts).map(([ticketType, data]) => ({
        ticketType, ...data, share: totalTicketQuantity > 0 ? (data.quantity / totalTicketQuantity) * 100 : 0,
      }));

      // Revenue by day
      const ticketRevenueByDay: Record<string, { revenue: number; tickets: number }> = {};
      paidTickets.forEach(ticket => {
        const date = parisDay(ticket.created_at);
        if (!ticketRevenueByDay[date]) ticketRevenueByDay[date] = { revenue: 0, tickets: 0 };
        ticketRevenueByDay[date].revenue += Number(ticket.unit_price) * ticket.quantity;
        ticketRevenueByDay[date].tickets += ticket.quantity;
      });
      const ticketRevenueByDayArray = Object.entries(ticketRevenueByDay).map(([date, data]) => ({ date, ...data })).sort((a, b) => a.date.localeCompare(b.date));

      // Hourly data
      const ticketHourlyData = Array.from({ length: 24 }, (_, hour) => {
        const hourTickets = paidTickets.filter(t => parisHour(t.created_at) === hour);
        return { hour: `${hour}h`, tickets: hourTickets.reduce((sum, t) => sum + t.quantity, 0), revenue: hourTickets.reduce((sum, t) => sum + Number(t.unit_price) * t.quantity, 0) };
      }).filter(d => d.tickets > 0);

      // Launch metrics
      const presaleTickets = paidTickets.filter((t: any) => {
        const pos = t.ticket_rounds?.position;
        return pos === 1 || pos === 0;
      });
      const publicTickets = paidTickets.filter((t: any) => {
        const pos = t.ticket_rounds?.position;
        return pos !== 1 && pos !== 0;
      });
      const presaleBuyers = presaleTickets.reduce((sum, t) => sum + t.quantity, 0);
      const presaleRevenue = presaleTickets.reduce((sum, t) => sum + Number(t.unit_price) * t.quantity, 0);

      // Determine total available tickets for demand ratio
      const selectedEvent = events.find(e => e.id === selectedEventId);
      const totalAvailable = selectedEvent?.maxTickets || ticketsByRound.reduce((sum, r) => sum + r.maxTickets, 0) || totalTicketQuantity;
      const demandRatio = totalAvailable > 0 ? (waitlistCount + totalTicketQuantity) / totalAvailable : 0;
      // null when there's no waitlist data — showing 100% would be a fabricated metric.
      const presaleConversionRate = waitlistCount > 0 ? Math.min((presaleBuyers / waitlistCount) * 100, 100) : null;

      // Velocity milestones
      const sortedByTime = [...paidTickets].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const firstSaleTime = sortedByTime.length > 0 ? new Date(sortedByTime[0].created_at).getTime() : null;
      const milestones = [25, 50, 100];
      const velocityMilestones = milestones.map(milestone => {
        let cumulative = 0;
        for (const ticket of sortedByTime) {
          cumulative += ticket.quantity;
          if (cumulative >= milestone && firstSaleTime) {
            const elapsed = new Date(ticket.created_at).getTime() - firstSaleTime;
            const hours = Math.floor(elapsed / 3600000);
            const minutes = Math.floor((elapsed % 3600000) / 60000);
            return { label: `${milestone}`, time: hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min` };
          }
        }
        return { label: `${milestone}`, time: null };
      });

      // Cumulative sales for chart
      let cumulativeCount = 0;
      const cumulativeSales = sortedByTime.map(ticket => {
        cumulativeCount += ticket.quantity;
        const minutesSinceLaunch = firstSaleTime ? Math.round((new Date(ticket.created_at).getTime() - firstSaleTime) / 60000) : 0;
        return { minutesSinceLaunch, ticketsSold: cumulativeCount };
      });

      // Presale vs Public donut
      const publicBuyers = publicTickets.reduce((sum, t) => sum + t.quantity, 0);
      const presaleVsPublic = [
        { name: 'Presale', value: presaleBuyers, color: 'hsl(0 85% 50%)' },
        { name: 'Public', value: publicBuyers, color: 'hsl(199 89% 48%)' },
      ].filter(d => d.value > 0);

      setTicketAnalytics({
        totalRevenue: ticketTotalRevenue, netRevenue: ticketNetRevenue, stripeFee: ticketStripeFee,
        partialRefunded: ticketRev.refunded,
        totalTickets: totalTicketQuantity, avgTicketPrice, uniqueCustomers: uniqueTicketCustomers,
        ticketsByEvent, ticketsByRound, ticketsByType, revenueByDay: ticketRevenueByDayArray, hourlyData: ticketHourlyData,
        waitlistSize: waitlistCount, presaleBuyers, presaleRevenue, presaleConversionRate, demandRatio,
        velocityMilestones, cumulativeSales, presaleVsPublic,
      });

      // ==================== PROCESS TABLE ANALYTICS ====================
      const paidReservations = allTableReservations || [];
      // Club revenue = total_price − service_fee − management_fee (Yuno fees excluded).
      const gross = (r: any) => tableRevenue(r).gross;
      const tableRev = paidReservations.reduce((acc, r: any) => {
        const x = tableRevenue(r);
        acc.gross += x.gross; acc.refunded += x.refunded; acc.stripe += x.stripe;
        return acc;
      }, { gross: 0, refunded: 0, stripe: 0 });
      const tableTotalRevenue = tableRev.gross;
      const tableStripeFee = tableRev.stripe;
      const tableNetRevenue = tableRev.gross - tableRev.refunded - tableRev.stripe;
      const totalReservations = paidReservations.length;
      const avgReservationValue = totalReservations > 0 ? tableTotalRevenue / totalReservations : 0;
      const uniqueTableCustomers = new Set(paidReservations.map(r => r.user_email).filter(Boolean)).size;

      const zoneCounts: Record<string, { count: number; revenue: number }> = {};
      paidReservations.forEach((res: any) => {
        const zoneName = res.table_zones?.name || 'Unknown Zone';
        if (!zoneCounts[zoneName]) zoneCounts[zoneName] = { count: 0, revenue: 0 };
        zoneCounts[zoneName].count += 1;
        zoneCounts[zoneName].revenue += gross(res);
      });
      const reservationsByZone = Object.entries(zoneCounts).map(([zoneName, data]) => ({ zoneName, ...data })).sort((a, b) => b.revenue - a.revenue);

      const tableRevenueByDay: Record<string, { revenue: number; reservations: number }> = {};
      paidReservations.forEach((res: any) => {
        const date = parisDay(res.created_at);
        if (!tableRevenueByDay[date]) tableRevenueByDay[date] = { revenue: 0, reservations: 0 };
        tableRevenueByDay[date].revenue += gross(res);
        tableRevenueByDay[date].reservations += 1;
      });
      const tableRevenueByDayArray = Object.entries(tableRevenueByDay).map(([date, data]) => ({ date, ...data })).sort((a, b) => a.date.localeCompare(b.date));

      const eventResCounts: Record<string, { count: number; revenue: number }> = {};
      paidReservations.forEach((res: any) => {
        const eventTitle = res.events?.title || 'Unknown Event';
        if (!eventResCounts[eventTitle]) eventResCounts[eventTitle] = { count: 0, revenue: 0 };
        eventResCounts[eventTitle].count += 1;
        eventResCounts[eventTitle].revenue += gross(res);
      });
      const reservationsByEvent = Object.entries(eventResCounts).map(([eventTitle, data]) => ({ eventTitle, ...data })).sort((a, b) => b.revenue - a.revenue);

      const tableHourlyData = Array.from({ length: 24 }, (_, hour) => {
        const hourRes = paidReservations.filter((r: any) => parisHour(r.created_at) === hour);
        return { hour: `${hour}h`, reservations: hourRes.length, revenue: hourRes.reduce((sum: number, r: any) => sum + gross(r), 0) };
      }).filter(d => d.reservations > 0);

      setTableAnalytics({
        totalRevenue: tableTotalRevenue, netRevenue: tableNetRevenue, stripeFee: tableStripeFee,
        partialRefunded: tableRev.refunded,
        totalReservations, avgReservationValue, uniqueCustomers: uniqueTableCustomers,
        reservationsByZone, reservationsByEvent, revenueByDay: tableRevenueByDayArray, hourlyData: tableHourlyData,
      });

      // ==================== UNIQUE GUESTS (deduped across categories) + PERIOD TOTALS ====================
      // A guest who bought a drink AND a ticket counts once (the old per-category sum double-counted).
      const guestEmails = new Set<string>();
      [...paidOrders, ...paidTickets, ...paidReservations].forEach((r: any) => { if (r.user_email) guestEmails.add(r.user_email); });
      const uniqueGuests = guestEmails.size;
      setUniqueGuestsTotal(uniqueGuests);
      const totalsNow: PeriodTotals = {
        revenue: drinkGrossForTotals + ticketTotalRevenue + tableTotalRevenue,
        orders: totalOrders + totalTicketQuantity + totalReservations,
        guests: uniqueGuests,
      };
      setCurrentTotals(totalsNow);

      // Real "vs previous period" deltas — only meaningful in global venue mode with a fixed window.
      const windowMs = getWindowMs(dateRange);
      if (!isOrganizerScope && venueId && mode === 'global' && startDate && windowMs) {
        const prevEnd = startDate;
        const prevStart = new Date(startDate.getTime() - windowMs);
        try {
          setPreviousTotals(await fetchPreviousTotals(venueId, prevStart, prevEnd));
        } catch { setPreviousTotals(null); }
      } else {
        setPreviousTotals(null);
      }

      // ==================== PROCESS REFUND ANALYTICS ====================
      // All three sources are windowed on the SAME field (refunded_at) so a refund
      // issued today on an old booking is counted consistently across categories.
      let refundOrdersData: any[] = [];
      if (!isOrganizerScope && venueId) {
        let refundOrdersQuery = supabase
          .from('orders')
          .select('id, refund_amount, refund_reason, refunded_at, created_at, total')
          .eq('venue_id', venueId)
          .eq('status', 'refunded');
        if (mode === 'event' && selectedEventId) refundOrdersQuery = refundOrdersQuery.eq('event_id', selectedEventId);
        else if (startDate) refundOrdersQuery = refundOrdersQuery.gte('refunded_at', startDate.toISOString());
        const { data } = await refundOrdersQuery;
        refundOrdersData = data || [];
      }
      const refundedOrders = refundOrdersData;

      // Fetch refunded tickets
      let refundTicketsQuery = supabase
        .from('tickets')
        .select('id, refund_amount, refund_reason, refunded_at, created_at, total_price, event_id, events!inner(venue_id)')
        .eq('status', 'refunded');
      if (mode === 'event' && selectedEventId) {
        refundTicketsQuery = refundTicketsQuery.eq('event_id', selectedEventId);
      } else if (isOrganizerScope) {
        refundTicketsQuery = refundTicketsQuery.in('event_id', scopedEventIds!);
        if (startDate) refundTicketsQuery = refundTicketsQuery.gte('refunded_at', startDate.toISOString());
      } else {
        refundTicketsQuery = refundTicketsQuery.eq('events.venue_id', venueId!);
        if (startDate) refundTicketsQuery = refundTicketsQuery.gte('refunded_at', startDate.toISOString());
      }
      const { data: refundedTickets } = await refundTicketsQuery;

      // Fetch refunded table reservations
      let refundTablesQuery = supabase
        .from('table_reservations')
        .select('id, refund_amount, refund_reason, refunded_at, created_at, total_price, event_id, events!inner(venue_id)')
        .eq('status', 'refunded');
      if (mode === 'event' && selectedEventId) {
        refundTablesQuery = refundTablesQuery.eq('event_id', selectedEventId);
      } else if (isOrganizerScope) {
        refundTablesQuery = refundTablesQuery.in('event_id', scopedEventIds!);
        if (startDate) refundTablesQuery = refundTablesQuery.gte('refunded_at', startDate.toISOString());
      } else {
        refundTablesQuery = refundTablesQuery.eq('events.venue_id', venueId!);
        if (startDate) refundTablesQuery = refundTablesQuery.gte('refunded_at', startDate.toISOString());
      }
      const { data: refundedTables } = await refundTablesQuery;

      // Aggregate all refund items
      interface RefundItem { type: string; amount: number; reason: string; date: string; }
      const allRefunds: RefundItem[] = [];

      // Fall back to created_at when refunded_at is missing, so no refund is silently
      // dropped from the by-day chart (previously tickets/tables used an empty date).
      const refundDay = (r: any): string => parisDay(r.refunded_at || r.created_at);
      refundedOrders.forEach((o: any) => {
        allRefunds.push({
          type: 'order',
          amount: Number(o.refund_amount) || Number(o.total),
          reason: o.refund_reason || '',
          date: refundDay(o),
        });
      });
      (refundedTickets || []).forEach((tk: any) => {
        allRefunds.push({
          type: 'ticket',
          amount: Number(tk.refund_amount) || Number(tk.total_price),
          reason: tk.refund_reason || '',
          date: refundDay(tk),
        });
      });
      (refundedTables || []).forEach((tr: any) => {
        allRefunds.push({
          type: 'table_reservation',
          amount: Number(tr.refund_amount) || Number(tr.total_price),
          reason: tr.refund_reason || '',
          date: refundDay(tr),
        });
      });

      const totalRefunded = allRefunds.reduce((s, r) => s + r.amount, 0);
      const totalRefundCount = allRefunds.length;
      const totalPaidTransactions = paidOrders.length + (allTickets?.length || 0) + (allTableReservations?.length || 0) + totalRefundCount;
      const refundRate = totalPaidTransactions > 0 ? (totalRefundCount / totalPaidTransactions) * 100 : 0;
      const avgRefundAmount = totalRefundCount > 0 ? totalRefunded / totalRefundCount : 0;

      // By type
      const byType: Record<string, { count: number; amount: number }> = {};
      allRefunds.forEach(r => {
        if (!byType[r.type]) byType[r.type] = { count: 0, amount: 0 };
        byType[r.type].count++;
        byType[r.type].amount += r.amount;
      });
      const refundsByType = Object.entries(byType).map(([type, d]) => ({ type, ...d }));

      // By day
      const byDay: Record<string, { amount: number; count: number }> = {};
      allRefunds.forEach(r => {
        if (!r.date) return;
        if (!byDay[r.date]) byDay[r.date] = { amount: 0, count: 0 };
        byDay[r.date].amount += r.amount;
        byDay[r.date].count++;
      });
      const refundsByDay = Object.entries(byDay).map(([date, d]) => ({ date, ...d })).sort((a, b) => a.date.localeCompare(b.date));

      // By reason
      const byReason: Record<string, { count: number; amount: number }> = {};
      allRefunds.forEach(r => {
        const key = r.reason || '';
        if (!byReason[key]) byReason[key] = { count: 0, amount: 0 };
        byReason[key].count++;
        byReason[key].amount += r.amount;
      });
      const refundsByReason = Object.entries(byReason).map(([reason, d]) => ({ reason, ...d })).sort((a, b) => b.amount - a.amount);

      setRefundAnalytics({
        totalRefunded, totalRefundCount, refundsByType, refundsByDay, refundsByReason,
        refundRate, avgRefundAmount,
      });

    } catch (err) {
      console.error('Error fetching analytics:', err);
    } finally {
      setLoading(false);
    }
  }, [venueId, organizerUserId, isOrganizerScope, dateRange, mode, selectedEventId, events]);

  useEffect(() => {
    if (isOrganizerScope ? !!organizerUserId : !!venueId) fetchEvents();
  }, [venueId, organizerUserId, isOrganizerScope, fetchEvents]);

  useEffect(() => {
    if (isOrganizerScope ? !!organizerUserId : !!venueId) fetchAnalytics();
  }, [venueId, organizerUserId, isOrganizerScope, dateRange, mode, selectedEventId, fetchAnalytics]);

  return {
    drinkAnalytics, ticketAnalytics, tableAnalytics, refundAnalytics, events,
    currentTotals, previousTotals, uniqueGuestsTotal,
    loading, refetch: fetchAnalytics,
  };
}
