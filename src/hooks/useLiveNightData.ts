import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
  id: string;
  name: string;
  role: 'barman' | 'bouncer' | 'vip_host' | 'cloakroom';
  processedCount: number;
  isActive: boolean;
}

export interface OrderPipeline {
  pending: number;
  paid: number;
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

function getParisNow(): Date {
  const now = new Date();
  const parisStr = now.toLocaleString('en-US', { timeZone: 'Europe/Paris' });
  return new Date(parisStr);
}

export function useLiveNightData(venueId: string | null, scopedEventId?: string | null) {
  const [kpis, setKpis] = useState<LiveKPIs>({
    revenue: 0, ticketsSold: 0, ordersPlaced: 0, ordersPending: 0,
    ordersCompleted: 0, avgOrderValue: 0, entriesCount: 0, refundsCount: 0, cloakroomCount: 0,
  });
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [pipeline, setPipeline] = useState<OrderPipeline>({ pending: 0, paid: 0, ready: 0, served: 0, refunded: 0 });
  const [staffActivity, setStaffActivity] = useState<StaffMember[]>([]);
  const [entryFlow, setEntryFlow] = useState<EntryHour[]>([]);
  const [advancedMetrics, setAdvancedMetrics] = useState<LiveAdvancedMetrics>({
    attendanceRate: 0, avgPrepMinutes: 0, ordersPerMinuteLive: 0, refundRatePct: 0, revenuePerAttendee: 0,
  });
  const [activeEvent, setActiveEvent] = useState<{ id: string; title: string; start_at: string; end_at: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('full');
  const dismissedAlertIds = useRef<Set<string>>(new Set());
  // Track realtime-only items (prepended on top of historical feed)
  const realtimeItems = useRef<FeedItem[]>([]);

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
    const parisNow = getParisNow();
    const hour = parisNow.getHours();
    let startParis: Date, endParis: Date;
    if (hour >= 18) {
      startParis = new Date(parisNow); startParis.setHours(18, 0, 0, 0);
      endParis = new Date(parisNow); endParis.setDate(endParis.getDate() + 1); endParis.setHours(6, 0, 0, 0);
    } else if (hour < 6) {
      startParis = new Date(parisNow); startParis.setDate(startParis.getDate() - 1); startParis.setHours(18, 0, 0, 0);
      endParis = new Date(parisNow); endParis.setHours(6, 0, 0, 0);
    } else {
      startParis = new Date(parisNow); startParis.setHours(0, 0, 0, 0);
      endParis = new Date(parisNow); endParis.setHours(23, 59, 59, 999);
    }
    const offsetMs = parisNow.getTime() - new Date().getTime();
    return {
      start: new Date(startParis.getTime() - offsetMs).toISOString(),
      end: new Date(endParis.getTime() - offsetMs).toISOString(),
    };
  }, [timeWindow, activeEvent]);

  const addRealtimeFeedItem = useCallback((item: Omit<FeedItem, 'id'>) => {
    if (isPaused) return;
    const newItem: FeedItem = { ...item, id: `rt-${crypto.randomUUID()}` };
    realtimeItems.current = [newItem, ...realtimeItems.current].slice(0, 30);
  }, [isPaused]);

  const fetchActiveEvent = useCallback(async () => {
    if (!venueId) return;
    // If scoped to a specific event, force it as the active event
    if (scopedEventId) {
      const { data } = await supabase
        .from('events')
        .select('id, title, start_at, end_at')
        .eq('id', scopedEventId)
        .maybeSingle();
      setActiveEvent(data ? { id: data.id, title: data.title, start_at: data.start_at, end_at: data.end_at } : null);
      return;
    }
    const now = new Date().toISOString();
    const { data } = await supabase
      .from('events')
      .select('id, title, start_at, end_at')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .lte('start_at', now)
      .gte('end_at', now)
      .limit(1)
      .maybeSingle();
    setActiveEvent(data ? { id: data.id, title: data.title, start_at: data.start_at, end_at: data.end_at } : null);
  }, [venueId, scopedEventId]);

  // Build feed from historical data + realtime items
  const buildFeedFromData = useCallback((orders: any[], tickets: any[], tables: any[], cloakroom: any[]) => {
    const items: FeedItem[] = [];

    orders.slice(0, 30).forEach(o => {
      if (o.status === 'refunded' || o.refunded_at) {
        items.push({ id: `h-ref-${o.id}`, type: 'refund', description: `#${o.order_number || o.id.slice(0, 6)} — ${Number(o.refund_amount || o.total || 0).toFixed(0)} €`, timestamp: o.refunded_at || o.created_at });
      }
      if (o.status === 'served' || o.prep_status === 'served') {
        items.push({ id: `h-srv-${o.id}`, type: 'order_served', description: `#${o.order_number || o.id.slice(0, 6)}`, timestamp: o.served_at || o.created_at });
      } else if (o.prep_status === 'ready') {
        items.push({ id: `h-rdy-${o.id}`, type: 'order_ready', description: `#${o.order_number || o.id.slice(0, 6)}`, timestamp: o.ready_at || o.created_at });
      } else if (o.status === 'paid') {
        items.push({ id: `h-ord-${o.id}`, type: 'order_created', description: `#${o.order_number || o.id.slice(0, 6)} — ${Number(o.total).toFixed(0)} €`, timestamp: o.created_at, actor: o.user_email });
      }
    });

    tickets.filter(t => t.entry_scanned).slice(0, 20).forEach(t => {
      items.push({ id: `h-tik-${t.id}`, type: 'ticket_scanned', description: t.full_name || 'Guest', timestamp: t.entry_scanned_at || t.created_at });
    });

    tables.filter(t => t.entry_scanned).slice(0, 10).forEach(t => {
      items.push({ id: `h-vip-${t.id}`, type: 'vip_scanned', description: t.full_name || 'VIP', timestamp: t.entry_scanned_at || t.created_at });
    });
    tables.filter(t => !t.entry_scanned).slice(0, 10).forEach(t => {
      items.push({ id: `h-tbl-${t.id}`, type: 'table_booked', description: t.full_name || 'VIP', timestamp: t.created_at });
    });

    cloakroom.slice(0, 10).forEach(c => {
      items.push({ id: `h-clk-${c.id}`, type: 'cloakroom', description: `#${(c as any).cloakroom_number || ''}`, timestamp: c.created_at });
    });

    // Merge realtime items (deduplicate by checking if historical already covers it)
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
          .select('id, total_price, service_fee, insurance_fee, entry_scanned, entry_scanned_at, full_name, created_at, event_id')
          .eq('event_id', eventId)
          .eq('status', 'paid')
          .gte('created_at', start);
      } else {
        ticketsQuery = supabase
          .from('tickets')
          .select('id, total_price, service_fee, insurance_fee, entry_scanned, entry_scanned_at, full_name, created_at, event_id, events!inner(venue_id)')
          .eq('events.venue_id', venueId)
          .eq('status', 'paid')
          .gte('created_at', start);
      }

      const tablesQuery = supabase
        .from('table_reservations')
        .select('id, deposit, status, entry_scanned, entry_scanned_at, entry_scanned_by, full_name, created_at, zone_id, table_zones!inner(venue_id)')
        .eq('table_zones.venue_id', venueId)
        .gte('created_at', start);

      let cloakroomQuery = supabase
        .from('cloakroom_transactions')
        .select('id, created_at, cloakroom_number, staff_id')
        .eq('venue_id', venueId)
        .gte('created_at', start);
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

      // Entry flow (hourly)
      const hourMap = new Map<number, number>();
      [...scannedTickets, ...scannedTables].forEach(item => {
        const scannedAt = (item as any).entry_scanned_at;
        if (scannedAt) {
          const h = new Date(scannedAt).getHours();
          hourMap.set(h, (hourMap.get(h) || 0) + 1);
        }
      });
      setEntryFlow(Array.from({ length: 24 }, (_, i) => ({ hour: i, count: hourMap.get(i) || 0 })));

      // Staff activity
      const staffMap = new Map<string, { count: number; role: StaffMember['role'] }>();
      orders.filter(o => o.prep_claimed_by).forEach(o => {
        const entry = staffMap.get(o.prep_claimed_by!) || { count: 0, role: 'barman' as const };
        entry.count++;
        entry.role = 'barman';
        staffMap.set(o.prep_claimed_by!, entry);
      });
      [...scannedTickets, ...scannedTables].forEach(item => {
        const scannedBy = (item as any).entry_scanned_by;
        if (scannedBy) {
          const entry = staffMap.get(scannedBy) || { count: 0, role: 'bouncer' as const };
          entry.count++;
          entry.role = 'bouncer';
          staffMap.set(scannedBy, entry);
        }
      });
      cloakroom.forEach(c => {
        const staffId = (c as any).staff_id;
        if (staffId) {
          const entry = staffMap.get(staffId) || { count: 0, role: 'cloakroom' as const };
          entry.count++;
          entry.role = 'cloakroom';
          staffMap.set(staffId, entry);
        }
      });

      const staffList: StaffMember[] = Array.from(staffMap.entries()).map(([id, data]) => ({
        id, name: data.role === 'barman' ? 'Barman' : data.role === 'bouncer' ? 'Bouncer' : 'Vestiaire',
        role: data.role, processedCount: data.count, isActive: data.count > 0,
      }));
      if (staffList.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', staffList.map(s => s.id));
        if (profiles) {
          profiles.forEach(p => {
            const staff = staffList.find(s => s.id === p.id);
            if (staff) staff.name = [p.first_name, p.last_name].filter(Boolean).join(' ') || staff.name;
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
      setAlerts(newAlerts.filter(a => !dismissedAlertIds.current.has(a.id)));

    } catch (err) {
      console.error('Live night data fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [venueId, getTimeWindow, activeEvent, buildFeedFromData]);

  const dismissAlert = useCallback((id: string) => {
    dismissedAlertIds.current.add(id);
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  useEffect(() => {
    if (!venueId) return;

    fetchActiveEvent();
    fetchAllData();

    const orderChannel = supabase
      .channel('live-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `venue_id=eq.${venueId}` }, (payload) => {
        fetchAllData();
        if (payload.eventType === 'INSERT') {
          const o = payload.new as any;
          addRealtimeFeedItem({ type: 'order_created', description: `#${o.order_number || o.id.slice(0, 6)} — ${Number(o.total).toFixed(0)} €`, timestamp: o.created_at, actor: o.user_email });
        } else if (payload.eventType === 'UPDATE') {
          const o = payload.new as any;
          if (o.prep_status === 'ready') addRealtimeFeedItem({ type: 'order_ready', description: `#${o.order_number || o.id.slice(0, 6)}`, timestamp: new Date().toISOString() });
          if (o.status === 'served' || o.prep_status === 'served') addRealtimeFeedItem({ type: 'order_served', description: `#${o.order_number || o.id.slice(0, 6)}`, timestamp: o.served_at || new Date().toISOString() });
          if (o.refunded_at && !payload.old?.refunded_at) addRealtimeFeedItem({ type: 'refund', description: `#${o.order_number || o.id.slice(0, 6)} — ${Number(o.refund_amount || 0).toFixed(0)} €`, timestamp: o.refunded_at });
        }
      }).subscribe();

    const ticketChannel = supabase
      .channel('live-tickets')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets' }, (payload) => {
        const t = payload.new as any;
        if (t.entry_scanned && !payload.old?.entry_scanned) {
          addRealtimeFeedItem({ type: 'ticket_scanned', description: t.full_name || t.user_email || 'Guest', timestamp: t.entry_scanned_at || new Date().toISOString() });
          fetchAllData();
        }
      }).subscribe();

    const tableChannel = supabase
      .channel('live-tables')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_reservations' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          addRealtimeFeedItem({ type: 'table_booked', description: (payload.new as any).full_name || 'VIP', timestamp: (payload.new as any).created_at });
        }
        if (payload.eventType === 'UPDATE') {
          const r = payload.new as any;
          if (r.entry_scanned && !payload.old?.entry_scanned) {
            addRealtimeFeedItem({ type: 'vip_scanned', description: r.full_name || 'VIP', timestamp: r.entry_scanned_at || new Date().toISOString() });
          }
        }
        fetchAllData();
      }).subscribe();

    const cloakroomChannel = supabase
      .channel('live-cloakroom')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cloakroom_transactions', filter: `venue_id=eq.${venueId}` }, (payload) => {
        const c = payload.new as any;
        addRealtimeFeedItem({ type: 'cloakroom', description: `#${c.cloakroom_number || ''}`, timestamp: c.created_at });
        fetchAllData();
      }).subscribe();

    const pollMs = timeWindow === 'live' ? 10_000 : 30_000;
    const pollInterval = setInterval(fetchAllData, pollMs);

    return () => {
      supabase.removeChannel(orderChannel);
      supabase.removeChannel(ticketChannel);
      supabase.removeChannel(tableChannel);
      supabase.removeChannel(cloakroomChannel);
      clearInterval(pollInterval);
    };
  }, [venueId, fetchAllData, fetchActiveEvent, addRealtimeFeedItem, timeWindow]);

  useEffect(() => { fetchAllData(); }, [timeWindow, fetchAllData]);

  return {
    kpis, feed, alerts, pipeline, staffActivity, entryFlow, advancedMetrics,
    activeEvent, loading, isPaused, timeWindow,
    setIsPaused, setTimeWindow, dismissAlert,
  };
}
