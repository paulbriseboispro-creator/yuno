import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search } from 'lucide-react';
import { format } from 'date-fns';

const PAGE_SIZE = 25;

export default function DirectoryCustomers() {
  const { t } = useLanguage();
  const [data, setData] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    // Query venue_customers which aggregates per-venue customer stats
    // We'll aggregate across all venues per user
    let query = supabase
      .from('venue_customers')
      .select('user_id, email, first_name, last_name, order_count, ticket_count, total_spent, last_visit_at', { count: 'exact' });

    if (search) {
      query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
    }

    const { data: customers, count: total } = await query
      .order('last_visit_at', { ascending: false, nullsFirst: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    setData(customers || []);
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
          <Input placeholder={t('admin.dir.searchCustomers')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <span className="text-sm text-muted-foreground">{count} {t('admin.dir.results')}</span>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>{t('admin.dir.name')}</TableHead>
              <TableHead>{t('admin.dir.orders')}</TableHead>
              <TableHead>{t('admin.dir.tickets')}</TableHead>
              <TableHead>{t('admin.dir.totalSpent')}</TableHead>
              <TableHead>{t('admin.dir.lastActivity')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('admin.dir.loading')}</TableCell></TableRow>
            ) : data.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('admin.dir.noResults')}</TableCell></TableRow>
            ) : data.map((c, i) => (
              <TableRow key={`${c.user_id}-${i}`}>
                <TableCell className="text-sm max-w-[200px] truncate">
                  {c.user_id ? (
                    <Link to={`/admin/directory/user/${c.user_id}`} className="text-primary hover:underline">{c.email}</Link>
                  ) : c.email}
                </TableCell>
                <TableCell className="font-medium">{`${c.first_name || ''} ${c.last_name || ''}`.trim() || '—'}</TableCell>
                <TableCell>{c.order_count ?? 0}</TableCell>
                <TableCell>{c.ticket_count ?? 0}</TableCell>
                <TableCell>{(c.total_spent ?? 0).toFixed(2)} €</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {c.last_visit_at ? format(new Date(c.last_visit_at), 'dd/MM/yyyy') : '—'}
                </TableCell>
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
