import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';

const PAGE_SIZE = 25;

export default function DirectoryDJs() {
  const { t } = useLanguage();
  const [data, setData] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('djs')
      .select('id, stage_name, first_name, last_name, city, venue_id, is_active, created_at, slug', { count: 'exact' });

    if (search) {
      query = query.or(`stage_name.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%,city.ilike.%${search}%`);
    }

    const { data: djs, count: total } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (djs && djs.length > 0) {
      const djIds = djs.map(d => d.id);
      const venueIds = [...new Set(djs.map(d => d.venue_id).filter(Boolean))];

      const [eventDjs, venues] = await Promise.all([
        supabase.from('event_djs').select('dj_id').in('dj_id', djIds),
        venueIds.length > 0 ? supabase.from('venues').select('id, name').in('id', venueIds) : { data: [] },
      ]);

      const eventCountMap: Record<string, number> = {};
      (eventDjs.data || []).forEach(ed => { eventCountMap[ed.dj_id] = (eventCountMap[ed.dj_id] || 0) + 1; });
      const venueMap = Object.fromEntries((venues.data || []).map(v => [v.id, v.name]));

      setData(djs.map(d => ({
        ...d,
        eventCount: eventCountMap[d.id] || 0,
        venueName: venueMap[d.venue_id] || '—',
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
          <Input placeholder={t('admin.dir.searchDJs')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <span className="text-sm text-muted-foreground">{count} {t('admin.dir.results')}</span>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>DJ</TableHead>
              <TableHead>{t('admin.dir.city')}</TableHead>
              <TableHead>Venue</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>{t('admin.dir.created')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('admin.dir.loading')}</TableCell></TableRow>
            ) : data.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('admin.dir.noResults')}</TableCell></TableRow>
            ) : data.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">
                  {d.slug ? (
                    <a href={`/dj/${d.slug}`} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline inline-flex items-center gap-1">
                      {d.stage_name || `${d.first_name} ${d.last_name}`}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    d.stage_name || `${d.first_name} ${d.last_name}`
                  )}
                </TableCell>
                <TableCell>{d.city || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{d.venueName}</TableCell>
                <TableCell>{d.eventCount}</TableCell>
                <TableCell>
                  <Badge variant={d.is_active ? 'success' : 'secondary'}>{d.is_active ? t('admin.dir.active') : t('admin.dir.inactive')}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{format(new Date(d.created_at), 'dd/MM/yyyy')}</TableCell>
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
