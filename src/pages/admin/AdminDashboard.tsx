import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Building2, ShoppingBag, Users, DollarSign, TrendingUp, AlertCircle, Ticket, Crown, CreditCard, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { MaintenanceToggle } from '@/components/admin/MaintenanceToggle';

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

export default function AdminDashboard() {
  const { t, language } = useLanguage();
  const [stats, setStats] = useState<DashboardStats>({
    totalVenues: 0, totalOrders: 0, totalRevenue: 0, yunoRevenue: 0,
    totalUsers: 0, monthlyRevenue: 0, monthlyYunoRevenue: 0, openIssues: 0,
    ticketsSold: 0, tablesBooked: 0, activeSubscriptions: 0,
  });
  const [loading, setLoading] = useState(true);
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
    }
  };

  const monthName = format(new Date(), 'MMMM', { locale: dateLocale });

  const kpis = [
    { label: t('adminDashboard.partnerClubs'), value: stats.totalVenues, icon: Building2, color: 'text-primary' },
    { label: t('adminDashboard.totalRevenue'), value: `${stats.totalRevenue.toFixed(2)}€`, icon: DollarSign, color: 'text-emerald-500' },
    { label: t('adminDashboard.yunoRevenue'), value: `${stats.yunoRevenue.toFixed(2)}€`, icon: Zap, color: 'text-accent' },
    { label: t('adminDashboard.totalOrders'), value: stats.totalOrders, icon: ShoppingBag, color: 'text-primary' },
    { label: t('adminDashboard.ticketsSold'), value: stats.ticketsSold, icon: Ticket, color: 'text-violet-500' },
    { label: t('adminDashboard.tablesBooked'), value: stats.tablesBooked, icon: Crown, color: 'text-amber-500' },
    { label: t('adminDashboard.users'), value: stats.totalUsers, icon: Users, color: 'text-sky-500' },
    { label: t('adminDashboard.activeSubscriptions'), value: stats.activeSubscriptions, icon: CreditCard, color: 'text-emerald-500' },
    { label: `CA ${monthName}`, value: `${stats.monthlyRevenue.toFixed(2)}€`, icon: TrendingUp, color: 'text-violet-500' },
    { label: `Yuno ${monthName}`, value: `${stats.monthlyYunoRevenue.toFixed(2)}€`, icon: Zap, color: 'text-accent' },
    { label: t('adminDashboard.openIssues'), value: stats.openIssues, icon: AlertCircle, color: stats.openIssues > 0 ? 'text-destructive' : 'text-muted-foreground' },
  ];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">{t('adminDashboard.title')}</h1>
        <p className="text-muted-foreground">{t('adminDashboard.subtitle')}</p>
      </div>

      <MaintenanceToggle />

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {kpis.map((kpi, index) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
          >
            <Card>
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                    <p className={`text-lg sm:text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
                  </div>
                  <kpi.icon className={`h-6 w-6 sm:h-8 sm:w-8 ${kpi.color} opacity-50`} />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('adminDashboard.performanceByClub')}</CardTitle>
        </CardHeader>
        <CardContent>
          {venueStats.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('adminDashboard.noData')}</p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6">
              <div className="min-w-[600px] px-4 sm:px-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 font-medium">#</th>
                      <th className="text-left py-2 font-medium">Club</th>
                      <th className="text-right py-2 font-medium">{t('adminAnalytics.drinks')}</th>
                      <th className="text-right py-2 font-medium">{t('adminAnalytics.tickets')}</th>
                      <th className="text-right py-2 font-medium">{t('adminAnalytics.tables')}</th>
                      <th className="text-right py-2 font-medium">Total</th>
                      <th className="text-right py-2 font-medium">Yuno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {venueStats.map((venue, index) => (
                      <motion.tr
                        key={venue.name}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="border-b border-border/50"
                      >
                        <td className="py-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-primary font-bold text-sm">
                            {index + 1}
                          </div>
                        </td>
                        <td className="py-3 font-semibold">{venue.name}</td>
                        <td className="py-3 text-right">{venue.drinkRevenue.toFixed(2)}€</td>
                        <td className="py-3 text-right">{venue.ticketRevenue.toFixed(2)}€</td>
                        <td className="py-3 text-right">{venue.tableRevenue.toFixed(2)}€</td>
                        <td className="py-3 text-right font-bold text-accent">{venue.totalRevenue.toFixed(2)}€</td>
                        <td className="py-3 text-right text-primary font-medium">{venue.yunoFees.toFixed(2)}€</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
