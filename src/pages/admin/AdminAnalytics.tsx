import { useState, useEffect, useId } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { orderRevenue as orderClub, ticketRevenue as ticketClub, tableRevenue as tableClub } from '@/utils/fees';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';
import { motion } from 'framer-motion';
import { DollarSign, Zap, Activity, TrendingUp, Ticket, Crown, ShoppingBag, CreditCard, BarChart3, Building2, type LucideIcon } from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const C_FAINT    = 'rgba(255,255,255,0.06)';
const C_HI       = 'rgba(255,255,255,0.92)';
const C_MID      = 'rgba(255,255,255,0.40)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

// Donut / multi-series palette: lead with RED, then muted secondaries
const PIE_PALETTE = [RED, '#F59E0B', '#818CF8'] as const;
const AXIS_TICK = { fill: 'rgba(255,255,255,0.36)', fontSize: 10.5 } as const;

interface Venue { id: string; name: string; }

// ─── Card primitives ──────────────────────────────────────────────────────────
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={className}
      style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: 22, overflow: 'hidden' }}
    >
      {children}
    </div>
  );
}

function CardTitle({ icon: Icon, children, sub }: { icon: LucideIcon; children: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl flex-none" style={{ background: C_FAINT, border: `1px solid ${BORDER}`, color: T2 }}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h3 style={{ color: T1, fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>{children}</h3>
        {sub && <p style={{ color: T3, fontSize: 11.5, marginTop: 2 }}>{sub}</p>}
      </div>
    </div>
  );
}

// ─── KPI stat card ──────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, highlight, tone }: { label: string; value: string | number; icon: LucideIcon; highlight?: boolean; tone?: 'pos' }) {
  const valueColor = tone === 'pos' ? POS : highlight ? RED : T1;
  return (
    <div
      style={{
        background: highlight ? 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.035)),#0a0a0c' : CARD_BG,
        border: `1px solid ${highlight ? 'rgba(232,25,44,0.24)' : BORDER}`,
        borderRadius: 16, boxShadow: CARD_SHADOW, padding: '16px 18px', height: '100%',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</p>
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg flex-none"
          style={{ background: highlight ? 'rgba(232,25,44,0.12)' : C_FAINT, border: `1px solid ${highlight ? 'rgba(232,25,44,0.2)' : F_BORDER}` }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: highlight ? RED : T2 }} />
        </div>
      </div>
      <p className="tabular-nums" style={{ color: valueColor, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em', lineHeight: 1 }}>{value}</p>
    </div>
  );
}

// ─── Dark chart tooltips ──────────────────────────────────────────────────────
interface TooltipEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
  stroke?: string;
  fill?: string;
}
interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}

function MoneyTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
      {label !== undefined && <p style={{ color: T3, fontSize: 11, marginBottom: 4 }}>{String(label)}</p>}
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || p.stroke || p.fill, flexShrink: 0, display: 'inline-block' }} />
          <span style={{ color: T2, fontWeight: 400 }}>{p.name}</span>
          {Number(p.value).toFixed(2)}€
        </p>
      ))}
    </div>
  );
}

function CountTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
      {label !== undefined && <p style={{ color: T3, fontSize: 11, marginBottom: 4 }}>{String(label)}</p>}
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums" style={{ color: T1, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || p.fill, flexShrink: 0, display: 'inline-block' }} />
          <span style={{ color: T2, fontWeight: 400 }}>{p.name}</span>
          {p.value}
        </p>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0a0a0c', border: `1px solid ${BORDER}`, borderRadius: 10, padding: '10px 14px' }}>
      <p style={{ color: T2, fontSize: 12, marginBottom: 2 }}>{payload[0].name}</p>
      <p className="tabular-nums" style={{ color: T1, fontSize: 14, fontWeight: 640 }}>{Number(payload[0].value).toFixed(2)}€</p>
    </div>
  );
}

// ─── Chart legend (shared dark style) ─────────────────────────────────────────
function ChartLegend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-3 mt-3">
      {items.map(item => (
        <span key={item.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: T2, fontSize: 11.5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0, display: 'inline-block' }} />
          {item.name}
        </span>
      ))}
    </div>
  );
}

export default function AdminAnalytics() {
  const { t } = useLanguage();
  const uid = useId().replace(/:/g, '');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selectedVenue, setSelectedVenue] = useState<string>('all');
  const [period, setPeriod] = useState<string>('30');
  const [loading, setLoading] = useState(true);
  const [dailyData, setDailyData] = useState<{ date: string; drinks: number; tickets: number; tables: number; total: number; drinkOrders: number; ticketOrders: number; tableOrders: number }[]>([]);
  const [venueComparison, setVenueComparison] = useState<{ name: string; revenue: number }[]>([]);
  const [conversionData, setConversionData] = useState<{ name: string; value: number }[]>([]);
  const [pieData, setPieData] = useState<{ name: string; value: number }[]>([]);
  const [kpiData, setKpiData] = useState({ totalRevenue: 0, yunoRevenue: 0, totalTransactions: 0, conversionRate: '0', ticketsSold: 0, tablesBooked: 0, avgOrder: 0, activeSubscriptions: 0 });

  useEffect(() => { fetchVenues(); }, []);
  useEffect(() => { if (venues.length >= 0) fetchAnalytics(); }, [selectedVenue, period, venues]);

  const fetchVenues = async () => {
    const { data } = await supabase.from('venues').select('id, name').order('name');
    setVenues(data || []);
  };

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const days = parseInt(period);
      const startDate = startOfDay(subDays(new Date(), days)).toISOString();
      const endDate = endOfDay(new Date()).toISOString();

      // Fetch events for venue mapping
      const { data: allEvents } = await supabase.from('events').select('id, venue_id');
      const eventVenueMap = new Map<string, string>();
      (allEvents || []).forEach(e => eventVenueMap.set(e.id, e.venue_id));

      // Fetch orders
      let ordersQ = supabase.from('orders').select('venue_id, total, service_fee, created_at, status').in('status', ['paid', 'served']).gte('created_at', startDate).lte('created_at', endDate);
      if (selectedVenue !== 'all') ordersQ = ordersQ.eq('venue_id', selectedVenue);
      const { data: orders } = await ordersQ;

      // Fetch tickets
      const ticketsQ = supabase.from('tickets').select('event_id, total_price, service_fee, insurance_fee, created_at, status').eq('status', 'paid').gte('created_at', startDate).lte('created_at', endDate);
      const { data: allTickets } = await ticketsQ;
      const ticketsData = selectedVenue !== 'all'
        ? (allTickets || []).filter(t => eventVenueMap.get(t.event_id) === selectedVenue)
        : allTickets || [];

      // Fetch table reservations
      const tablesQ = supabase.from('table_reservations').select('event_id, total_price, service_fee, management_fee, created_at, status').in('status', ['confirmed', 'paid']).gte('created_at', startDate).lte('created_at', endDate);
      const { data: allTables } = await tablesQ;
      const tablesData = selectedVenue !== 'all'
        ? (allTables || []).filter(t => eventVenueMap.get(t.event_id) === selectedVenue)
        : allTables || [];

      // Visitors
      let visitorsQ = supabase.from('visitor_sessions').select('venue_id, added_to_cart, proceeded_to_checkout, completed_order').gte('created_at', startDate).lte('created_at', endDate);
      if (selectedVenue !== 'all') visitorsQ = visitorsQ.eq('venue_id', selectedVenue);
      const { data: visitors } = await visitorsQ;

      // Subscriptions
      const { count: subsCount } = await supabase.from('venue_subscriptions').select('id', { count: 'exact', head: true }).in('status', ['active', 'trialing']);

      // Build daily data
      const dailyMap = new Map<string, { drinks: number; tickets: number; tables: number; drinkOrders: number; ticketOrders: number; tableOrders: number }>();
      for (let i = days; i >= 0; i--) {
        const date = format(subDays(new Date(), i), 'dd/MM');
        dailyMap.set(date, { drinks: 0, tickets: 0, tables: 0, drinkOrders: 0, ticketOrders: 0, tableOrders: 0 });
      }

      // Club revenue excludes Yuno fees; Yuno's own take is yunoRevenue below.
      (orders || []).forEach(o => {
        const date = format(new Date(o.created_at), 'dd/MM');
        const e = dailyMap.get(date);
        if (e) { e.drinks += orderClub(o).gross; e.drinkOrders += 1; }
      });
      ticketsData.forEach(t => {
        const date = format(new Date(t.created_at), 'dd/MM');
        const e = dailyMap.get(date);
        if (e) { e.tickets += ticketClub(t).gross; e.ticketOrders += 1; }
      });
      tablesData.forEach(t => {
        const date = format(new Date(t.created_at), 'dd/MM');
        const e = dailyMap.get(date);
        if (e) { e.tables += tableClub(t).gross; e.tableOrders += 1; }
      });

      const daily = Array.from(dailyMap.entries()).map(([date, d]) => ({
        date, ...d, total: d.drinks + d.tickets + d.tables,
      }));
      setDailyData(daily);

      // KPIs
      const drinkTotal = (orders || []).reduce((s, o) => s + orderClub(o).gross, 0);
      const ticketTotal = ticketsData.reduce((s, t) => s + ticketClub(t).gross, 0);
      const tableTotal = tablesData.reduce((s, t) => s + tableClub(t).gross, 0);
      const totalRevenue = drinkTotal + ticketTotal + tableTotal;

      const yunoRevenue = (orders || []).reduce((s, o) => s + Number(o.service_fee || 0), 0)
        + ticketsData.reduce((s, t) => s + Number(t.service_fee || 0) + Number(t.insurance_fee || 0), 0)
        + tablesData.reduce((s, t) => s + Number(t.service_fee || 0) + Number(t.management_fee || 0), 0);

      const totalTransactions = (orders || []).length + ticketsData.length + tablesData.length;
      const avgOrder = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

      const visitorsList = visitors || [];
      const totalVisitors = visitorsList.length;
      const completed = visitorsList.filter(v => v.completed_order).length;
      const conversionRate = totalVisitors > 0 ? ((completed / totalVisitors) * 100).toFixed(1) : '0';

      setKpiData({ totalRevenue, yunoRevenue, totalTransactions, conversionRate, ticketsSold: ticketsData.length, tablesBooked: tablesData.length, avgOrder, activeSubscriptions: subsCount || 0 });

      // Pie data
      setPieData([
        { name: t('adminAnalytics.drinks'), value: drinkTotal },
        { name: t('adminAnalytics.tickets'), value: ticketTotal },
        { name: t('adminAnalytics.tables'), value: tableTotal },
      ].filter(d => d.value > 0));

      // Conversion funnel
      setConversionData([
        { name: t('adminAnalytics.visitors'), value: totalVisitors },
        { name: t('adminAnalytics.addToCart'), value: visitorsList.filter(v => v.added_to_cart).length },
        { name: t('adminAnalytics.checkout'), value: visitorsList.filter(v => v.proceeded_to_checkout).length },
        { name: t('adminAnalytics.ordered'), value: completed },
      ]);

      // Venue comparison
      if (selectedVenue === 'all') {
        const venueRevMap = new Map<string, number>();
        venues.forEach(v => venueRevMap.set(v.id, 0));
        (orders || []).forEach(o => venueRevMap.set(o.venue_id, (venueRevMap.get(o.venue_id) || 0) + orderClub(o).gross));
        ticketsData.forEach(t => { const vid = eventVenueMap.get(t.event_id); if (vid) venueRevMap.set(vid, (venueRevMap.get(vid) || 0) + ticketClub(t).gross); });
        tablesData.forEach(t => { const vid = eventVenueMap.get(t.event_id); if (vid) venueRevMap.set(vid, (venueRevMap.get(vid) || 0) + tableClub(t).gross); });
        setVenueComparison(venues.map(v => ({ name: v.name, revenue: venueRevMap.get(v.id) || 0 })).filter(v => v.revenue > 0).sort((a, b) => b.revenue - a.revenue));
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const venueOptions = [{ value: 'all', label: t('adminAnalytics.allClubs') }, ...venues.map(v => ({ value: v.id, label: v.name }))];
  const periodOptions = [
    { value: '7', label: t('adminAnalytics.days7') },
    { value: '30', label: t('adminAnalytics.days30') },
    { value: '90', label: t('adminAnalytics.days90') },
  ];

  const selectStyle: React.CSSProperties = {
    background: INNER_BG, border: `1px solid ${BORDER}`, borderRadius: 10,
    color: T1, fontSize: 13, padding: '9px 12px', outline: 'none', cursor: 'pointer',
    appearance: 'none', WebkitAppearance: 'none', minWidth: 140,
  };

  // Line/bar series definitions (single-accent: RED lead, muted secondaries)
  const drinksColor = RED;
  const ticketsColor = '#818CF8';
  const tablesColor = '#F59E0B';
  const totalColor = C_HI;

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      {/* Ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0" style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>{t('adminAnalytics.title')}</h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('adminAnalytics.subtitle')}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <select value={selectedVenue} onChange={(e) => setSelectedVenue(e.target.value)} style={{ ...selectStyle, width: '100%' }} className="sm:!w-[180px]">
              {venueOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ ...selectStyle, width: '100%' }} className="sm:!w-[140px]">
              {periodOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <div className="text-center">
              <div className="mb-4 h-12 w-12 animate-spin rounded-full border-2 mx-auto" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
            </div>
          </div>
        ) : (
          <>
            {/* KPI row 1 */}
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
                <StatCard label={t('adminAnalytics.periodRevenue')} value={`${kpiData.totalRevenue.toFixed(2)}€`} icon={DollarSign} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                <StatCard label={t('adminAnalytics.yunoRevenue')} value={`${kpiData.yunoRevenue.toFixed(2)}€`} icon={Zap} highlight />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <StatCard label={t('adminAnalytics.totalTransactions')} value={kpiData.totalTransactions} icon={Activity} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <StatCard label={t('adminAnalytics.conversionRate')} value={`${kpiData.conversionRate}%`} icon={TrendingUp} tone="pos" />
              </motion.div>
            </div>

            {/* KPI row 2 */}
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
                <StatCard label={t('adminAnalytics.ticketsSold')} value={kpiData.ticketsSold} icon={Ticket} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                <StatCard label={t('adminAnalytics.tablesBooked')} value={kpiData.tablesBooked} icon={Crown} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <StatCard label={t('adminAnalytics.avgOrder')} value={`${kpiData.avgOrder.toFixed(2)}€`} icon={ShoppingBag} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                <StatCard label={t('adminAnalytics.activeSubscriptions')} value={kpiData.activeSubscriptions} icon={CreditCard} tone="pos" />
              </motion.div>
            </div>

            {/* Revenue chart - multi-line */}
            <Card>
              <CardTitle icon={TrendingUp}>{t('adminAnalytics.revenue')}</CardTitle>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.055)" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={8} tick={AXIS_TICK} />
                    <YAxis hide />
                    <Tooltip content={<MoneyTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.08)', strokeWidth: 1 }} />
                    <Line type="monotone" dataKey="drinks" name={t('adminAnalytics.drinks')} stroke={drinksColor} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="tickets" name={t('adminAnalytics.tickets')} stroke={ticketsColor} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="tables" name={t('adminAnalytics.tables')} stroke={tablesColor} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="total" name="Total" stroke={totalColor} strokeWidth={2.5} dot={false} strokeDasharray="5 5" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <ChartLegend items={[
                { name: t('adminAnalytics.drinks'), color: drinksColor },
                { name: t('adminAnalytics.tickets'), color: ticketsColor },
                { name: t('adminAnalytics.tables'), color: tablesColor },
                { name: 'Total', color: totalColor },
              ]} />
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Stacked bar chart */}
              <Card>
                <CardTitle icon={BarChart3}>{t('adminAnalytics.ordersPerDay')}</CardTitle>
                <div style={{ width: '100%', height: 250 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.055)" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={8} tick={AXIS_TICK} />
                      <YAxis hide />
                      <Tooltip content={<CountTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                      <Bar dataKey="drinkOrders" name={t('adminAnalytics.drinks')} stackId="a" fill={drinksColor} radius={[0, 0, 0, 0]} />
                      <Bar dataKey="ticketOrders" name={t('adminAnalytics.tickets')} stackId="a" fill={ticketsColor} radius={[0, 0, 0, 0]} />
                      <Bar dataKey="tableOrders" name={t('adminAnalytics.tables')} stackId="a" fill={tablesColor} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <ChartLegend items={[
                  { name: t('adminAnalytics.drinks'), color: drinksColor },
                  { name: t('adminAnalytics.tickets'), color: ticketsColor },
                  { name: t('adminAnalytics.tables'), color: tablesColor },
                ]} />
              </Card>

              {/* Pie chart */}
              <Card>
                <CardTitle icon={DollarSign}>{t('adminAnalytics.revenueByType')}</CardTitle>
                {pieData.length === 0 ? (
                  <div className="text-center py-8">
                    <DollarSign className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                    <p className="text-xs" style={{ color: T3 }}>{t('adminDashboard.noData')}</p>
                  </div>
                ) : (
                  <>
                    <div style={{ width: '100%', height: 250 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} cornerRadius={3} dataKey="value" strokeWidth={3} stroke="#000">
                            {pieData.map((_, i) => <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />)}
                          </Pie>
                          <Tooltip content={<PieTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ChartLegend items={pieData.map((d, i) => ({ name: d.name, color: PIE_PALETTE[i % PIE_PALETTE.length] }))} />
                  </>
                )}
              </Card>
            </div>

            {/* Conversion funnel */}
            <Card>
              <CardTitle icon={Activity}>{t('adminAnalytics.conversionFunnel')}</CardTitle>
              <div className="space-y-4">
                {conversionData.map((item, index) => {
                  const maxValue = conversionData[0]?.value || 1;
                  const percentage = ((item.value / maxValue) * 100).toFixed(0);
                  return (
                    <div key={item.name} className="space-y-1.5">
                      <div className="flex justify-between" style={{ fontSize: 13 }}>
                        <span style={{ color: T2 }}>{item.name}</span>
                        <span className="tabular-nums" style={{ color: T1, fontWeight: 600 }}>{item.value} <span style={{ color: T3, fontWeight: 400 }}>({percentage}%)</span></span>
                      </div>
                      <div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${percentage}%`, background: `linear-gradient(90deg, rgba(232,25,44,0.75), rgba(232,25,44,0.35))` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Club comparison */}
            {selectedVenue === 'all' && venueComparison.length > 0 && (
              <Card>
                <CardTitle icon={Building2}>{t('adminAnalytics.clubComparison')}</CardTitle>
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={venueComparison} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                      <defs>
                        <linearGradient id={`venue-bar-${uid}`} x1="0" x2="1" y1="0" y2="0">
                          <stop offset="0%" stopColor={RED} stopOpacity={0.45} />
                          <stop offset="100%" stopColor={RED} stopOpacity={0.95} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="rgba(255,255,255,0.055)" />
                      <XAxis type="number" axisLine={false} tickLine={false} tickMargin={8} tick={AXIS_TICK} />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={100} tick={{ fill: 'rgba(255,255,255,0.58)', fontSize: 11 }} />
                      <Tooltip content={<MoneyTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                      <Bar dataKey="revenue" name={t('adminAnalytics.revenue')} fill={`url(#venue-bar-${uid})`} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
