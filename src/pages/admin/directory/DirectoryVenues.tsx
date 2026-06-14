import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search, CheckCircle, AlertTriangle, XCircle, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';

const PAGE_SIZE = 25;

export default function DirectoryVenues() {
  const { t } = useLanguage();
  const [data, setData] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('venues')
      .select('id, name, city, owner_id, stripe_account_id, stripe_charges_enabled, stripe_onboarding_complete, created_at', { count: 'exact' });

    if (search) {
      query = query.or(`name.ilike.%${search}%,city.ilike.%${search}%`);
    }

    const { data: venues, count: total } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (venues && venues.length > 0) {
      // Fetch owner emails
      const ownerIds = [...new Set(venues.map(v => v.owner_id).filter(Boolean))];
      const { data: profiles } = ownerIds.length > 0
        ? await supabase.from('profiles').select('id, email').in('id', ownerIds)
        : { data: [] };

      // Fetch onboarding
      const venueIds = venues.map(v => v.id);
      const { data: onboarding } = await supabase
        .from('venue_onboarding')
        .select('venue_id, current_step, completed_at, steps')
        .in('venue_id', venueIds);

      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p.email]));
      const onboardingMap = Object.fromEntries((onboarding || []).map(o => [o.venue_id, o]));

      setData(venues.map(v => ({
        ...v,
        ownerEmail: profileMap[v.owner_id] || '—',
        onboarding: onboardingMap[v.id] || null,
      })));
    } else {
      setData([]);
    }
    setCount(total ?? 0);
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setPage(0); }, [search]);

  const getStripeStatus = (v: any) => {
    if (v.stripe_charges_enabled) return { label: t('admin.dir.stripeConnected'), variant: 'success' as const, icon: CheckCircle };
    if (v.stripe_account_id) return { label: t('admin.dir.stripePending'), variant: 'warning' as const, icon: AlertTriangle };
    return { label: t('admin.dir.stripeMissing'), variant: 'destructive' as const, icon: XCircle };
  };

  const getOnboardingPct = (ob: any) => {
    if (!ob) return 0;
    if (ob.completed_at) return 100;
    const steps = ob.steps as Record<string, boolean> | null;
    if (!steps) return Math.round(((ob.current_step || 0) / 8) * 100);
    const total = Object.keys(steps).length;
    const done = Object.values(steps).filter(Boolean).length;
    return total > 0 ? Math.round((done / total) * 100) : 0;
  };

  const totalPages = Math.ceil(count / PAGE_SIZE);

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('admin.dir.searchVenues')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">{count} {t('admin.dir.results')}</span>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.dir.venueName')}</TableHead>
              <TableHead>{t('admin.dir.city')}</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Stripe</TableHead>
              <TableHead>Onboarding</TableHead>
              <TableHead>{t('admin.dir.created')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('admin.dir.loading')}</TableCell></TableRow>
            ) : data.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('admin.dir.noResults')}</TableCell></TableRow>
            ) : data.map((v) => {
              const stripe = getStripeStatus(v);
              const pct = getOnboardingPct(v.onboarding);
              return (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">
                    <Link to={`/admin/directory/venue/${v.id}`} className="text-primary underline-offset-2 hover:underline inline-flex items-center gap-1">
                      {v.name}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </TableCell>
                  <TableCell>{v.city}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{v.ownerEmail}</TableCell>
                  <TableCell>
                    <Badge variant={stripe.variant} className="gap-1">
                      <stripe.icon className="h-3 w-3" />
                      {stripe.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground">{pct}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(v.created_at), 'dd/MM/yyyy')}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious onClick={() => setPage(p => Math.max(0, p - 1))} className={page === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
            </PaginationItem>
            <PaginationItem>
              <span className="text-sm text-muted-foreground px-3">{page + 1} / {totalPages}</span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} className={page >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
