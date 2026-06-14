import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { CreditCard, CheckCircle, Clock, XCircle, Search } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { PLANS, PlanCode } from '@/lib/planFeatures';

const PAGE_SIZE = 25;

const PLAN_BADGE_COLORS: Record<string, string> = {
  elite: 'bg-purple-600 text-white',
  pro: 'bg-blue-600 text-white',
  essential: 'bg-muted text-foreground',
};

const planLabel = (code: string) => {
  const p = PLANS[code as PlanCode];
  return p ? p.name : code;
};

export default function AdminSubscriptions() {
  const { t } = useLanguage();
  const [data, setData] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [kpis, setKpis] = useState({ active: 0, trialing: 0, expired: 0 });

  // Load KPIs
  useEffect(() => {
    const loadKpis = async () => {
      const [{ count: active }, { count: trialing }, { count: expired }] = await Promise.all([
        supabase.from('venue_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('venue_subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'trialing'),
        supabase.from('venue_subscriptions').select('id', { count: 'exact', head: true }).in('status', ['canceled', 'past_due', 'incomplete']),
      ]);
      setKpis({ active: active ?? 0, trialing: trialing ?? 0, expired: expired ?? 0 });
    };
    loadKpis();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('venue_subscriptions')
      .select('id, venue_id, status, subscription_plan, stripe_subscription_id, current_period_start, current_period_end, trial_end, created_at', { count: 'exact' });

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (planFilter !== 'all') query = query.eq('subscription_plan', planFilter);

    const { data: subs, count: total } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (subs && subs.length > 0) {
      const venueIds = [...new Set(subs.map(s => s.venue_id))];
      const { data: venues } = await supabase.from('venues').select('id, name').in('id', venueIds);
      const venueMap = Object.fromEntries((venues || []).map(v => [v.id, v.name]));
      const enriched = subs.map(s => ({ ...s, venueName: venueMap[s.venue_id] || s.venue_id }));
      if (search) {
        setData(enriched.filter(s => s.venueName.toLowerCase().includes(search.toLowerCase())));
      } else {
        setData(enriched);
      }
    } else {
      setData([]);
    }
    setCount(total ?? 0);
    setLoading(false);
  }, [page, statusFilter, planFilter, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [statusFilter, planFilter, search]);

  const totalPages = Math.ceil(count / PAGE_SIZE);

  const statusColor: Record<string, string> = {
    active: 'success', trialing: 'warning', past_due: 'destructive', canceled: 'outline', incomplete: 'outline',
  };

  const kpiCards = useMemo(() => [
    { label: t('admin.subs.active'), value: kpis.active, icon: CheckCircle, color: 'text-emerald-500' },
    { label: t('admin.subs.trialing'), value: kpis.trialing, icon: Clock, color: 'text-amber-500' },
    { label: t('admin.subs.expired'), value: kpis.expired, icon: XCircle, color: 'text-destructive' },
  ], [kpis, t]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('admin.subs.title')}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t('admin.subs.subtitle')}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {kpiCards.map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <div className="rounded-lg bg-muted p-2.5">
              <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
              <p className="text-lg font-bold text-foreground">{kpi.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t('admin.subs.searchVenue')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.subs.allStatuses')}</SelectItem>
            <SelectItem value="active">{t('admin.subs.active')}</SelectItem>
            <SelectItem value="trialing">{t('admin.subs.trialing')}</SelectItem>
            <SelectItem value="canceled">{t('admin.orders.cancelled')}</SelectItem>
            <SelectItem value="past_due">{t('admin.orders.pending')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={planFilter} onValueChange={setPlanFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.subs.allPlans')}</SelectItem>
            <SelectItem value="essential">Essential</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="elite">Elite</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.subs.venue')}</TableHead>
              <TableHead>{t('admin.subs.plan')}</TableHead>
              <TableHead>{t('admin.subs.status')}</TableHead>
              <TableHead>{t('admin.subs.periodStart')}</TableHead>
              <TableHead>{t('admin.subs.periodEnd')}</TableHead>
              <TableHead>{t('admin.subs.trialEnd')}</TableHead>
              <TableHead>{t('admin.subs.createdAt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t('admin.subs.loading')}</TableCell></TableRow>
            ) : data.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t('admin.subs.noResults')}</TableCell></TableRow>
            ) : data.map(s => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link to={`/admin/directory/venue/${s.venue_id}`} className="font-medium text-primary hover:underline">{s.venueName}</Link>
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${PLAN_BADGE_COLORS[s.subscription_plan] || 'bg-muted text-foreground'}`}>
                    {planLabel(s.subscription_plan)}
                  </span>
                </TableCell>
                <TableCell><Badge variant={(statusColor[s.status] || 'outline') as any}>{s.status}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{s.current_period_start ? format(new Date(s.current_period_start), 'dd/MM/yyyy') : '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{s.current_period_end ? format(new Date(s.current_period_end), 'dd/MM/yyyy') : '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{s.trial_end ? format(new Date(s.trial_end), 'dd/MM/yyyy') : '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{format(new Date(s.created_at), 'dd/MM/yyyy')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem><PaginationPrevious onClick={() => setPage(p => Math.max(0, p - 1))} className={page === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} /></PaginationItem>
            <PaginationItem><span className="text-sm text-muted-foreground px-3">{page + 1} / {totalPages}</span></PaginationItem>
            <PaginationItem><PaginationNext onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} className={page >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} /></PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
