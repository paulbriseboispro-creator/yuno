import { AppHeader } from '@/components/app-header';
import { DashboardSkeleton } from '@/components/DashboardSkeleton';
import { calcStripeFee, ticketRevenue } from '@/utils/fees';
import { useOwnerOnboarding } from '@/hooks/useOwnerOnboarding';
import { OnboardingSidebar } from '@/components/onboarding/OnboardingSidebar';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowRightIcon,
  Calendar,
  CalendarIcon,
  CalendarPlusIcon,
  ChevronRightIcon,
  CreditCard,
  Crown,
  Handshake,
  Minus,
  Radio,
  ScanLine,
  Sparkles,
  Store,
  Ticket,
  TrendingDownIcon,
  TrendingUpIcon,
  type LucideIcon,
  BarChart3Icon,
  QrCodeIcon,
  ShoppingCart,
  Wine,
  ZapIcon,
} from 'lucide-react';
import { startOfDay, subDays, format, formatDistanceToNow } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { GuestListRequestAlert } from '@/components/owner/guest-list/GuestListRequestAlert';
import { useLanguage } from '@/contexts/LanguageContext';
import { useState, useEffect, useMemo, useId } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { uniqueChannel } from '@/lib/realtime';
import { Order } from '@/types';
import { useOwnerVenue } from '@/hooks/useOwnerVenue';
import { useStripeConnect } from '@/hooks/useStripeConnect';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { UpgradeModal } from '@/components/UpgradeModal';
import { NextBestActionsCard } from '@/components/owner/NextBestActionsCard';
import { CollabActivateBanner } from '@/components/collab/CollabActivateBanner';
import { CollabWelcomeOverlay } from '@/components/collab/CollabWelcomeOverlay';
import { isCollabPlan } from '@/lib/planFeatures';
import type { FeatureKey } from '@/lib/planFeatures';
import { formatChartAxisTick } from '@/components/formater';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED       = '#E8192C';
const POS       = '#34D399';
const NEG       = '#FF5C63';
const T1        = 'rgba(255,255,255,0.96)';
const T2        = 'rgba(255,255,255,0.58)';
const T3        = 'rgba(255,255,255,0.36)';
const C_HI      = 'rgba(255,255,255,0.92)';
const C_FAINT   = 'rgba(255,255,255,0.06)';
const BORDER    = 'rgba(255,255,255,0.085)';
const F_BORDER  = 'rgba(255,255,255,0.055)';
const INNER_BG  = 'rgba(255,255,255,0.032)';
const TILE_BG   = 'rgba(255,255,255,0.025)';
const CARD_BG   = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function InlineDelta({ value }: { value: number }) {
  const isPos = value > 0.05;
  const isNeg = value < -0.05;
  const color = isPos ? POS : isNeg ? NEG : T3;
  const Icon = isPos ? TrendingUpIcon : isNeg ? TrendingDownIcon : Minus;
  return (
    <span style={{ color, display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
      <Icon style={{ width: 11, height: 11 }} />
      {isPos ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
}

function GhostLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      style={{ color: T3, fontSize: 11.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
    >
      {children}
    </Link>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
type PeriodDays = 7 | 14 | 30;

interface NextEvent {
  id: string;
  title: string;
  start_at: string;
  poster_url: string | null;
  location_city: string | null;
  max_tickets: number | null;
  venue_id: string | null;
  partner_venue_id: string | null;
  partner_organizer_id: string | null;
  organizer_user_id: string | null;
}

interface NextEventStats {
  ticketsSold: number;
  revenue: number;
  scanned: number;
  tablesBooked: number;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function OwnerDashboard() {
  const { t, language } = useLanguage();
  const { venueId, venue, loading: venueLoading } = useOwnerVenue();
  useStripeConnect(venueId);
  const { plan: currentPlan, isTrial, daysRemaining, status: subStatus, loading: planLoading } = useSubscriptionPlan();
  const { isComplete: onboardingComplete, loading: onbLoading, currentStep, stepStatuses } = useOwnerOnboarding(venueId);
  const [upgradeFeature, setUpgradeFeature] = useState<FeatureKey | null>(null);

  const [orders, setOrders] = useState<(Order & { serviceFee: number })[]>([]);
  const [tickets, setTickets] = useState<{ total_price: number; service_fee: number; insurance_fee: number; created_at: string; event_id: string | null }[]>([]);
  const [tableReservations, setTableReservations] = useState<{ deposit: number; created_at: string; event_id: string | null }[]>([]);
  const [visitors, setVisitors] = useState({ current: 0, previous: 0 });
  const [loading, setLoading] = useState(true);
  const [periodDays, setPeriodDays] = useState<PeriodDays>(30);
  const [nextEvent, setNextEvent] = useState<NextEvent | null>(null);
  const [nextStats, setNextStats] = useState<NextEventStats | null>(null);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  useEffect(() => {
    if (!venueId) return;
    fetchOrders();
    fetchTickets();
    fetchTables();
    fetchNextEvent();
    fetchVisitors();
    const channel = supabase
      .channel(uniqueChannel('owner-orders-changes'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `venue_id=eq.${venueId}` }, () => fetchOrders())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [venueId]);

  const fetchOrders = async () => {
    if (!venueId) return;
    try {
      const since = subDays(new Date(), 31).toISOString();
      const { data, error } = await supabase
        .from('orders').select('*, service_fee').eq('venue_id', venueId)
        .gte('created_at', since).order('created_at', { ascending: false });
      if (error) throw error;
      setOrders((data || []).map((o) => ({
        id: o.id, userEmail: o.user_email || undefined, venueId: o.venue_id,
        items: o.items as any, total: Number(o.total), serviceFee: Number(o.service_fee || 0),
        status: o.status as 'pending' | 'paid' | 'served', createdAt: o.created_at,
        paidAt: o.paid_at || undefined, servedAt: o.served_at || undefined,
        token: o.token || undefined, tokenUsed: o.token_used || undefined,
        tokenExpiresAt: o.token_expires_at || undefined, eventId: o.event_id || null,
      })) as any);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const fetchTickets = async () => {
    if (!venueId) return;
    try {
      const since = subDays(new Date(), 31).toISOString();
      const { data, error } = await supabase.from('tickets')
        .select('total_price, service_fee, insurance_fee, created_at, event_id, events!inner(venue_id)')
        .eq('events.venue_id', venueId).eq('status', 'paid').gte('created_at', since);
      if (error) throw error;
      setTickets((data || []).map((t: any) => ({
        total_price: Number(t.total_price), service_fee: Number(t.service_fee || 0),
        insurance_fee: Number(t.insurance_fee || 0), created_at: t.created_at, event_id: t.event_id ?? null,
      })));
    } catch (e) { console.error(e); }
  };

  const fetchTables = async () => {
    if (!venueId) return;
    try {
      const since = subDays(new Date(), 31).toISOString();
      const { data, error } = await supabase.from('table_reservations')
        .select('deposit, created_at, event_id, table_zones!inner(venue_id)')
        .eq('table_zones.venue_id', venueId).in('status', ['confirmed', 'paid']).gte('created_at', since);
      if (error) throw error;
      setTableReservations((data || []).map((r: any) => ({
        deposit: Number(r.deposit || 0), created_at: r.created_at, event_id: r.event_id ?? null,
      })));
    } catch (e) { console.error(e); }
  };

  const fetchVisitors = async () => {
    if (!venueId) return;
    try {
      const today = startOfDay(new Date());
      const { data } = await supabase.rpc('get_visitor_stats', {
        p_venue_id: venueId, p_start: subDays(today, 30).toISOString(), p_end: new Date().toISOString(),
        p_compare_start: subDays(today, 60).toISOString(), p_compare_end: subDays(today, 30).toISOString(),
      });
      const row = Array.isArray(data) ? data[0] : data;
      setVisitors({ current: Number(row?.current_visits ?? 0), previous: Number(row?.previous_visits ?? 0) });
    } catch (e) { console.error(e); }
  };

  const fetchNextEvent = async () => {
    if (!venueId) return;
    try {
      const { data } = await supabase.from('events')
        .select('id, title, start_at, poster_url, location_city, max_tickets, venue_id, partner_venue_id, partner_organizer_id, organizer_user_id')
        .or(`venue_id.eq.${venueId},partner_venue_id.eq.${venueId}`)
        .gte('end_at', new Date().toISOString()).order('start_at', { ascending: true }).limit(1);
      const next = data?.[0] as NextEvent | undefined;
      if (!next) { setNextEvent(null); setNextStats(null); return; }
      setNextEvent(next);
      const [tk, tr] = await Promise.all([
        supabase.from('tickets').select('total_price, service_fee, insurance_fee, quantity, entry_scanned').eq('event_id', next.id).eq('status', 'paid'),
        supabase.from('table_reservations').select('id', { count: 'exact', head: true }).eq('event_id', next.id).in('status', ['confirmed', 'paid']),
      ]);
      const tk2 = (tk.data || []) as any[];
      setNextStats({
        ticketsSold: tk2.reduce((s, x) => s + (x.quantity || 1), 0),
        // Club revenue excludes Yuno fees (service + insurance), never counts Yuno's cut.
        revenue: tk2.reduce((s, x) => s + ticketRevenue(x).gross, 0),
        scanned: tk2.filter((x) => x.entry_scanned).length,
        tablesBooked: tr.count ?? 0,
      });
    } catch (e) { console.error(e); }
  };

  // ── Derived data ─────────────────────────────────────────────────────────────
  const netRevenue = (item: { total?: number; serviceFee?: number; total_price?: number; service_fee?: number; insurance_fee?: number; deposit?: number }) => {
    if ('total' in item && item.total !== undefined) return item.total! - (item.serviceFee || 0) - calcStripeFee(item.total!);
    if ('total_price' in item && item.total_price !== undefined) return item.total_price! - (item.service_fee || 0) - (item.insurance_fee || 0) - calcStripeFee(item.total_price!);
    if ('deposit' in item && item.deposit !== undefined) return item.deposit! - calcStripeFee(item.deposit!);
    return 0;
  };

  const dailyRevenue = useMemo(() => {
    const byDate = new Map<string, number>();
    orders.filter(o => o.status === 'paid' || o.status === 'served').forEach(o => {
      const d = o.createdAt.slice(0, 10);
      byDate.set(d, (byDate.get(d) || 0) + netRevenue(o));
    });
    tickets.forEach(t => {
      const d = t.created_at.slice(0, 10);
      byDate.set(d, (byDate.get(d) || 0) + netRevenue(t));
    });
    tableReservations.forEach(r => {
      const d = r.created_at.slice(0, 10);
      byDate.set(d, (byDate.get(d) || 0) + netRevenue(r));
    });
    return Array.from({ length: 31 }, (_, i) => {
      const date = format(subDays(new Date(), 30 - i), 'yyyy-MM-dd');
      return { date, revenue: Math.max(0, byDate.get(date) || 0) };
    });
  }, [orders, tickets, tableReservations]);

  const dailyActivity = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = format(subDays(new Date(), 6 - i), 'yyyy-MM-dd');
    const count = orders.filter(o => (o.status === 'paid' || o.status === 'served') && o.createdAt.startsWith(d)).length
      + tickets.filter(t => t.created_at.startsWith(d)).length
      + tableReservations.filter(r => r.created_at.startsWith(d)).length;
    return { day: format(subDays(new Date(), 6 - i), 'EEE'), orders: count };
  }), [orders, tickets, tableReservations]);

  const revenueMix = useMemo(() => {
    const barRev = orders.filter(o => o.status === 'paid' || o.status === 'served').reduce((s, o) => s + netRevenue(o), 0);
    const tkRev = tickets.reduce((s, t) => s + netRevenue(t), 0);
    const tbRev = tableReservations.reduce((s, r) => s + netRevenue(r), 0);
    const total = barRev + tkRev + tbRev;
    if (total === 0) return [
      { category: 'Bar', share: 33 }, { category: t('owner.dash.tickets'), share: 34 }, { category: 'Tables VIP', share: 33 },
    ];
    return [
      { category: 'Bar', share: Math.round((barRev / total) * 100) },
      { category: t('owner.dash.tickets'), share: Math.round((tkRev / total) * 100) },
      { category: 'Tables VIP', share: Math.round((tbRev / total) * 100) },
    ].filter(x => x.share > 0);
  }, [orders, tickets, tableReservations, language]);

  const metrics = useMemo(() => {
    const since = subDays(new Date(), periodDays);
    const prevSince = subDays(new Date(), periodDays * 2);
    const inPeriod = (d: string, s: Date, e: Date) => { const dt = new Date(d); return dt >= s && dt <= e; };
    const curOrders = orders.filter(o => (o.status === 'paid' || o.status === 'served') && inPeriod(o.createdAt, since, new Date()));
    const prevOrders = orders.filter(o => (o.status === 'paid' || o.status === 'served') && inPeriod(o.createdAt, prevSince, since));
    const curTickets = tickets.filter(t => inPeriod(t.created_at, since, new Date()));
    const prevTickets = tickets.filter(t => inPeriod(t.created_at, prevSince, since));
    const curTables = tableReservations.filter(r => inPeriod(r.created_at, since, new Date()));
    const prevTables = tableReservations.filter(r => inPeriod(r.created_at, prevSince, since));
    const curSales = [...curOrders.map(netRevenue), ...curTickets.map(netRevenue), ...curTables.map(netRevenue)].reduce((s, v) => s + v, 0);
    const prevSales = [...prevOrders.map(netRevenue), ...prevTickets.map(netRevenue), ...prevTables.map(netRevenue)].reduce((s, v) => s + v, 0);
    const curCount = curOrders.length + curTickets.length + curTables.length;
    const prevCount = prevOrders.length + prevTickets.length + prevTables.length;
    const curVisits = visitors.current;
    const prevVisits = visitors.previous;
    const curConv = curVisits > 0 ? (curCount / curVisits) * 100 : 0;
    const prevConv = prevVisits > 0 ? (prevCount / prevVisits) * 100 : 0;
    const calcChange = (c: number, p: number) => p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100;
    return {
      sales: { value: curSales, change: calcChange(curSales, prevSales) },
      orders: { value: curCount, change: calcChange(curCount, prevCount) },
      visits: { value: curVisits, change: calcChange(curVisits, prevVisits) },
      conversion: { value: curConv, change: curConv - prevConv },
    };
  }, [orders, tickets, tableReservations, visitors, periodDays]);

  const chartRows = useMemo(() => dailyRevenue.slice(-periodDays), [dailyRevenue, periodDays]);
  const growthPct = useMemo(() => {
    const first = chartRows[0]?.revenue ?? 0;
    const last = chartRows.at(-1)?.revenue ?? first;
    return first === 0 ? 0 : ((last - first) / first) * 100;
  }, [chartRows]);

  const hintLabel = t('owner.dash.vsPriorDays').replace('{days}', String(periodDays));

  if (loading || venueLoading) return <DashboardSkeleton />;

  if (!venueId) {
    return (
      <div style={{ padding: '16px 24px', minHeight: '100vh', background: '#000' }}>
        <AppHeader />
        <div className="flex h-[60vh] items-center justify-center">
          <p style={{ color: T3 }}>{t('owner.noVenueAssigned')}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', minHeight: '100vh', background: '#000' }}>
      <AppHeader />
      <UpgradeModal
        open={upgradeFeature !== null}
        onOpenChange={(o) => !o && setUpgradeFeature(null)}
        feature={upgradeFeature || 'vip_tables'}
      />

      <div className="space-y-4 pb-10">

        {/* ─── Venue Hero ───────────────────────────────────────────────────────── */}
        {venue && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative -mx-4 -mt-4 overflow-hidden"
            style={{ height: 256, borderRadius: '0 0 26px 26px' }}
          >

            {/* ── Layer 1 : fond ─────────────────────────────────────────── */}
            {venue.coverUrl ? (
              <img
                src={venue.coverUrl}
                alt={venue.name}
                className="absolute inset-0 h-full w-full object-cover object-center"
                style={{ filter: 'brightness(0.5) saturate(1.35)' }}
              />
            ) : (
              <>
                {/* Base gradient (DS §3.5) */}
                <div
                  className="absolute inset-0"
                  style={{
                    background: `radial-gradient(ellipse 90% 70% at 80% -10%, rgba(232,25,44,0.24) 0%, transparent 58%),
                                 radial-gradient(ellipse 70% 55% at 5% 110%, rgba(232,25,44,0.14) 0%, transparent 52%),
                                 linear-gradient(155deg, #130508 0%, #0a0a0c 50%, #0c0a12 100%)`,
                  }}
                />
                {/* Glow blobs */}
                <div
                  className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full"
                  style={{ background: 'rgba(232,25,44,0.16)', filter: 'blur(80px)' }}
                />
                <div
                  className="pointer-events-none absolute -bottom-28 left-2 w-64 h-64 rounded-full"
                  style={{ background: 'rgba(232,25,44,0.09)', filter: 'blur(72px)' }}
                />
              </>
            )}

            {/* ── Layer 2 : overlay cinématique ──────────────────────────── */}
            <div
              className="absolute inset-0"
              style={{
                background: venue.coverUrl
                  ? 'linear-gradient(to top, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.52) 38%, rgba(0,0,0,0.04) 100%)'
                  : 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.18) 65%, transparent 100%)',
              }}
            />

            {/* ── Layer 3 : contenu ──────────────────────────────────────── */}
            <div className="relative flex h-full flex-col justify-end gap-0 px-4 pb-5">

              {/* Venue identity */}
              <div className="flex items-end justify-between gap-3">

                {/* Logo + nom + ville */}
                <div className="flex items-end gap-3.5 min-w-0">
                  {venue.logoUrl ? (
                    <img
                      src={venue.logoUrl}
                      alt=""
                      className="h-[58px] w-[58px] rounded-2xl object-cover flex-shrink-0"
                      style={{
                        border: '1.5px solid rgba(255,255,255,0.18)',
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.55), 0 10px 32px -6px rgba(0,0,0,0.95)',
                      }}
                    />
                  ) : (
                    <div
                      className="flex h-[58px] w-[58px] items-center justify-center rounded-2xl flex-shrink-0"
                      style={{
                        background: 'linear-gradient(135deg, rgba(232,25,44,0.22) 0%, rgba(232,25,44,0.06) 100%)',
                        border: '1.5px solid rgba(232,25,44,0.32)',
                        boxShadow: '0 0 0 1px rgba(0,0,0,0.55), 0 10px 32px -6px rgba(0,0,0,0.95)',
                      }}
                    >
                      <Store className="h-6 w-6" style={{ color: RED }} />
                    </div>
                  )}

                  <div className="min-w-0 pb-0.5">
                    <div
                      className="truncate"
                      style={{
                        color: T1,
                        fontSize: 23,
                        fontWeight: 700,
                        lineHeight: 1.15,
                        letterSpacing: '-0.5px',
                        textShadow: '0 2px 20px rgba(0,0,0,0.95)',
                      }}
                    >
                      {venue.name}
                    </div>
                    {venue.city && (
                      <div
                        style={{
                          color: T3,
                          fontSize: 13,
                          fontWeight: 500,
                          marginTop: 4,
                          letterSpacing: '0.1px',
                        }}
                      >
                        {venue.city}
                      </div>
                    )}
                  </div>
                </div>

                {/* Mini card : prochain event ou stats ce soir */}
                {nextEvent && nextStats && (() => {
                  const evDate = new Date(nextEvent.start_at);
                  const isToday = evDate.toDateString() === new Date().toDateString();
                  return (
                    <div
                      className="flex-shrink-0 rounded-2xl px-3.5 py-3"
                      style={{
                        background: isToday
                          ? 'rgba(232,25,44,0.13)'
                          : 'rgba(255,255,255,0.04)',
                        border: isToday
                          ? '1px solid rgba(232,25,44,0.3)'
                          : `1px solid ${BORDER}`,
                        backdropFilter: 'blur(20px)',
                        minWidth: 100,
                      }}
                    >
                      {/* Etiquette */}
                      <div className="flex items-center gap-1.5 mb-2">
                        {isToday && (
                          <span
                            className="h-1.5 w-1.5 rounded-full animate-pulse"
                            style={{ background: RED, boxShadow: `0 0 6px ${RED}` }}
                          />
                        )}
                        <span
                          style={{
                            color: isToday ? RED : T3,
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                          }}
                        >
                          {isToday ? t('owner.dash.tonight') : t('owner.dash.next')}
                        </span>
                      </div>
                      {/* Chiffre principal */}
                      <div
                        className="tabular-nums"
                        style={{
                          color: T1,
                          fontSize: 22,
                          fontWeight: 700,
                          letterSpacing: '-0.03em',
                          lineHeight: 1,
                        }}
                      >
                        {isToday
                          ? nextStats.ticketsSold
                          : format(evDate, 'd MMM', { locale: dateLocale })}
                      </div>
                      {/* Sous-label */}
                      <div style={{ color: T3, fontSize: 10.5, marginTop: 4, fontWeight: 500, lineHeight: 1.3 }}>
                        {isToday
                          ? t('owner.dash.ticketsSoldLower')
                          : (nextEvent.title.length > 16 ? nextEvent.title.slice(0, 16) + '…' : nextEvent.title)}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </motion.div>
        )}

        {/* Onboarding */}
        {!onbLoading && !onboardingComplete && (
          <OnboardingSidebar currentStep={currentStep} stepStatuses={stepStatuses} />
        )}

        {/* Demandes d'allocation guest list en attente (co-soirées dont on tient
            l'opérationnel). Ne s'affiche que s'il y en a. */}
        <GuestListRequestAlert />

        {/* Plan banners */}
        {isTrial && daysRemaining !== null && (
          <Link to="/owner/billing" className="block" style={{ textDecoration: 'none' }}>
            <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.22)' }}>
              <div className="flex items-center gap-3">
                <Sparkles className="h-4 w-4" style={{ color: POS }} />
                <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('plan.trialActive').replace('{days}', String(daysRemaining))}</span>
              </div>
              <span style={{ color: T3, fontSize: 11.5 }}>{t('plan.billing')} →</span>
            </div>
          </Link>
        )}
        {subStatus === 'past_due' && (
          <Link to="/owner/billing" className="block" style={{ textDecoration: 'none' }}>
            <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(255,92,99,0.06)', border: '1px solid rgba(255,92,99,0.22)' }}>
              <div className="flex items-center gap-3">
                <CreditCard className="h-4 w-4" style={{ color: NEG }} />
                <span style={{ color: T1, fontSize: 13.5, fontWeight: 560 }}>{t('plan.paymentPending')}</span>
              </div>
              <span style={{ color: T3, fontSize: 11.5 }}>{t('plan.resolvePayment')} →</span>
            </div>
          </Link>
        )}
        {!planLoading && isCollabPlan(currentPlan) && <CollabActivateBanner />}
        <CollabWelcomeOverlay venueId={venueId} venueName={venue?.name} />
        {currentPlan === 'core' && !planLoading && (
          <Link to="/owner/billing" className="block" style={{ textDecoration: 'none' }}>
            <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: 'rgba(232,25,44,0.06)', border: '1px solid rgba(232,25,44,0.22)' }}>
              <div className="flex items-center gap-3">
                <Crown className="h-4 w-4" style={{ color: RED }} />
                <div>
                  <span style={{ color: T1, fontSize: 13.5, fontWeight: 560, display: 'block' }}>{t('plan.coreBanner')}</span>
                  <span style={{ color: T3, fontSize: 11 }}>{t('plan.upgradeFullExperience')}</span>
                </div>
              </div>
              <span style={{ color: RED, fontSize: 12, fontWeight: 600 }}>{t('plan.upgrade')} →</span>
            </div>
          </Link>
        )}

        {/* ─── À faire aujourd'hui (next-best-action IA) ─── */}
        <NextBestActionsCard />

        {/* Dashboard grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">

          {/* KPI stat cards */}
          {([
            { label: t('owner.dash.netSales'), value: `${metrics.sales.value.toFixed(0)} €`, delta: metrics.sales.change },
            { label: t('owner.dash.ordersKpi'), value: String(metrics.orders.value), delta: metrics.orders.change },
            { label: t('owner.dash.visitors'), value: String(metrics.visits.value), delta: metrics.visits.change },
            { label: t('owner.dash.conversion'), value: `${metrics.conversion.value.toFixed(2)}%`, delta: metrics.conversion.change },
          ] as const).map((kpi, i) => (
            <motion.div key={kpi.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
              <YunoStatCard label={kpi.label} value={kpi.value} delta={kpi.delta} hint={hintLabel} />
            </motion.div>
          ))}

          {/* Revenue chart — full width */}
          <motion.div className="md:col-span-2 lg:col-span-4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
            <YunoRevenueChart
              rows={chartRows}
              periodDays={periodDays}
              onPeriodChange={setPeriodDays}
              growthPct={growthPct}
              t={t}
            />
          </motion.div>

          {/* Next event hero — full width */}
          <motion.div className="md:col-span-2 lg:col-span-4" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.34 }}>
            <NextEventHero
              nextEvent={nextEvent}
              stats={nextStats}
              dateLocale={dateLocale}
              t={t}
              venueId={venueId}
            />
          </motion.div>

          {/* Daily activity chart */}
          <motion.div className="md:col-span-2" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <YunoDailyActivity data={dailyActivity} t={t} />
          </motion.div>

          {/* Revenue mix donut */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.46 }}>
            <YunoRevenueMix data={revenueMix} t={t} />
          </motion.div>

          {/* Quick actions */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.52 }}>
            <YunoQuickActions t={t} />
          </motion.div>

        </div>
      </div>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function YunoStatCard({ label, value, delta, hint }: { label: string; value: string; delta: number; hint: string }) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', height: '100%' }}>
      <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>{label}</p>
      <p className="tabular-nums" style={{ color: T1, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em', marginBottom: 12 }}>{value}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <InlineDelta value={delta} />
        <span style={{ color: T3, fontSize: 11 }}>{hint}</span>
      </div>
    </div>
  );
}

// ─── Revenue chart ────────────────────────────────────────────────────────────
const xAxisInterval: Record<PeriodDays, number> = { 7: 0, 14: 1, 30: 3 };

function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
      <p style={{ color: T3, fontSize: 11, marginBottom: 4 }}>{String(label)}</p>
      <p className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{Number(payload[0].value).toFixed(0)} €</p>
    </div>
  );
}

function YunoRevenueChart({
  rows, periodDays, onPeriodChange, growthPct, t,
}: {
  rows: { date: string; revenue: number }[];
  periodDays: PeriodDays;
  onPeriodChange: (p: PeriodDays) => void;
  growthPct: number;
  t: (k: string) => string;
}) {
  const uid = useId().replace(/:/g, '');
  const gradId = `rev-grad-${uid}`;
  const minTickGap = periodDays <= 7 ? undefined : Math.max(8, Math.min(52, Math.floor(periodDays / 2)));
  const periodLabels: Record<PeriodDays, string> = {
    7: t('owner.dash.period7'),
    14: t('owner.dash.period14'),
    30: t('owner.dash.period30'),
  };

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden' }}>
      <div className="flex items-center justify-between mb-4">
        <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
          {t('owner.dash.revenue')}
        </h3>
        {/* Period segmented control */}
        <div style={{ display: 'flex', background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 3, gap: 2 }}>
          {([7, 14, 30] as PeriodDays[]).map(d => (
            <button
              key={d}
              onClick={() => onPeriodChange(d)}
              className="cursor-pointer transition-all duration-150"
              style={{
                padding: '4px 10px',
                borderRadius: 7,
                border: 'none',
                fontSize: 11.5,
                fontWeight: 600,
                background: periodDays === d ? 'rgba(255,255,255,0.10)' : 'transparent',
                color: periodDays === d ? T1 : T3,
              }}
            >
              {periodLabels[d]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={RED} stopOpacity={0.28} />
                <stop offset="100%" stopColor={RED} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid horizontal={false} strokeDasharray="2 2" stroke="rgba(255,255,255,0.055)" />
            <XAxis
              axisLine={false}
              dataKey="date"
              interval={xAxisInterval[periodDays]}
              minTickGap={minTickGap}
              tickFormatter={(v) => formatChartAxisTick(String(v), periodDays)}
              tickLine={false}
              tickMargin={8}
              tick={{ fill: 'rgba(255,255,255,0.36)', fontSize: 10.5 }}
            />
            <YAxis hide />
            <Tooltip content={<RevenueTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
            <Area dataKey="revenue" dot={false} fill={`url(#${gradId})`} stroke={RED} strokeWidth={2} type="monotone" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-2">
          <InlineDelta value={growthPct} />
          <span style={{ color: T3, fontSize: 11 }}>
            {t('owner.dash.vsFirstDayPeriod').replace('{days}', String(periodDays))}
          </span>
        </div>
        <GhostLink to="/owner/analytics">
          {t('owner.dash.viewAnalytics')}
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </GhostLink>
      </div>
    </div>
  );
}

// ─── Daily activity chart ─────────────────────────────────────────────────────
function ActivityTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
      <p style={{ color: T3, fontSize: 11, marginBottom: 4 }}>{String(label)}</p>
      <p className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{payload[0].value}</p>
    </div>
  );
}

function YunoDailyActivity({ data, t }: { data: { day: string; orders: number }[]; t: (k: string) => string }) {
  const first = data[0]?.orders ?? 0;
  const last = data.at(-1)?.orders ?? first;
  const trendPct = first > 0 ? ((last - first) / first) * 100 : 0;
  const total = data.reduce((s, d) => s + d.orders, 0);

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden', height: '100%' }}>
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
            {t('owner.dash.dailyActivity')}
          </h3>
          <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{t('owner.dash.last7days')}</p>
        </div>
        <div className="text-right">
          <p className="tabular-nums" style={{ color: T1, fontSize: 20, fontWeight: 640, letterSpacing: '-0.02em' }}>{total}</p>
          <p style={{ color: T3, fontSize: 11 }}>{t('owner.dash.ordersLower')}</p>
        </div>
      </div>

      <div style={{ width: '100%', height: 196, marginTop: 12 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="rgba(255,255,255,0.055)" />
            <XAxis axisLine={false} dataKey="day" interval={0} tickLine={false} tickMargin={8} tick={{ fill: 'rgba(255,255,255,0.36)', fontSize: 10.5 }} />
            <YAxis hide />
            <Tooltip content={<ActivityTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
            <Line dataKey="orders" dot={false} stroke={C_HI} strokeWidth={2.5} type="monotone" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-2">
          <InlineDelta value={trendPct} />
          <span style={{ color: T3, fontSize: 11 }}>{t('owner.dash.vsFirstDay7')}</span>
        </div>
        <GhostLink to="/owner/orders">
          {t('owner.dash.allOrders')}
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </GhostLink>
      </div>
    </div>
  );
}

// ─── Revenue mix donut ────────────────────────────────────────────────────────
const PIE_PALETTE = [RED, '#F59E0B', '#818CF8'] as const;

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
      <p style={{ color: T2, fontSize: 12, marginBottom: 2 }}>{payload[0].name}</p>
      <p className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{payload[0].value}%</p>
    </div>
  );
}

function YunoRevenueMix({ data, t }: { data: { category: string; share: number }[]; t: (k: string) => string }) {
  const pieData = data.map((row, i) => ({
    name: row.category, share: row.share, fill: PIE_PALETTE[i % PIE_PALETTE.length],
  }));

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden', height: '100%' }}>
      <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 4 }}>
        {t('owner.dash.revenueMix')}
      </h3>
      <p style={{ color: T3, fontSize: 11.5, marginBottom: 16 }}>{t('owner.dash.last30days')}</p>

      <div style={{ width: '100%', height: 196 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="share"
              nameKey="name"
              innerRadius={44}
              outerRadius="82%"
              cornerRadius={3}
              strokeWidth={3}
              stroke="#000"
            >
              {pieData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
              <LabelList
                dataKey="share"
                position="inside"
                style={{ fill: 'rgba(0,0,0,0.8)', fontWeight: 600, fontSize: 11 }}
                formatter={(label: any) => {
                  const n = Number(label);
                  return Number.isFinite(n) && n > 6 ? `${n}%` : '';
                }}
                stroke="none"
              />
            </Pie>
            <Tooltip content={<PieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-3 mt-2">
        {pieData.map(item => (
          <span key={item.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: T2, fontSize: 11.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.fill, flexShrink: 0, display: 'inline-block' }} />
            {item.name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Quick actions ────────────────────────────────────────────────────────────
function YunoQuickActions({ t }: { t: (k: string) => string }) {
  const actions = [
    { title: t('owner.dash.createEvent'), description: t('owner.dash.createEventDesc'), to: '/owner/events', Icon: CalendarPlusIcon },
    { title: t('owner.dash.startLiveNight'), description: t('owner.dash.startLiveNightDesc'), to: '/owner/live', Icon: ZapIcon },
    { title: t('owner.dash.scanTickets'), description: t('owner.dash.scanTicketsDesc'), to: '/owner/staff', Icon: QrCodeIcon },
    { title: t('owner.dash.viewAnalyticsAction'), description: t('owner.dash.viewAnalyticsActionDesc'), to: '/owner/analytics', Icon: BarChart3Icon },
  ];

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '20px 22px', overflow: 'hidden', height: '100%' }}>
      <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', marginBottom: 4 }}>
        {t('owner.dash.quickActions')}
      </h3>
      <p style={{ color: T3, fontSize: 11.5, marginBottom: 14 }}>
        {t('owner.dash.quickActionsSub')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {actions.map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className="flex items-center gap-3 rounded-xl cursor-pointer transition-all duration-150"
            style={{ padding: '10px 12px', textDecoration: 'none', background: TILE_BG, border: `1px solid ${F_BORDER}` }}
          >
            <div className="flex-none h-8 w-8 flex items-center justify-center rounded-lg"
              style={{ background: C_FAINT, border: `1px solid ${F_BORDER}` }}>
              <a.Icon className="h-4 w-4" style={{ color: T2 }} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ color: T1, fontSize: 13, fontWeight: 560 }}>{a.title}</p>
              <p className="truncate" style={{ color: T3, fontSize: 11, marginTop: 1 }}>{a.description}</p>
            </div>
            <ChevronRightIcon className="h-4 w-4 flex-none" style={{ color: T3 }} />
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Next event hero ──────────────────────────────────────────────────────────
function NextEventHero({
  nextEvent, stats, dateLocale, t, venueId,
}: {
  nextEvent: NextEvent | null;
  stats: NextEventStats | null;
  dateLocale: any;
  t: (k: string) => string;
  venueId: string | null;
}) {
  const isCollab = !!nextEvent && (
    !!nextEvent.partner_organizer_id || !!nextEvent.partner_venue_id ||
    (!!nextEvent.venue_id && nextEvent.venue_id !== venueId)
  );
  const manageHref = nextEvent ? (isCollab ? `/owner/collab/event/${nextEvent.id}` : '/owner/events') : '/owner/events';
  const liveHref = nextEvent && isCollab ? `/owner/collab/event/${nextEvent.id}?tab=live` : '/owner/live';

  if (!nextEvent) {
    return (
      <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '40px 22px', overflow: 'hidden', textAlign: 'center' }}>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: C_FAINT, border: `1px solid ${BORDER}` }}>
          <Calendar className="h-6 w-6" style={{ color: T3 }} />
        </div>
        <h3 style={{ color: T1, fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t('owner.noUpcomingEvent')}</h3>
        <p style={{ color: T3, fontSize: 13, marginBottom: 20 }}>{t('owner.createFirstEvent')}</p>
        <Link
          to="/owner/events"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 12, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.30)', color: RED, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
        >
          {t('owner.dash.createEvent')}
        </Link>
      </div>
    );
  }

  const fillRate = nextEvent.max_tickets && nextEvent.max_tickets > 0 && stats
    ? Math.min(100, Math.round((stats.ticketsSold / nextEvent.max_tickets) * 100)) : null;
  const checkinRate = stats && stats.ticketsSold > 0 ? Math.round((stats.scanned / stats.ticketsSold) * 100) : 0;
  const poster = nextEvent.poster_url;

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
      <div className="grid md:grid-cols-[260px_1fr]">
        {/* Poster */}
        <div className="relative h-44 md:h-full min-h-[160px]" style={{ background: INNER_BG }}>
          {poster ? (
            <img src={poster} alt={nextEvent.title} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center" style={{ color: T3 }}>
              <Sparkles className="h-12 w-12" />
            </div>
          )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 60%)' }} />
          <span className="absolute top-3 left-3 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider backdrop-blur"
            style={{ background: 'rgba(0,0,0,0.75)', border: `1px solid ${BORDER}`, color: T2 }}>
            {t('owner.nextEvent')}
          </span>
          {isCollab && (
            <span className="absolute top-3 right-3 flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold backdrop-blur"
              style={{ background: 'rgba(232,25,44,0.20)', color: RED }}>
              <Handshake className="h-2.5 w-2.5" /> Collab
            </span>
          )}
        </div>

        {/* Details */}
        <div style={{ padding: '20px 22px' }} className="space-y-4">
          <div>
            <h2 style={{ color: T1, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>{nextEvent.title}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="flex items-center gap-1" style={{ color: T3, fontSize: 12 }}>
                <CalendarIcon className="h-3 w-3" />
                {format(new Date(nextEvent.start_at), 'PPP p', { locale: dateLocale })}
              </span>
              {nextEvent.location_city && <span style={{ color: T3, fontSize: 12 }}>· {nextEvent.location_city}</span>}
            </div>
            <p style={{ color: RED, fontSize: 12, fontWeight: 600, marginTop: 4 }}>
              {t('owner.dash.in')} {formatDistanceToNow(new Date(nextEvent.start_at), { locale: dateLocale })}
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <EventMiniStat icon={Ticket} label={t('owner.dash.sold')} value={stats?.ticketsSold ?? 0} sub={fillRate !== null ? `${fillRate}%` : undefined} />
            <EventMiniStat icon={ShoppingCart} label={t('owner.dash.revenueShort')} value={`${(stats?.revenue ?? 0).toFixed(0)} €`} />
            <EventMiniStat icon={ScanLine} label="Scans" value={`${checkinRate}%`} sub={`${stats?.scanned ?? 0}/${stats?.ticketsSold ?? 0}`} />
            <EventMiniStat icon={Wine} label="Tables" value={stats?.tablesBooked ?? 0} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to={manageHref}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: 'rgba(232,25,44,0.12)', border: '1px solid rgba(232,25,44,0.30)', color: RED, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
            >
              {t('owner.manage')}
            </Link>
            <Link
              to={liveHref}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
            >
              <Radio className="h-3.5 w-3.5" />{t('owner.live')}
            </Link>
            <Link
              to="/owner/staff"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 10, background: INNER_BG, border: `1px solid ${BORDER}`, color: T2, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
            >
              <ScanLine className="h-3.5 w-3.5" />{t('owner.checkin')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventMiniStat({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: number | string; sub?: string }) {
  return (
    <div style={{ background: TILE_BG, border: `1px solid ${F_BORDER}`, borderRadius: 10, padding: '10px 10px 9px' }}>
      <div className="flex items-center justify-between mb-1">
        <span style={{ color: T3, fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        <Icon className="h-3 w-3" style={{ color: RED }} />
      </div>
      <div className="tabular-nums" style={{ color: T1, fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{value}</div>
      {sub && <div style={{ color: T3, fontSize: 9.5, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
