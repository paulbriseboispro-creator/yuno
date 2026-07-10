import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';
import { getNightWindow, bucketHourParis, nightKeyParis } from '@/lib/liveops/nightWindow';

export type FeedItemType = 'order_created' | 'order_ready' | 'order_served' | 'ticket_scanned' | 'vip_scanned' | 'refund' | 'table_booked' | 'cloakroom';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type TimeWindow = 'live' | '1h' | 'full';
export type FeedFilter = 'all' | 'orders' | 'entry' | 'staff' | 'issues';

export interface FeedItem {
  id: string;
  type: FeedItemType;
  description: string;
  timestamp: string;
  actor?: string;
}

export interface LiveAlert {
  id: string;
  severity: AlertSeverity;
  titleKey: string;
  descriptionKey: string;
  timestamp: string;
}

export interface StaffMember {
  /** Unique row key: `${userId}:${role}` — one person can hold several roles in one night. */
  id: string;
  /** Auth user id, used to resolve the profile name. */
  userId: string;
  name: string;
  role: 'barman' | 'bouncer' | 'vip_host' | 'cloakroom';
  processedCount: number;
  isActive: boolean;
}

export interface OrderPipeline {
  pending: number;
  paid: number;
  preparing: number;
  ready: number;
  served: number;
  refunded: number;
}

export interface LiveKPIs {
  revenue: number;
  ticketsSold: number;
  ordersPlaced: number;
  ordersPending: number;
  ordersCompleted: number;
  avgOrderValue: number;
  entriesCount: number;
  refundsCount: number;
  cloakroomCount: number;
}

/**
 * Advanced live metrics — designed for the night-control dashboard.
 * Each one is computed from real data already fetched (no extra queries).
 */
export interface LiveAdvancedMetrics {
  /** Tickets scanned in vs. tickets sold (entry conversion %) */
  attendanceRate: number;
  /** Avg. minutes between order paid and order served */
  avgPrepMinutes: number;
  /** Orders prepared in the last 10 min (live throughput, orders/min) */
  ordersPerMinuteLive: number;
  /** Refund rate as % of paid orders */
  refundRatePct: number;
  /** Net revenue per attendee (revenue / scanned entries) */
  revenuePerAttendee: number;
}

export interface EntryHour {
  hour: number;
  count: number;
}

export interface ActiveEventInfo {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
}

/**
 * Realtime storms (one order per few seconds during a rush) used to trigger a
 * full 5-query refetch each. Refetches are now debounced: immediate when idle,
 * otherwise a single trailing fetch at the end of the window.
 */
const REFETCH_DEBOUNCE_MS = 2_500;

const DISMISSED_ALERTS_KEY = 'yuno-liveops-dismissed';

function loadDismissedAlerts(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_ALERTS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { night: string; ids: string[] };
    if (parsed.night !== nightKeyParis()) return new Set();
    return new Set(parsed.ids);
  } catch {
    return new Set();
  }
}

function persistDismissedAlerts(ids: Set<string>) {
  try {
    sessionStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify({ night: nightKeyParis(), ids: [...ids] }));
  } catch {
    // Storage full/unavailable — dismissal degrades to in-memory only.
  }
}

/**
 * Entity-stable feed item id. Historical rebuilds and realtime inserts MUST
 * produce the same id for the same underlying fact, otherwise the merge in
 * buildFeedFromData can't deduplicate and every event shows up twice.
 */
const feedId = (kind: 'ord' | 'rdy' | 'srv' | 'ref' | 'tik' | 'vip' | 'tbl' | 'clk', entityId: string) =>
  `${kind}-${entityId}`;

export function useLiveNightData(venueId: string | null, scopedEventId?: string | null) {
  const [kpis, setKpis] = useState<LiveKPIs>({
    revenue: 0, ticketsSold: 0, ordersPlaced: 0, ordersPending: 0,
    ordersCompleted: 0, avgOrderValue: 0, entriesCount: 0, refundsCount: 0, cloakroomCount: 0,
  });
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [pipeline, setPipeline] = useState<OrderPipeline>({ pending: 0, paid: 0, preparing: 0, ready: 0, served: 0, refunded: 0 });
  const [staffActivity, setStaffActivity] = useState<StaffMember[]>([]);
  const [entryFlow, setEntryFlow] = useState<EntryHour[]>([]);
  const [advancedMetrics, setAdvancedMetrics] = useState<LiveAdvancedMetrics>({
    attendanceRate: 0, avgPrepMinutes: 0, ordersPerMinuteLive: 0, refundRatePct: 0, revenuePerAttendee: 0,
  });
  const [activeEvents, setActiveEvents] = useState<ActiveEventInfo[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('full');

  const dismissedAlertIds = useRef<Set<string> | null>(null);
  if (dismissedAlertIds.current === null) dismissedAlertIds.current = loadDismissedAlerts();

  // Track realtime-only items (prepended on top of historical feed)
  const realtimeItems = useRef<FeedItem[]>([]);
  // All venue event ids touching tonight — client-side guard for realtime
  // payloads when no server-side event filter can be applied.
  const venueEventIds = useRef<Set<string>>(new Set());

  // Selected event, defaulting to the earliest-starting active one.
  const activeEvent = useMemo<ActiveEventInfo | null>(
    () => activeEvents.find(e => e.id === selectedEventId) ?? activeEvents[0] ?? null,
    [activeEvents, selectedEventId],
  );

  const getTimeWindow = useCallback(() => {
    const now = new Date();

    if (timeWindow === 'live') {
      return { start: new Date(now.getTime() - 10 * 60 * 1000).toISOString(), end: now.toISOString() };
    }
    if (timeWindow === '1h') {
      return { start: new Date(now.getTime() - 60 * 60 * 1000).toISOString(), end: now.toISOString() };
    }

    // 'full' → use active event window if available
    if (activeEvent) {
      return { start: activeEvent.start_at, end: activeEvent.end_at };
    }

    // Fallback: tonight in Paris time
    return getNightWindow(now);
  }, [timeWindow, activeEvent]);

  const addRealtimeFeedItem = useCallback((item: FeedItem) => {
    if (isPaused) return;
    if (realtimeItems.current.some(existing => existing.id === item.id)) return;
    realtimeItems.current = [item, ...realtimeItems.current].slice(0, 30);
  }, [isPaused]);

  const fetchActiveEvents = useCallback(async () => {
    if (!venueId) return;
    // If scoped to a specific event, force it as the only active event
    if (scopedEventId) {
      const { data } = await supabase
        .from('events')
        .select('id, title, start_at, end_at')
        .eq('id', scopedEventId)
        .maybeSingle();
      const next: ActiveEventInfo[] = data
        ? [{ id: data.id, title: data.title, start_at: data.start_at, end_at: data.end_at }]
        : [];
      venueEventIds.current = new Set(next.map(e => e.id));
      setActiveEvents(prev => (sameEvents(prev, next) ? prev : next));
      return;
    }
    const now = new Date();
    const nowIso = now.toISOString();
    const [activeRes, recentRes] = await Promise.all([
      supabase
        .from('events')
        .select('id, title, start_at, end_at')
        .eq('venue_id', venueId)
        .eq('is_active', true)
        .lte('start_at', nowIso)
        .gte('end_at', nowIso)
        .order('start_at', { ascending: true }),
      supabase
        .from('events')
        .select('id')
        .eq('venue_id', venueId)
        .gte('end_at', new Date(now.getTime() - 24 * 3600 * 1000).toISOString()),
    ]);
    const next: ActiveEventInfo[] = (activeRes.data || []).map(d => ({
      id: d.id, title: d.title, start_at: d.start_at, end_at: d.end_at,
    }));
    venueEventIds.current = new Set((recentRes.data || []).map(e => e.id));
    // Structural comparison: returning a fresh array every poll would change
    // fetchAllData's identity, tear down and resubscribe every realtime
    // channel, and loop the main effect indefinitely.
    setActiveEvents(prev => (sameEvents(prev, next) ? prev : next));
  }, [venueId, scopedEventId]);

  // Build feed from historical data + realtime items
  const buildFeedFromData = useCallback((orders: any[], tickets: any[], tables: any[], cloakroom: any[]) => {
    const items: FeedItem[] = [];

    orders.slice(0, 30).forEach(o => {
      if (o.status === 'refunded' || o.refunded_at) {
        items.push({ id: feedId('ref', o.id), type: 'refund', description: `#${o.order_number || o.id.slice(0, 6)} — ${Number(o.refund_amount || o.total || 0).toFixed(0)} €`, timestamp: o.refunded_at || o.created_at });
      }
      if (o.status === 'served' || o.prep_status === 'served') {
        items.push({ id: feedId('srv', o.id), type: 'order_served', description: `#${o.order_number || o.id.slice(0, 6)}`, timestamp: o.served_at || o.created_at });
      } else if (o.prep_status === 'ready') {
        items.push({ id: feedId('rdy', o.id), type: 'order_ready', description: `#${o.order_number || o.id.slice(0, 6)}`, timestamp: o.ready_at || o.created_at });
      } else if (o.status === 'paid') {
        items.push({ id: feedId('ord', o.id), type: 'order_created', description: `#${o.order_number || o.id.slice(0, 6)} — ${Number(o.total).toFixed(0)} €`, timestamp: o.created_at, actor: o.user_email });
      }
    });

    tickets.filter(t => t.entry_scanned).slice(0, 20).forEach(t => {
      items.push({ id: feedId('tik', t.id), type: 'ticket_scanned', description: t.full_name || 'Guest', timestamp: t.entry_scanned_at || t.created_at });
    });

    tables.filter(t => t.entry_scanned).slice(0, 10).forEach(t => {
      items.push({ id: feedId('vip', t.id), type: 'vip_scanned', description: t.full_name || 'VIP', timestamp: t.entry_scanned_at || t.created_at });
    });
    tables.filter(t => !t.entry_scanned).slice(0, 10).forEach(t => {
      items.push({ id: feedId('tbl', t.id), type: 'table_booked', description: t.full_name || 'VIP', timestamp: t.created_at });
    });

    cloakroom.slice(0, 10).forEach(c => {
      items.push({ id: feedId('clk', c.id), type: 'cloakroom', description: `#${(c as any).cloakroom_number || ''}`, timestamp: c.created_at });
    });

    // Merge realtime items — same entity-stable ids on both sides, so this is
    // a real dedup (historical rows win once the refetch catches up).
    const historicalIds = new Set(items.map(i => i.id));
    const rtItems = realtimeItems.current.filter(rt => !historicalIds.has(rt.id));

    const merged = [...rtItems, ...items];
    merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    setFeed(merged.slice(0, 80));
  }, []);

  const fetchAllData = useCallback(async () => {
    if (!venueId) return;
    const { start, end } = getTimeWindow();
    const eventId = activeEvent?.id;

    try {
      let ordersQuery = supabase
        .from('orders')
        .select('id, total, status, prep_status, created_at, served_at, ready_at, prep_claimed_by, user_email, service_fee, refunded_at, order_number, refund_amount')
        .eq('venue_id', venueId)
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false });
      if (eventId) ordersQuery = ordersQuery.eq('event_id', eventId);

      let ticketsQuery: any;
      if (eventId) {
        ticketsQuery = supabase
          .from('tickets')
          .select('id, total_price, service_fee, insurance_fee, entry_scanned, entry_scanned_at, entry_scanned_by, full_name, created_at, event_id')
          .eq('event_id', eventId)
          .eq('status', 'paid')
          .gte('created_at', start)
          .lte('created_at', end);
      } else {
        ticketsQuery = supabase
          .from('tickets')
          .select('id, total_price, service_fee, insurance_fee, entry_scanned, entry_scanned_at, entry_scanned_by, full_name, created_at, event_id, events!inner(venue_id)')
          .eq('events.venue_id', venueId)
          .eq('status', 'paid')
          .gte('created_at', start)
          .lte('created_at', end);
      }

      let tablesQuery = supabase
        .from('table_reservations')
        .select('id, deposit, status, entry_scanned, entry_scanned_at, entry_scanned_by, full_name, created_at, zone_id, event_id, table_zones!inner(venue_id)')
        .eq('table_zones.venue_id', venueId)
        .gte('created_at', start)
        .lte('created_at', end);
      if (eventId) tablesQuery = tablesQuery.eq('event_id', eventId);

      let cloakroomQuery = supabase
        .from('cloakroom_transactions')
        .select('id, created_at, cloakroom_number, staff_id')
        .eq('venue_id', venueId)
        .gte('created_at', start)
        .lte('created_at', end);
      if (eventId) cloakroomQuery = cloakroomQuery.eq('event_id', eventId);

      const [ordersRes, ticketsRes, tablesRes, cloakroomRes] = await Promise.all([
        ordersQuery, ticketsQuery, tablesQuery, cloakroomQuery,
      ]);

      const orders = ordersRes.data || [];
      const tickets = ticketsRes.data || [];
      const tables = tablesRes.data || [];
      const cloakroom = cloakroomRes.data || [];

      // KPIs
      const paidOrders = orders.filter(o => o.status === 'paid' || o.status === 'served');
      const orderRevenue = paidOrders.reduce((s, o) => s + Number(o.total) - Number(o.service_fee || 0), 0);
      const ticketRevenue = tickets.reduce((s, t) => s + Number(t.total_price) - Number(t.service_fee || 0) - Number(t.insurance_fee || 0), 0);
      const tableRevenue = tables.filter(t => t.status === 'confirmed' || t.status === 'paid').reduce((s, t) => s + Number(t.deposit || 0), 0);
      const totalRevenue = orderRevenue + ticketRevenue + tableRevenue;

      const scannedTickets = tickets.filter(t => t.entry_scanned);
      const scannedTables = tables.filter(t => t.entry_scanned);
      const totalEntries = scannedTickets.length + scannedTables.length;

      const refundedOrders = orders.filter(o => o.status === 'refunded' || o.refunded_at);
      const pendingOrders = orders.filter(o => o.status === 'pending');
      const paidWaiting = orders.filter(o => o.status === 'paid' && (!o.prep_status || o.prep_status === 'queue'));
      // Orders the bar is actively preparing — previously fell through every
      // bucket and vanished from the live board.
      const preparingOrders = orders.filter(o => o.status === 'paid' && o.prep_status === 'preparing');
      const readyOrders = orders.filter(o => o.prep_status === 'ready');
      const servedOrders = orders.filter(o => o.status === 'served' || o.prep_status === 'served');

      setKpis({
        revenue: totalRevenue,
        ticketsSold: tickets.length,
        ordersPlaced: paidOrders.length,
        ordersPending: paidWaiting.length,
        ordersCompleted: servedOrders.length,
        avgOrderValue: paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0,
        entriesCount: totalEntries,
        refundsCount: refundedOrders.length,
        cloakroomCount: cloakroom.length,
      });

      // Pipeline: real Yuno statuses
      setPipeline({
        pending: pendingOrders.length,
        paid: paidWaiting.length,
        preparing: preparingOrders.length,
        ready: readyOrders.length,
        served: servedOrders.length,
        refunded: refundedOrders.length,
      });

      // ===== Advanced live metrics (computed from already-fetched data) =====
      // Attendance rate = scanned tickets / sold tickets
      const attendanceRate = tickets.length > 0
        ? Math.round((scannedTickets.length / tickets.length) * 100)
        : 0;

      // Avg prep minutes between paid → served (sample of last 50 served orders)
      const servedSample = servedOrders
        .filter(o => o.served_at && o.created_at)
        .slice(0, 50);
      const avgPrepMinutes = servedSample.length > 0
        ? Math.round(
            servedSample.reduce((s, o) => {
              const ms = new Date(o.served_at).getTime() - new Date(o.created_at).getTime();
              return s + Math.max(0, ms / 60000);
            }, 0) / servedSample.length
          )
        : 0;

      // Orders per minute in the last 10 min (live throughput)
      const tenMinAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const last10minOrders = paidOrders.filter(o => o.created_at >= tenMinAgoIso).length;
      const ordersPerMinuteLive = +(last10minOrders / 10).toFixed(1);

      // Refund rate %
      const refundRatePct = paidOrders.length > 0
        ? Math.round((refundedOrders.length / paidOrders.length) * 100)
        : 0;

      // Revenue per attendee (€)
      const revenuePerAttendee = totalEntries > 0
        ? +(totalRevenue / totalEntries).toFixed(1)
        : 0;

      setAdvancedMetrics({
        attendanceRate,
        avgPrepMinutes,
        ordersPerMinuteLive,
        refundRatePct,
        revenuePerAttendee,
      });

      // Entry flow (hourly, Paris wall-clock — browser timezone shifted the
      // histogram for owners abroad)
      const hourMap = new Map<number, number>();
      [...scannedTickets, ...scannedTables].forEach(item => {
        const scannedAt = (item as any).entry_scanned_at;
        if (scannedAt) {
          const h = bucketHourParis(scannedAt);
          hourMap.set(h, (hourMap.get(h) || 0) + 1);
        }
      });
      setEntryFlow(Array.from({ length: 24 }, (_, i) => ({ hour: i, count: hourMap.get(i) || 0 })));

      // Staff activity — keyed by user AND role so a person scanning at the
      // door and later serving at the bar shows up once per station instead of
      // having their role overwritten by whichever loop ran last.
      const staffMap = new Map<string, { userId: string; role: StaffMember['role']; count: number }>();
      const bumpStaff = (userId: string, role: StaffMember['role']) => {
        const key = `${userId}:${role}`;
        const entry = staffMap.get(key) || { userId, role, count: 0 };
        entry.count++;
        staffMap.set(key, entry);
      };
      orders.filter(o => o.prep_claimed_by).forEach(o => bumpStaff(o.prep_claimed_by!, 'barman'));
      [...scannedTickets, ...scannedTables].forEach(item => {
        const scannedBy = (item as any).entry_scanned_by;
        if (scannedBy) bumpStaff(scannedBy, 'bouncer');
      });
      cloakroom.forEach(c => {
        const staffId = (c as any).staff_id;
        if (staffId) bumpStaff(staffId, 'cloakroom');
      });

      const staffList: StaffMember[] = Array.from(staffMap.entries()).map(([key, data]) => ({
        id: key,
        userId: data.userId,
        name: `Staff ${data.userId.slice(0, 4)}`,
        role: data.role,
        processedCount: data.count,
        isActive: data.count > 0,
      }));
      if (staffList.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', [...new Set(staffList.map(s => s.userId))]);
        if (profiles) {
          profiles.forEach(p => {
            const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ');
            if (!fullName) return;
            staffList.forEach(staff => {
              if (staff.userId === p.id) staff.name = fullName;
            });
          });
        }
      }
      setStaffActivity(staffList);

      // Build feed from historical data
      buildFeedFromData(orders, tickets, tables, cloakroom);

      // Alerts
      const newAlerts: LiveAlert[] = [];
      if (paidWaiting.length > 5) {
        newAlerts.push({ id: 'backlog', severity: 'warning', titleKey: 'live.alertBacklogTitle', descriptionKey: 'live.alertBacklogDesc', timestamp: new Date().toISOString() });
      }
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      if (orders.filter(o => o.created_at >= fiveMinAgo).length > 10) {
        newAlerts.push({ id: 'rush', severity: 'info', titleKey: 'live.alertRushTitle', descriptionKey: 'live.alertRushDesc', timestamp: new Date().toISOString() });
      }
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      if (orders.filter(o => o.refunded_at && o.refunded_at >= thirtyMinAgo).length > 3) {
        newAlerts.push({ id: 'refund-spike', severity: 'critical', titleKey: 'live.alertRefundTitle', descriptionKey: 'live.alertRefundDesc', timestamp: new Date().toISOString() });
      }
      setAlerts(newAlerts.filter(a => !dismissedAlertIds.current!.has(a.id)));

    } catch (err) {
      console.error('Live night data fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [venueId, getTimeWindow, activeEvent, buildFeedFromData]);

  // ── Debounced refetch (leading + trailing) ────────────────────────────────
  const lastFetchAtRef = useRef(0);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = useCallback(() => {
    const elapsed = Date.now() - lastFetchAtRef.current;
    if (elapsed >= REFETCH_DEBOUNCE_MS) {
      lastFetchAtRef.current = Date.now();
      fetchAllData();
    } else if (!refetchTimerRef.current) {
      refetchTimerRef.current = setTimeout(() => {
        refetchTimerRef.current = null;
        lastFetchAtRef.current = Date.now();
        fetchAllData();
      }, REFETCH_DEBOUNCE_MS - elapsed);
    }
  }, [fetchAllData]);

  const dismissAlert = useCallback((id: string) => {
    dismissedAlertIds.current!.add(id);
    persistDismissedAlerts(dismissedAlertIds.current!);
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  useEffect(() => {
    if (!venueId) return;

    fetchActiveEvents();
    lastFetchAtRef.current = Date.now();
    fetchAllData();

    // When an event is pinned, tickets/tables can be filtered server-side.
    // Otherwise those tables have no venue column to filter on, so we fall
    // back to a client-side guard against the venue's event ids — without it
    // every scan anywhere on the platform used to trigger a full refetch here.
    const eventFilter = activeEvent ? `event_id=eq.${activeEvent.id}` : undefined;
    const isOurEvent = (eventId: unknown): boolean =>
      Boolean(eventFilter) || (typeof eventId === 'string' && venueEventIds.current.has(eventId));

    const orderChannel = supabase
      .channel(uniqueChannel('live-orders'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `venue_id=eq.${venueId}` }, (payload) => {
        scheduleRefetch();
        if (payload.eventType === 'INSERT') {
          const o = payload.new as any;
          addRealtimeFeedItem({ id: feedId('ord', o.id), type: 'order_created', description: `#${o.order_number || o.id.slice(0, 6)} — ${Number(o.total).toFixed(0)} €`, timestamp: o.created_at, actor: o.user_email });
        } else if (payload.eventType === 'UPDATE') {
          const o = payload.new as any;
          if (o.prep_status === 'ready') addRealtimeFeedItem({ id: feedId('rdy', o.id), type: 'order_ready', description: `#${o.order_number || o.id.slice(0, 6)}`, timestamp: new Date().toISOString() });
          if (o.status === 'served' || o.prep_status === 'served') addRealtimeFeedItem({ id: feedId('srv', o.id), type: 'order_served', description: `#${o.order_number || o.id.slice(0, 6)}`, timestamp: o.served_at || new Date().toISOString() });
          if (o.refunded_at && !payload.old?.refunded_at) addRealtimeFeedItem({ id: feedId('ref', o.id), type: 'refund', description: `#${o.order_number || o.id.slice(0, 6)} — ${Number(o.refund_amount || 0).toFixed(0)} €`, timestamp: o.refunded_at });
        }
      }).subscribe();

    const ticketChannel = supabase
      .channel(uniqueChannel('live-tickets'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets', ...(eventFilter ? { filter: eventFilter } : {}) }, (payload) => {
        const t = payload.new as any;
        if (!isOurEvent(t.event_id)) return;
        if (t.entry_scanned && !payload.old?.entry_scanned) {
          addRealtimeFeedItem({ id: feedId('tik', t.id), type: 'ticket_scanned', description: t.full_name || t.user_email || 'Guest', timestamp: t.entry_scanned_at || new Date().toISOString() });
          scheduleRefetch();
        }
      }).subscribe();

    const tableChannel = supabase
      .channel(uniqueChannel('live-tables'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_reservations', ...(eventFilter ? { filter: eventFilter } : {}) }, (payload) => {
        const r = (payload.new ?? payload.old) as any;
        if (!isOurEvent(r?.event_id)) return;
        if (payload.eventType === 'INSERT') {
          addRealtimeFeedItem({ id: feedId('tbl', (payload.new as any).id), type: 'table_booked', description: (payload.new as any).full_name || 'VIP', timestamp: (payload.new as any).created_at });
        }
        if (payload.eventType === 'UPDATE') {
          const row = payload.new as any;
          if (row.entry_scanned && !payload.old?.entry_scanned) {
            addRealtimeFeedItem({ id: feedId('vip', row.id), type: 'vip_scanned', description: row.full_name || 'VIP', timestamp: row.entry_scanned_at || new Date().toISOString() });
          }
        }
        scheduleRefetch();
      }).subscribe();

    const cloakroomChannel = supabase
      .channel(uniqueChannel('live-cloakroom'))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cloakroom_transactions', filter: `venue_id=eq.${venueId}` }, (payload) => {
        const c = payload.new as any;
        addRealtimeFeedItem({ id: feedId('clk', c.id), type: 'cloakroom', description: `#${c.cloakroom_number || ''}`, timestamp: c.created_at });
        scheduleRefetch();
      }).subscribe();

    const pollMs = timeWindow === 'live' ? 10_000 : 30_000;
    const pollInterval = setInterval(scheduleRefetch, pollMs);

    return () => {
      supabase.removeChannel(orderChannel);
      supabase.removeChannel(ticketChannel);
      supabase.removeChannel(tableChannel);
      supabase.removeChannel(cloakroomChannel);
      clearInterval(pollInterval);
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
    };
  }, [venueId, fetchAllData, fetchActiveEvents, addRealtimeFeedItem, scheduleRefetch, timeWindow, activeEvent]);

  return {
    kpis, feed, alerts, pipeline, staffActivity, entryFlow, advancedMetrics,
    activeEvent, activeEvents, selectedEventId, loading, isPaused, timeWindow,
    setIsPaused, setTimeWindow, setSelectedEventId, dismissAlert,
  };
}

function sameEvents(a: ActiveEventInfo[], b: ActiveEventInfo[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((e, i) => {
    const o = b[i];
    return e.id === o.id && e.title === o.title && e.start_at === o.start_at && e.end_at === o.end_at;
  });
}
