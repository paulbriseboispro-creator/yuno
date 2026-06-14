import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Wine, Ticket, Armchair, RefreshCw, ShoppingCart, TrendingUp, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';

const PAGE_SIZE = 25;

export default function AdminOrders() {
  const { t } = useLanguage();
  const [tab, setTab] = useState('drinks');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [data, setData] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [venues, setVenues] = useState<Record<string, string>>({});
  const [kpis, setKpis] = useState({ total: 0, revenue: 0, refunds: 0 });

  useEffect(() => {
    supabase.from('venues').select('id, name').then(({ data }) => {
      if (data) setVenues(Object.fromEntries(data.map(v => [v.id, v.name])));
    });
  }, []);

  // Load KPIs once per tab change
  useEffect(() => {
    const loadKpis = async () => {
      if (tab === 'drinks') {
        const [{ count: total }, { count: refunds }] = await Promise.all([
          supabase.from('orders').select('id', { count: 'exact', head: true }),
          supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'refunded'),
        ]);
        const { data: revData } = await supabase.from('orders').select('total').in('status', ['paid', 'confirmed', 'served']);
        const revenue = (revData || []).reduce((sum, o) => sum + (o.total || 0), 0);
        setKpis({ total: total ?? 0, revenue, refunds: refunds ?? 0 });
      } else if (tab === 'tickets') {
        const [{ count: total }, { count: refunds }] = await Promise.all([
          supabase.from('tickets').select('id', { count: 'exact', head: true }),
          supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('status', 'refunded'),
        ]);
        const { data: revData } = await supabase.from('tickets').select('total_price').in('status', ['paid', 'confirmed']);
        const revenue = (revData || []).reduce((sum, o) => sum + (o.total_price || 0), 0);
        setKpis({ total: total ?? 0, revenue, refunds: refunds ?? 0 });
      } else {
        const [{ count: total }, { count: refunds }] = await Promise.all([
          supabase.from('table_reservations').select('id', { count: 'exact', head: true }),
          supabase.from('table_reservations').select('id', { count: 'exact', head: true }).eq('status', 'refunded'),
        ]);
        const { data: revData } = await supabase.from('table_reservations').select('total_price').in('status', ['paid', 'confirmed']);
        const revenue = (revData || []).reduce((sum, o) => sum + (o.total_price || 0), 0);
        setKpis({ total: total ?? 0, revenue, refunds: refunds ?? 0 });
      }
    };
    loadKpis();
  }, [tab]);

  const load = useCallback(async () => {
    setLoading(true);

    if (tab === 'drinks') {
      let query = supabase.from('orders').select('id, user_email, venue_id, total, status, created_at, items', { count: 'exact' });
      if (search) query = query.ilike('user_email', `%${search}%`);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data, count } = await query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      setData(data || []);
      setCount(count ?? 0);
    } else if (tab === 'tickets') {
      let query = supabase.from('tickets').select('id, user_email, event_id, total_price, status, created_at, full_name', { count: 'exact' });
      if (search) query = query.ilike('user_email', `%${search}%`);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data: ticketData, count } = await query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (ticketData && ticketData.length > 0) {
        const eventIds = [...new Set(ticketData.map(t => t.event_id))];
        const { data: evts } = await supabase.from('events').select('id, title, venue_id').in('id', eventIds);
        const evtMap = Object.fromEntries((evts || []).map(e => [e.id, e]));
        setData(ticketData.map(t => ({ ...t, eventTitle: evtMap[t.event_id]?.title, venue_id: evtMap[t.event_id]?.venue_id })));
      } else {
        setData([]);
      }
      setCount(count ?? 0);
    } else {
      let query = supabase.from('table_reservations').select('id, user_email, full_name, zone_id, total_price, status, created_at, event_id', { count: 'exact' });
      if (search) query = query.ilike('user_email', `%${search}%`);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data: tableData, count } = await query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (tableData && tableData.length > 0) {
        const zoneIds = [...new Set(tableData.map(t => t.zone_id))];
        const { data: zones } = await supabase.from('table_zones').select('id, name, venue_id').in('id', zoneIds);
        const zoneMap = Object.fromEntries((zones || []).map(z => [z.id, z]));
        setData(tableData.map(t => ({ ...t, zoneName: zoneMap[t.zone_id]?.name, venue_id: zoneMap[t.zone_id]?.venue_id })));
      } else {
        setData([]);
      }
      setCount(count ?? 0);
    }

    setLoading(false);
  }, [tab, search, statusFilter, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [tab, search, statusFilter]);

  const totalPages = Math.ceil(count / PAGE_SIZE);

  const statusColors: Record<string, string> = {
    paid: 'success', confirmed: 'success', served: 'outline', pending: 'warning', refunded: 'destructive', cancelled: 'destructive',
  };

  const kpiCards = useMemo(() => [
    { label: t('admin.orders.totalTransactions'), value: kpis.total.toLocaleString(), icon: ShoppingCart },
    { label: t('admin.orders.totalRevenue'), value: `${kpis.revenue.toFixed(2)} €`, icon: TrendingUp },
    { label: t('admin.orders.totalRefunds'), value: kpis.refunds.toLocaleString(), icon: RotateCcw },
  ], [kpis, t]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('admin.orders.title')}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t('admin.orders.subtitle')}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {kpiCards.map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <div className="rounded-lg bg-muted p-2.5">
              <kpi.icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
              <p className="text-lg font-bold text-foreground">{kpi.value}</p>
            </div>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="drinks" className="gap-1.5"><Wine className="h-4 w-4" />{t('admin.orders.drinks')}</TabsTrigger>
          <TabsTrigger value="tickets" className="gap-1.5"><Ticket className="h-4 w-4" />{t('admin.orders.tickets')}</TabsTrigger>
          <TabsTrigger value="tables" className="gap-1.5"><Armchair className="h-4 w-4" />{t('admin.orders.tables')}</TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder={t('admin.orders.searchEmail')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('admin.orders.allStatuses')}</SelectItem>
              <SelectItem value="paid">{t('admin.orders.paid')}</SelectItem>
              <SelectItem value="confirmed">{t('admin.orders.confirmed')}</SelectItem>
              <SelectItem value="pending">{t('admin.orders.pending')}</SelectItem>
              <SelectItem value="served">{t('admin.orders.served')}</SelectItem>
              <SelectItem value="refunded">{t('admin.orders.refunded')}</SelectItem>
              <SelectItem value="cancelled">{t('admin.orders.cancelled')}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
          <span className="text-sm text-muted-foreground">{count} {t('admin.orders.results')}</span>
        </div>

        <div className="rounded-lg border border-border overflow-hidden mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.orders.email')}</TableHead>
                {(tab === 'tickets' || tab === 'tables') && <TableHead>{t('admin.orders.name')}</TableHead>}
                <TableHead>{t('admin.orders.venue')}</TableHead>
                {tab === 'tickets' && <TableHead>{t('admin.orders.event')}</TableHead>}
                {tab === 'tables' && <TableHead>{t('admin.orders.zone')}</TableHead>}
                <TableHead>{t('admin.orders.amount')}</TableHead>
                <TableHead>{t('admin.orders.status')}</TableHead>
                <TableHead>{t('admin.orders.date')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t('admin.orders.loading')}</TableCell></TableRow>
              ) : data.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t('admin.orders.noResults')}</TableCell></TableRow>
              ) : data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm max-w-[180px] truncate">{item.user_email || '—'}</TableCell>
                  {(tab === 'tickets' || tab === 'tables') && <TableCell className="text-sm">{item.full_name || '—'}</TableCell>}
                  <TableCell className="text-sm text-muted-foreground">{venues[item.venue_id] || '—'}</TableCell>
                  {tab === 'tickets' && <TableCell className="text-sm">{item.eventTitle || '—'}</TableCell>}
                  {tab === 'tables' && <TableCell className="text-sm">{item.zoneName || '—'}</TableCell>}
                  <TableCell className="font-medium">{(item.total || item.total_price || 0).toFixed(2)} €</TableCell>
                  <TableCell>
                    <Badge variant={(statusColors[item.status] || 'outline') as any}>{item.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(item.created_at), 'dd/MM/yy HH:mm')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <Pagination className="mt-4">
            <PaginationContent>
              <PaginationItem><PaginationPrevious onClick={() => setPage(p => Math.max(0, p - 1))} className={page === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} /></PaginationItem>
              <PaginationItem><span className="text-sm text-muted-foreground px-3">{page + 1} / {totalPages}</span></PaginationItem>
              <PaginationItem><PaginationNext onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} className={page >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} /></PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </Tabs>
    </div>
  );
}
