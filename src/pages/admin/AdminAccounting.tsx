import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Download, Calculator } from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { fr, es, enUS } from 'date-fns/locale';
import { toast } from 'sonner';

interface Venue { id: string; name: string; }
interface Commission { id: string; venue_id: string; venue_name?: string; period_start: string; period_end: string; total_revenue: number; commission_rate: number; commission_amount: number; status: string; paid_at: string | null; }
interface VenueRevenue { venue_id: string; venue_name: string; drinkRevenue: number; ticketRevenue: number; tableRevenue: number; totalRevenue: number; yunoFees: number; drinkOrders: number; ticketCount: number; tableCount: number; }

export default function AdminAccounting() {
  const { t, language } = useLanguage();
  const dateLocale = language === 'fr' ? fr : language === 'es' ? es : enUS;
  const [venues, setVenues] = useState<Venue[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [venueRevenues, setVenueRevenues] = useState<VenueRevenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));

  useEffect(() => { fetchData(); }, [selectedMonth]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: venuesData } = await supabase.from('venues').select('id, name').order('name');
      setVenues(venuesData || []);

      const { data: commissionsData } = await supabase.from('venue_commissions').select('*').order('period_start', { ascending: false });
      setCommissions((commissionsData || []).map(c => ({ ...c, venue_name: venuesData?.find(v => v.id === c.venue_id)?.name || c.venue_id })));

      const [year, month] = selectedMonth.split('-').map(Number);
      const monthStart = startOfMonth(new Date(year, month - 1)).toISOString();
      const monthEnd = endOfMonth(new Date(year, month - 1)).toISOString();

      // Fetch all 3 revenue sources
      const [ordersRes, ticketsRes, tablesRes, eventsRes, subsRes] = await Promise.all([
        supabase.from('orders').select('venue_id, total, service_fee').in('status', ['paid', 'served']).gte('created_at', monthStart).lte('created_at', monthEnd),
        supabase.from('tickets').select('event_id, total_price, service_fee').eq('status', 'paid').gte('created_at', monthStart).lte('created_at', monthEnd),
        supabase.from('table_reservations').select('event_id, total_price, service_fee, management_fee').in('status', ['confirmed', 'paid']).gte('created_at', monthStart).lte('created_at', monthEnd),
        supabase.from('events').select('id, venue_id'),
        supabase.from('venue_subscriptions').select('id, venue_id, status').in('status', ['active', 'trialing']),
      ]);

      const eventVenueMap = new Map<string, string>();
      (eventsRes.data || []).forEach(e => eventVenueMap.set(e.id, e.venue_id));

      const venueMap = new Map<string, VenueRevenue>();
      (venuesData || []).forEach(v => venueMap.set(v.id, { venue_id: v.id, venue_name: v.name, drinkRevenue: 0, ticketRevenue: 0, tableRevenue: 0, totalRevenue: 0, yunoFees: 0, drinkOrders: 0, ticketCount: 0, tableCount: 0 }));

      (ordersRes.data || []).forEach(o => {
        const v = venueMap.get(o.venue_id);
        if (v) { v.drinkRevenue += Number(o.total); v.yunoFees += Number(o.service_fee || 0); v.drinkOrders += 1; }
      });
      (ticketsRes.data || []).forEach(t => {
        const vid = eventVenueMap.get(t.event_id);
        if (vid) { const v = venueMap.get(vid); if (v) { v.ticketRevenue += Number(t.total_price); v.yunoFees += Number(t.service_fee || 0); v.ticketCount += 1; } }
      });
      (tablesRes.data || []).forEach(t => {
        const vid = eventVenueMap.get(t.event_id);
        if (vid) { const v = venueMap.get(vid); if (v) { v.tableRevenue += Number(t.total_price); v.yunoFees += Number(t.service_fee || 0) + Number(t.management_fee || 0); v.tableCount += 1; } }
      });

      const list = Array.from(venueMap.values()).map(v => ({ ...v, totalRevenue: v.drinkRevenue + v.ticketRevenue + v.tableRevenue })).filter(v => v.totalRevenue > 0).sort((a, b) => b.totalRevenue - a.totalRevenue);
      setVenueRevenues(list);
    } catch (error) { console.error('Error fetching data:', error); }
    finally { setLoading(false); }
  };

  const generateCommissions = async () => {
    try {
      const [year, month] = selectedMonth.split('-').map(Number);
      const periodStart = format(startOfMonth(new Date(year, month - 1)), 'yyyy-MM-dd');
      const periodEnd = format(endOfMonth(new Date(year, month - 1)), 'yyyy-MM-dd');
      const { error } = await supabase.from('venue_commissions').upsert(venueRevenues.map(v => ({
        venue_id: v.venue_id,
        period_start: periodStart,
        period_end: periodEnd,
        total_revenue: v.totalRevenue,
        commission_rate: v.totalRevenue > 0 ? (v.yunoFees / v.totalRevenue) * 100 : 0,
        commission_amount: v.yunoFees,
        status: 'pending',
      })), { onConflict: 'venue_id,period_start', ignoreDuplicates: false });
      if (error) throw error;
      toast.success(t('adminAccounting.generated'));
      fetchData();
    } catch (error: any) { toast.error(error.message || t('adminAccounting.generateError')); }
  };

  const updateCommissionStatus = async (id: string, status: string) => {
    try {
      const updates: any = { status };
      if (status === 'paid') updates.paid_at = new Date().toISOString();
      const { error } = await supabase.from('venue_commissions').update(updates).eq('id', id);
      if (error) throw error;
      toast.success(t('adminAccounting.statusUpdated'));
      fetchData();
    } catch (error: any) { toast.error(error.message || 'Error'); }
  };

  const exportCSV = () => {
    const headers = [t('adminAccounting.club'), t('adminAccounting.period'), t('adminAccounting.drinkRevenue'), t('adminAccounting.ticketRevenue'), t('adminAccounting.tableRevenue'), 'Total', t('adminAccounting.yunoFees'), t('adminAccounting.statusLabel')];
    const rows = venueRevenues.map(v => [v.venue_name, format(new Date(selectedMonth + '-01'), 'MMM yyyy', { locale: dateLocale }), `${v.drinkRevenue.toFixed(2)}€`, `${v.ticketRevenue.toFixed(2)}€`, `${v.tableRevenue.toFixed(2)}€`, `${v.totalRevenue.toFixed(2)}€`, `${v.yunoFees.toFixed(2)}€`, '']);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `commissions-${selectedMonth}.csv`; a.click();
  };

  const totalRevenue = venueRevenues.reduce((s, v) => s + v.totalRevenue, 0);
  const totalYunoFees = venueRevenues.reduce((s, v) => s + v.yunoFees, 0);
  const totalDrinks = venueRevenues.reduce((s, v) => s + v.drinkRevenue, 0);
  const totalTickets = venueRevenues.reduce((s, v) => s + v.ticketRevenue, 0);
  const totalTables = venueRevenues.reduce((s, v) => s + v.tableRevenue, 0);
  const pendingCommissions = commissions.filter(c => c.status === 'pending').reduce((s, c) => s + c.commission_amount, 0);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending': return <Badge variant="outline">{t('adminAccounting.statusPending')}</Badge>;
      case 'invoiced': return <Badge className="bg-blue-500/20 text-blue-500">{t('adminAccounting.statusInvoiced')}</Badge>;
      case 'paid': return <Badge className="bg-green-500/20 text-green-500">{t('adminAccounting.statusPaid')}</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return { value: format(date, 'yyyy-MM'), label: format(date, 'MMMM yyyy', { locale: dateLocale }) };
  });

  if (loading) return <div className="flex min-h-screen items-center justify-center"><div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{t('adminAccounting.title')}</h1>
          <p className="text-muted-foreground">{t('adminAccounting.subtitle')}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}><SelectTrigger className="w-full sm:w-[180px]"><SelectValue /></SelectTrigger><SelectContent>{monthOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>
          <Button variant="outline" onClick={exportCSV} className="w-full sm:w-auto"><Download className="h-4 w-4 mr-2" />{t('adminAccounting.exportCSV')}</Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAccounting.monthRevenue')}</p><p className="text-xl sm:text-2xl font-bold text-accent">{totalRevenue.toFixed(2)}€</p></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAccounting.yunoFees')}</p><p className="text-xl sm:text-2xl font-bold text-primary">{totalYunoFees.toFixed(2)}€</p></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAccounting.drinkRevenue')}</p><p className="text-xl sm:text-2xl font-bold">{totalDrinks.toFixed(2)}€</p></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAccounting.ticketRevenue')}</p><p className="text-xl sm:text-2xl font-bold text-violet-500">{totalTickets.toFixed(2)}€</p></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAccounting.tableRevenue')}</p><p className="text-xl sm:text-2xl font-bold text-amber-500">{totalTables.toFixed(2)}€</p></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><p className="text-xs sm:text-sm text-muted-foreground">{t('adminAccounting.pending')}</p><p className="text-xl sm:text-2xl font-bold text-yellow-500">{pendingCommissions.toFixed(2)}€</p></CardContent></Card>
      </div>

      {/* Per-venue breakdown */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <CardTitle className="text-base sm:text-lg">{t('adminAccounting.monthRevenueTitle')} — {format(new Date(selectedMonth + '-01'), 'MMMM yyyy', { locale: dateLocale })}</CardTitle>
          <Button onClick={generateCommissions} disabled={venueRevenues.length === 0} className="w-full sm:w-auto"><Calculator className="h-4 w-4 mr-2" />{t('adminAccounting.generateCommissions')}</Button>
        </CardHeader>
        <CardContent>
          {venueRevenues.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">{t('adminAccounting.noDataMonth')}</p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6">
              <div className="min-w-[700px] px-4 sm:px-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('adminAccounting.club')}</TableHead>
                      <TableHead className="text-right">{t('adminAccounting.drinkRevenue')}</TableHead>
                      <TableHead className="text-right">{t('adminAccounting.ticketRevenue')}</TableHead>
                      <TableHead className="text-right">{t('adminAccounting.tableRevenue')}</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">{t('adminAccounting.yunoFees')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {venueRevenues.map(v => (
                      <TableRow key={v.venue_id}>
                        <TableCell className="font-medium">{v.venue_name}</TableCell>
                        <TableCell className="text-right">{v.drinkRevenue.toFixed(2)}€</TableCell>
                        <TableCell className="text-right">{v.ticketRevenue.toFixed(2)}€</TableCell>
                        <TableCell className="text-right">{v.tableRevenue.toFixed(2)}€</TableCell>
                        <TableCell className="text-right font-bold">{v.totalRevenue.toFixed(2)}€</TableCell>
                        <TableCell className="text-right text-primary font-medium">{v.yunoFees.toFixed(2)}€</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold bg-muted/50">
                      <TableCell>{t('adminAccounting.total')}</TableCell>
                      <TableCell className="text-right">{totalDrinks.toFixed(2)}€</TableCell>
                      <TableCell className="text-right">{totalTickets.toFixed(2)}€</TableCell>
                      <TableCell className="text-right">{totalTables.toFixed(2)}€</TableCell>
                      <TableCell className="text-right">{totalRevenue.toFixed(2)}€</TableCell>
                      <TableCell className="text-right text-primary">{totalYunoFees.toFixed(2)}€</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Commission history */}
      <Card>
        <CardHeader><CardTitle className="text-base sm:text-lg">{t('adminAccounting.commissionHistory')}</CardTitle></CardHeader>
        <CardContent>
          {commissions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">{t('adminAccounting.noCommissions')}</p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:-mx-6">
              <div className="min-w-[700px] px-4 sm:px-6">
                <Table>
                  <TableHeader><TableRow><TableHead>{t('adminAccounting.club')}</TableHead><TableHead>{t('adminAccounting.period')}</TableHead><TableHead className="text-right">{t('adminAccounting.revenue')}</TableHead><TableHead className="text-right">{t('adminAccounting.yunoFees')}</TableHead><TableHead>{t('adminAccounting.statusLabel')}</TableHead><TableHead>{t('adminAccounting.actions')}</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {commissions.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.venue_name}</TableCell>
                        <TableCell>{format(new Date(c.period_start), 'MMM yyyy', { locale: dateLocale })}</TableCell>
                        <TableCell className="text-right">{c.total_revenue.toFixed(2)}€</TableCell>
                        <TableCell className="text-right text-primary font-medium">{c.commission_amount.toFixed(2)}€</TableCell>
                        <TableCell>{getStatusBadge(c.status)}</TableCell>
                        <TableCell>
                          <Select value={c.status} onValueChange={(value) => updateCommissionStatus(c.id, value)}>
                            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">{t('adminAccounting.statusPending')}</SelectItem>
                              <SelectItem value="invoiced">{t('adminAccounting.statusInvoiced')}</SelectItem>
                              <SelectItem value="paid">{t('adminAccounting.statusPaid')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
