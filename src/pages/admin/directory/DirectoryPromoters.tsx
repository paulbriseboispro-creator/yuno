import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search } from 'lucide-react';
import { format } from 'date-fns';

const PAGE_SIZE = 25;

export default function DirectoryPromoters() {
  const { t } = useLanguage();
  const [data, setData] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('promoters')
      .select('id, first_name, last_name, promo_code, venue_id, pending_amount, total_paid, is_active, created_at', { count: 'exact' });

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,promo_code.ilike.%${search}%`);
    }

    const { data: proms, count: total } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (proms && proms.length > 0) {
      const venueIds = [...new Set(proms.map(p => p.venue_id).filter(Boolean))];
      const promIds = proms.map(p => p.id);

      const [venues, clicks, conversions] = await Promise.all([
        venueIds.length > 0 ? supabase.from('venues').select('id, name').in('id', venueIds) : { data: [] },
        supabase.from('promoter_clicks').select('promoter_id').in('promoter_id', promIds),
        supabase.from('promoter_conversions').select('promoter_id').in('promoter_id', promIds),
      ]);

      const venueMap = Object.fromEntries((venues.data || []).map(v => [v.id, v.name]));
      const clickMap: Record<string, number> = {};
      (clicks.data || []).forEach(c => { clickMap[c.promoter_id] = (clickMap[c.promoter_id] || 0) + 1; });
      const convMap: Record<string, number> = {};
      (conversions.data || []).forEach(c => { convMap[c.promoter_id] = (convMap[c.promoter_id] || 0) + 1; });

      setData(proms.map(p => ({
        ...p,
        venueName: venueMap[p.venue_id] || '—',
        clicks: clickMap[p.id] || 0,
        conversions: convMap[p.id] || 0,
      })));
    } else {
      setData([]);
    }
    setCount(total ?? 0);
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search]);

  const totalPages = Math.ceil(count / PAGE_SIZE);

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t('admin.dir.searchPromoters')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <span className="text-sm text-muted-foreground">{count} {t('admin.dir.results')}</span>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.dir.name')}</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Venue</TableHead>
              <TableHead>Clicks</TableHead>
              <TableHead>Conversions</TableHead>
              <TableHead>{t('admin.dir.commission')}</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>{t('admin.dir.created')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{t('admin.dir.loading')}</TableCell></TableRow>
            ) : data.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{t('admin.dir.noResults')}</TableCell></TableRow>
            ) : data.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.first_name} {p.last_name}</TableCell>
                <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.promo_code}</code></TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.venueName}</TableCell>
                <TableCell>{p.clicks}</TableCell>
                <TableCell>{p.conversions}</TableCell>
                <TableCell className="text-sm">{p.pending_amount.toFixed(2)} €</TableCell>
                <TableCell>
                  <Badge variant={p.is_active ? 'success' : 'secondary'}>{p.is_active ? t('admin.dir.active') : t('admin.dir.inactive')}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{format(new Date(p.created_at), 'dd/MM/yyyy')}</TableCell>
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
