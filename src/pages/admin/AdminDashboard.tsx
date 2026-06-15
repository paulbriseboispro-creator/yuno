import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Building2, ShoppingBag, Users, DollarSign, TrendingUp, AlertCircle,
  Ticket, Crown, CreditCard, Zap, Wine, Activity, BarChart3, RotateCw,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { MaintenanceToggle } from '@/components/admin/MaintenanceToggle';

// ─── Yuno Design Tokens ───────────────────────────────────────────────────────
const RED        = '#E8192C';
const POS        = '#34D399';
const NEG        = '#FF5C63';
const T1         = 'rgba(255,255,255,0.96)';
const T2         = 'rgba(255,255,255,0.58)';
const T3         = 'rgba(255,255,255,0.36)';
const C_FAINT    = 'rgba(255,255,255,0.06)';
const C_MID      = 'rgba(255,255,255,0.40)';
const C_HI       = 'rgba(255,255,255,0.92)';
const BORDER     = 'rgba(255,255,255,0.085)';
const F_BORDER   = 'rgba(255,255,255,0.055)';
const INNER_BG   = 'rgba(255,255,255,0.032)';
const CARD_BG    = 'linear-gradient(180deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 100%),#0a0a0c';
const CARD_SHADOW = '0 1px 0 rgba(255,255,255,.05) inset,0 18px 40px -28px rgba(0,0,0,.9)';

interface DashboardStats {
  totalVenues: number;
  totalOrders: number;
  totalRevenue: number;
  yunoRevenue: number;
  totalUsers: number;
  monthlyRevenue: number;
  monthlyYunoRevenue: number;
  openIssues: number;
  ticketsSold: number;
  tablesBooked: number;
  activeSubscriptions: number;
}

interface VenueStat {
  name: string;
  drinkRevenue: number;
  ticketRevenue: number;
  tableRevenue: number;
  totalRevenue: number;
  yunoFees: number;
  orders: number;
}

const fmtEur = (n: number) =>
  n >= 10000 ? `${(n / 1000).toFixed(1)}k €` : `${n.toFixed(n < 100 ? 2 : 0)} €`;

// ─── Section header ─────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, label, accent }: { icon: LucideIcon; label: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 mb-3 px-0.5">
      <div
        className="flex h-7 w-7 items-center justify-center rounded-lg flex-none"
        style={accent
          ? { background: 'rgba(232,25,44,0.1)', border: '1px solid rgba(232,25,44,0.2)' }
          : { background: C_FAINT, border: `1px solid ${BORDER}` }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: accent ? RED : T2 }} />
      </div>
      <h2 style={{ color: T1, fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </h2>
    </div>
  );
}

// ─── Stat card ──────────────────────────────────────────────────────────────
function StatCard({
  label, value, icon: Icon, highlight, sub, tone,
}: {
  label: string; value: string | number; icon: LucideIcon;
  highlight?: boolean; sub?: string; tone?: 'pos' | 'neg';
}) {
  const valueColor = tone === 'neg' ? NEG : tone === 'pos' ? POS : highlight ? RED : T1;
  return (
    <div
      style={{
        background: highlight
          ? 'linear-gradient(135deg,rgba(232,25,44,0.14),rgba(232,25,44,0.035)),#0a0a0c'
          : CARD_BG,
        border: `1px solid ${highlight ? 'rgba(232,25,44,0.24)' : BORDER}`,
        borderRadius: 16,
        boxShadow: CARD_SHADOW,
        padding: '16px 18px',
        height: '100%',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <p style={{ color: T3, fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {label}
        </p>
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg flex-none"
          style={{ background: highlight ? 'rgba(232,25,44,0.12)' : C_FAINT, border: `1px solid ${highlight ? 'rgba(232,25,44,0.2)' : F_BORDER}` }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: highlight ? RED : T2 }} />
        </div>
      </div>
      <p className="tabular-nums" style={{ color: valueColor, fontSize: 26, fontWeight: 640, letterSpacing: '-0.025em', lineHeight: 1 }}>
        {value}
      </p>
      {sub && <p style={{ color: T3, fontSize: 11, marginTop: 8 }}>{sub}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const { t, language } = useLanguage();
  const [stats, setStats] = useState<DashboardStats>({
    totalVenues: 0, totalOrders: 0, totalRevenue: 0, yunoRevenue: 0,
    totalUsers: 0, monthlyRevenue: 0, monthlyYunoRevenue: 0, openIssues: 0,
    ticketsSold: 0, tablesBooked: 0, activeSubscriptions: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [venueStats, setVenueStats] = useState<VenueStat[]>([]);

  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;

  useEffect(() => { fetchStats(); }, []);

  const fetchStats = async () => {
    try {
      const now = new Date();
      const monthStart = startOfMonth(now).toISOString();
      const monthEnd = endOfMonth(now).toISOString();

      const [venuesRes, ordersRes, ticketsRes, tablesRes, eventsRes, usersRes, issuesRes, monthOrdersRes, monthTicketsRes, monthTablesRes, subsRes] = await Promise.all([
        supabase.from('venues').select('id, name'),
        supabase.from('orders').select('venue_id, total, service_fee, status').in('status', ['paid', 'served']),
        supabase.from('tickets').select('event_id, total_price, service_fee, status').eq('status', 'paid'),
        supabase.from('table_reservations').select('event_id, zone_id, total_price, service_fee, management_fee, status').in('status', ['confirmed', 'paid']),
        supabase.from('events').select('id, venue_id'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('feedback_issues').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase.from('orders').select('total, service_fee').in('status', ['paid', 'served']).gte('created_at', monthStart).lte('created_at', monthEnd),
        supabase.from('tickets').select('total_price, service_fee').eq('status', 'paid').gte('created_at', monthStart).lte('created_at', monthEnd),
        supabase.from('table_reservations').select('total_price, service_fee, management_fee').in('status', ['confirmed', 'paid']).gte('created_at', monthStart).lte('created_at', monthEnd),
        supabase.from('venue_subscriptions').select('id', { count: 'exact', head: true }).in('status', ['active', 'trialing']),
      ]);

      const venues = venuesRes.data || [];
      const orders = ordersRes.data || [];
      const tickets = ticketsRes.data || [];
      const tables = tablesRes.data || [];
      const events = eventsRes.data || [];

      // Build event→venue map
      const eventVenueMap = new Map<string, string>();
      events.forEach(e => eventVenueMap.set(e.id, e.venue_id));

      // Global totals
      const orderRevenue = orders.reduce((s, o) => s + Number(o.total), 0);
      const ticketRevenue = tickets.reduce((s, t) => s + Number(t.total_price), 0);
      const tableRevenue = tables.reduce((s, t) => s + Number(t.total_price), 0);
      const totalRevenue = orderRevenue + ticketRevenue + tableRevenue;

      const orderFees = orders.reduce((s, o) => s + Number(o.service_fee || 0), 0);
      const ticketFees = tickets.reduce((s, t) => s + Number(t.service_fee || 0), 0);
      const tableFees = tables.reduce((s, t) => s + Number(t.service_fee || 0) + Number(t.management_fee || 0), 0);
      const yunoRevenue = orderFees + ticketFees + tableFees;

      // Monthly
      const mOrders = monthOrdersRes.data || [];
      const mTickets = monthTicketsRes.data || [];
      const mTables = monthTablesRes.data || [];
      const monthlyRevenue = mOrders.reduce((s, o) => s + Number(o.total), 0) + mTickets.reduce((s, t) => s + Number(t.total_price), 0) + mTables.reduce((s, t) => s + Number(t.total_price), 0);
      const monthlyYunoRevenue = mOrders.reduce((s, o) => s + Number(o.service_fee || 0), 0) + mTickets.reduce((s, t) => s + Number(t.service_fee || 0), 0) + mTables.reduce((s, t) => s + Number(t.service_fee || 0) + Number(t.management_fee || 0), 0);

      // Per-venue stats
      const venueMap = new Map<string, VenueStat>();
      venues.forEach(v => venueMap.set(v.id, { name: v.name, drinkRevenue: 0, ticketRevenue: 0, tableRevenue: 0, totalRevenue: 0, yunoFees: 0, orders: 0 }));

      orders.forEach(o => {
        const v = venueMap.get(o.venue_id);
        if (v) { v.drinkRevenue += Number(o.total); v.yunoFees += Number(o.service_fee || 0); v.orders += 1; }
      });
      tickets.forEach(t => {
        const venueId = eventVenueMap.get(t.event_id);
        if (venueId) {
          const v = venueMap.get(venueId);
          if (v) { v.ticketRevenue += Number(t.total_price); v.yunoFees += Number(t.service_fee || 0); }
        }
      });
      tables.forEach(t => {
        const venueId = eventVenueMap.get(t.event_id);
        if (venueId) {
          const v = venueMap.get(venueId);
          if (v) { v.tableRevenue += Number(t.total_price); v.yunoFees += Number(t.service_fee || 0) + Number(t.management_fee || 0); }
        }
      });

      const venueList = Array.from(venueMap.values()).map(v => ({ ...v, totalRevenue: v.drinkRevenue + v.ticketRevenue + v.tableRevenue })).filter(v => v.totalRevenue > 0).sort((a, b) => b.totalRevenue - a.totalRevenue);
      setVenueStats(venueList);

      setStats({
        totalVenues: venues.length,
        totalOrders: orders.length + tickets.length + tables.length,
        totalRevenue,
        yunoRevenue,
        totalUsers: usersRes.count || 0,
        monthlyRevenue,
        monthlyYunoRevenue,
        openIssues: issuesRes.count || 0,
        ticketsSold: tickets.length,
        tablesBooked: tables.length,
        activeSubscriptions: subsRes.count || 0,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => { setRefreshing(true); fetchStats(); };

  const monthName = format(new Date(), 'MMMM', { locale: dateLocale });
  const takeRate = stats.totalRevenue > 0 ? (stats.yunoRevenue / stats.totalRevenue) * 100 : 0;
  const drinkOrders = Math.max(0, stats.totalOrders - stats.ticketsSold - stats.tablesBooked);
  const topRevenue = venueStats[0]?.totalRevenue || 1;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: '#000' }}>
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-2 mx-auto" style={{ borderColor: `${BORDER} ${BORDER} ${BORDER} ${RED}` }} />
          <p className="text-sm" style={{ color: T3 }}>{t('adminDashboard.title')}…</p>
        </div>
      </div>
    );
  }

  const revenueCards = [
    { label: t('adminDashboard.totalRevenue'), value: fmtEur(stats.totalRevenue), icon: DollarSign },
    { label: t('adminDashboard.yunoRevenue'), value: fmtEur(stats.yunoRevenue), icon: Zap, highlight: true, sub: `${takeRate.toFixed(1)}% ${t('adminDashboard.shareOfTotal')}` },
    { label: t('adminDashboard.gmvMonth').replace('{month}', monthName), value: fmtEur(stats.monthlyRevenue), icon: TrendingUp },
    { label: t('adminDashboard.yunoMonth').replace('{month}', monthName), value: fmtEur(stats.monthlyYunoRevenue), icon: Zap },
  ] as const;

  const activityCards = [
    { label: t('adminDashboard.transactions'), value: stats.totalOrders.toLocaleString(), icon: Activity },
    { label: t('adminDashboard.drinkOrders'), value: drinkOrders.toLocaleString(), icon: Wine },
    { label: t('adminDashboard.ticketsSold'), value: stats.ticketsSold.toLocaleString(), icon: Ticket },
    { label: t('adminDashboard.tablesBooked'), value: stats.tablesBooked.toLocaleString(), icon: Crown },
  ] as const;

  const platformCards = [
    { label: t('adminDashboard.partnerClubs'), value: stats.totalVenues.toLocaleString(), icon: Building2 },
    { label: t('adminDashboard.users'), value: stats.totalUsers.toLocaleString(), icon: Users },
    { label: t('adminDashboard.activeSubscriptions'), value: stats.activeSubscriptions.toLocaleString(), icon: CreditCard, tone: 'pos' as const },
    { label: t('adminDashboard.openIssues'), value: stats.openIssues.toLocaleString(), icon: AlertCircle, tone: stats.openIssues > 0 ? 'neg' as const : undefined },
  ];

  return (
    <div className="min-h-screen pb-16" style={{ background: '#000' }}>
      {/* Ambient vignette */}
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ background: 'radial-gradient(120% 60% at 50% -10%,rgba(232,25,44,.05),transparent 55%)' }} />

      <div className="relative z-10 mx-auto max-w-[1340px] px-4 sm:px-6 py-6 space-y-7">

        {/* Header */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 style={{ color: T1, fontSize: 'clamp(22px,3vw,28px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
              {t('adminDashboard.title')}
            </h1>
            <p style={{ color: T3, fontSize: 13, marginTop: 4 }}>{t('adminDashboard.subtitle')}</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12.5px] font-medium cursor-pointer transition-all duration-150"
            style={{ background: INNER_BG, border: `1px solid ${BORDER}`, color: T2 }}
          >
            <RotateCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {t('adminDashboard.refresh')}
          </button>
        </div>

        {/* Revenue */}
        <section>
          <SectionHeader icon={DollarSign} label={t('adminDashboard.sectionRevenue')} accent />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {revenueCards.map((c, i) => (
              <motion.div key={c.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <StatCard {...c} />
              </motion.div>
            ))}
          </div>
        </section>

        {/* Activity — the 3 pillars */}
        <section>
          <SectionHeader icon={Zap} label={t('adminDashboard.sectionActivity')} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {activityCards.map((c, i) => (
              <motion.div key={c.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <StatCard {...c} />
              </motion.div>
            ))}
          </div>
        </section>

        {/* Platform */}
        <section>
          <SectionHeader icon={Building2} label={t('adminDashboard.sectionPlatform')} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {platformCards.map((c, i) => (
              <motion.div key={c.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <StatCard {...c} />
              </motion.div>
            ))}
          </div>
        </section>

        {/* Performance by club */}
        <section>
          <SectionHeader icon={BarChart3} label={t('adminDashboard.performanceByClub')} />
          <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 18, boxShadow: CARD_SHADOW, padding: '8px 4px', overflow: 'hidden' }}>
            {venueStats.length === 0 ? (
              <div className="text-center py-12 px-4">
                <Building2 className="h-9 w-9 mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.12)' }} />
                <p className="text-xs" style={{ color: T3 }}>{t('adminDashboard.noData')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]" style={{ minWidth: 680 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${F_BORDER}` }}>
                      <th className="px-3 py-2.5 text-left font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>#</th>
                      <th className="px-3 py-2.5 text-left font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Club</th>
                      <th className="px-3 py-2.5 text-right font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('adminAnalytics.drinks')}</th>
                      <th className="px-3 py-2.5 text-right font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('adminAnalytics.tickets')}</th>
                      <th className="px-3 py-2.5 text-right font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('adminAnalytics.tables')}</th>
                      <th className="px-3 py-2.5 text-right font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</th>
                      <th className="px-3 py-2.5 text-right font-medium" style={{ color: T3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Yuno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {venueStats.map((venue, index) => {
                      const barPct = Math.max(3, Math.round((venue.totalRevenue / topRevenue) * 100));
                      const isLeader = index === 0;
                      return (
                        <motion.tr
                          key={venue.name}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: Math.min(index * 0.03, 0.3) }}
                          style={{ borderBottom: index < venueStats.length - 1 ? `1px solid ${F_BORDER}` : 'none' }}
                        >
                          <td className="px-3 py-3">
                            <span className="tabular-nums" style={{ color: T3, fontSize: 12 }}>{String(index + 1).padStart(2, '0')}</span>
                          </td>
                          <td className="px-3 py-3" style={{ minWidth: 180 }}>
                            <div className="font-[560] truncate" style={{ color: T1 }}>{venue.name}</div>
                            <div className="h-1 rounded-full mt-1.5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)', maxWidth: 160 }}>
                              <div className="h-full rounded-full" style={{
                                width: `${barPct}%`,
                                background: isLeader ? `linear-gradient(90deg,${RED}88,${RED})` : `linear-gradient(90deg,${C_MID},${C_HI})`,
                              }} />
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{fmtEur(venue.drinkRevenue)}</td>
                          <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{fmtEur(venue.ticketRevenue)}</td>
                          <td className="px-3 py-3 text-right tabular-nums" style={{ color: T2 }}>{fmtEur(venue.tableRevenue)}</td>
                          <td className="px-3 py-3 text-right tabular-nums font-[620]" style={{ color: T1 }}>{fmtEur(venue.totalRevenue)}</td>
                          <td className="px-3 py-3 text-right tabular-nums font-[620]" style={{ color: RED }}>{fmtEur(venue.yunoFees)}</td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* System / maintenance */}
        <section>
          <SectionHeader icon={AlertCircle} label={t('maintenance.title')} />
          <MaintenanceToggle />
        </section>

      </div>
    </div>
  );
}
