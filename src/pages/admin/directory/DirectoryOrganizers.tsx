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

export default function DirectoryOrganizers() {
  const { t } = useLanguage();
  const [data, setData] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('organizer_profiles')
      .select('user_id, display_name, slug, avatar_url, is_public, created_at', { count: 'exact' });

    if (search) {
      query = query.ilike('display_name', `%${search}%`);
    }

    const { data: orgs, count: total } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (orgs && orgs.length > 0) {
      const userIds = orgs.map(o => o.user_id);

      const [eventsRes, partnersRes] = await Promise.all([
        supabase.from('events').select('organizer_user_id').in('organizer_user_id', userIds),
        supabase.from('venue_organizer_partnerships').select('organizer_user_id, venue_id').in('organizer_user_id', userIds).eq('status', 'active'),
      ]);

      const eventCountMap: Record<string, number> = {};
      (eventsRes.data || []).forEach(e => {
        if (e.organizer_user_id) eventCountMap[e.organizer_user_id] = (eventCountMap[e.organizer_user_id] || 0) + 1;
      });

      const venueCountMap: Record<string, number> = {};
      const seen = new Set<string>();
      (partnersRes.data || []).forEach(p => {
        const key = `${p.organizer_user_id}-${p.venue_id}`;
        if (!seen.has(key)) {
          seen.add(key);
          venueCountMap[p.organizer_user_id] = (venueCountMap[p.organizer_user_id] || 0) + 1;
        }
      });

      setData(orgs.map(o => ({
        ...o,
        eventCount: eventCountMap[o.user_id] || 0,
        venueCount: venueCountMap[o.user_id] || 0,
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
          <Input placeholder={t('admin.dir.searchOrganizers')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <span className="text-sm text-muted-foreground">{count} {t('admin.dir.results')}</span>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.dir.name')}</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Venues</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>{t('admin.dir.created')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t('admin.dir.loading')}</TableCell></TableRow>
            ) : data.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t('admin.dir.noResults')}</TableCell></TableRow>
            ) : data.map((o) => (
              <TableRow key={o.user_id}>
                <TableCell className="font-medium">
                  {o.slug ? (
                    <a href={`/o/${o.slug}`} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline inline-flex items-center gap-1">
                      {o.display_name}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    o.display_name
                  )}
                </TableCell>
                <TableCell>{o.eventCount}</TableCell>
                <TableCell>{o.venueCount}</TableCell>
                <TableCell>
                  <Badge variant={o.is_public ? 'success' : 'secondary'}>{o.is_public ? t('admin.dir.active') : t('admin.dir.inactive')}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{format(new Date(o.created_at), 'dd/MM/yyyy')}</TableCell>
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
