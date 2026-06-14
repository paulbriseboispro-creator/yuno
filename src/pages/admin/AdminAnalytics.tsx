import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';

interface Venue { id: string; name: string; }

const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function AdminAnalytics() {
  const { t } = useLanguage();
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
      let ticketsQ = supabase.from('tickets').select('event_id, total_price, service_fee, created_at, status').eq('status', 'paid').gte('created_at', startDate).lte('created_at', endDate);
      const { data: allTickets } = await ticketsQ;
      const ticketsData = selectedVenue !== 'all'
        ? (allTickets || []).filter(t => eventVenueMap.get(t.event_id) === selectedVenue)
        : allTickets || [];

      // Fetch table reservations
      let tablesQ = supabase.from('table_reservations').select('event_id, total_price, service_fee, management_fee, created_at, status').in('status', ['confirmed', 'paid']).gte('created_at', startDate).lte('created_at', endDate);
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

      (orders || []).forEach(o => {
        const date = format(new Date(o.created_at), 'dd/MM');
        const e = dailyMap.get(date);
        if (e) { e.drinks += Number(o.total); e.drinkOrders += 1; }
      });
      ticketsData.forEach(t => {
        const date = format(new Date(t.created_at), 'dd/MM');
        const e = dailyMap.get(date);
        if (e) { e.tickets += Number(t.total_price); e.ticketOrders += 1; }
      });
      tablesData.forEach(t => {
        const date = format(new Date(t.created_at), 'dd/MM');
        const e = dailyMap.get(date);
        if (e) { e.tables += Number(t.total_price); e.tableOrders += 1; }
      });

      const daily = Array.from(dailyMap.entries()).map(([date, d]) => ({
        date, ...d, total: d.drinks + d.tickets + d.tables,
      }));
      setDailyData(daily);

      // KPIs
      const drinkTotal = (orders || []).reduce((s, o) => s + Number(o.total), 0);
      const ticketTotal = ticketsData.reduce((s, t) => s + Number(t.total_price), 0);
      const tableTotal = tablesData.reduce((s, t) => s + Number(t.total_price), 0);
      const totalRevenue = drinkTotal + ticketTotal + tableTotal;

      const yunoRevenue = (orders || []).reduce((s, o) => s + Number(o.service_fee || 0), 0)
        + ticketsData.reduce((s, t) => s + Number(t.service_fee || 0), 0)
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
        (orders || []).forEach(o => venueRevMap.set(o.venue_id, (venueRevMap.get(o.venue_id) || 0) + Number(o.total)));
        ticketsData.forEach(t => { const vid = eventVenueMap.get(t.event_id); if (vid) venueRevMap.set(vid, (venueRevMap.get(vid) || 0) + Number(t.total_price)); });
        tablesData.forEach(t => { const vid = eventVenueMap.get(t.event_id); if (vid) venueRevMap.set(vid, (venueRevMap.get(vid) || 0) + Number(t.total_price)); });
        setVenueComparison(venues.map(v => ({ name: v.name, revenue: venueRevMap.get(v.id) || 0 })).filter(v => v.revenue > 0).sort((a, b) => b.revenue - a.revenue));
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{t('adminAnalytics.title')}</h1>
          <p className="text-muted-foreground">{t('adminAnalytics.subtitle')}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Select value={selectedVenue} onValueChange={setSelectedVenue}>
            <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder={t('adminAnalytics.allClubs')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('adminAnalytics.allClubs')}</SelectItem>
              {venues.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-full sm:w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t('adminAnalytics.days7')}</SelectItem>
              <SelectItem value="30">{t('adminAnalytics.days30')}</SelectItem>
              <SelectItem value="90">{t('adminAnalytics.days90')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
      ) : (
        <>
          {/* KPI row 1 */}
          <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
            <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAnalytics.periodRevenue')}</p><p className="text-xl sm:text-2xl font-bold text-accent">{kpiData.totalRevenue.toFixed(2)}€</p></CardContent></Card>
            <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAnalytics.yunoRevenue')}</p><p className="text-xl sm:text-2xl font-bold text-primary">{kpiData.yunoRevenue.toFixed(2)}€</p></CardContent></Card>
            <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAnalytics.totalTransactions')}</p><p className="text-xl sm:text-2xl font-bold">{kpiData.totalTransactions}</p></CardContent></Card>
            <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAnalytics.conversionRate')}</p><p className="text-xl sm:text-2xl font-bold text-green-500">{kpiData.conversionRate}%</p></CardContent></Card>
          </div>

          {/* KPI row 2 */}
          <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
            <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAnalytics.ticketsSold')}</p><p className="text-xl sm:text-2xl font-bold text-violet-500">{kpiData.ticketsSold}</p></CardContent></Card>
            <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAnalytics.tablesBooked')}</p><p className="text-xl sm:text-2xl font-bold text-amber-500">{kpiData.tablesBooked}</p></CardContent></Card>
            <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAnalytics.avgOrder')}</p><p className="text-xl sm:text-2xl font-bold">{kpiData.avgOrder.toFixed(2)}€</p></CardContent></Card>
            <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAnalytics.activeSubscriptions')}</p><p className="text-xl sm:text-2xl font-bold text-emerald-500">{kpiData.activeSubscriptions}</p></CardContent></Card>
          </div>

          {/* Revenue chart - multi-line */}
          <Card>
            <CardHeader><CardTitle>{t('adminAnalytics.revenue')}</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} formatter={(value: number, name: string) => [`${value.toFixed(2)}€`, name]} />
                  <Legend />
                  <Line type="monotone" dataKey="drinks" name={t('adminAnalytics.drinks')} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="tickets" name={t('adminAnalytics.tickets')} stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="tables" name={t('adminAnalytics.tables')} stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="total" name="Total" stroke="hsl(var(--accent))" strokeWidth={2.5} dot={false} strokeDasharray="5 5" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Stacked bar chart */}
            <Card>
              <CardHeader><CardTitle>{t('adminAnalytics.ordersPerDay')}</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
                    <Legend />
                    <Bar dataKey="drinkOrders" name={t('adminAnalytics.drinks')} stackId="a" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="ticketOrders" name={t('adminAnalytics.tickets')} stackId="a" fill="#8b5cf6" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="tableOrders" name={t('adminAnalytics.tables')} stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Pie chart */}
            <Card>
              <CardHeader><CardTitle>{t('adminAnalytics.revenueByType')}</CardTitle></CardHeader>
              <CardContent>
                {pieData.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{t('adminDashboard.noData')}</p>
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(value: number) => [`${value.toFixed(2)}€`]} contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Conversion funnel */}
          <Card>
            <CardHeader><CardTitle>{t('adminAnalytics.conversionFunnel')}</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {conversionData.map((item, index) => {
                  const maxValue = conversionData[0]?.value || 1;
                  const percentage = ((item.value / maxValue) * 100).toFixed(0);
                  return (
                    <div key={item.name} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{item.name}</span>
                        <span className="font-medium">{item.value} ({percentage}%)</span>
                      </div>
                      <div className="h-3 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${percentage}%`, backgroundColor: COLORS[index % COLORS.length] }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Club comparison */}
          {selectedVenue === 'all' && venueComparison.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t('adminAnalytics.clubComparison')}</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={venueComparison} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis dataKey="name" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} width={100} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--foreground))' }} formatter={(value: number) => [`${value.toFixed(2)}€`, t('adminAnalytics.revenue')]} />
                    <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
