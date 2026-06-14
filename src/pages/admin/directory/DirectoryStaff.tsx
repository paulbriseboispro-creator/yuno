import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { Search, Shield, ShieldOff } from 'lucide-react';
import { format } from 'date-fns';

const PAGE_SIZE = 25;
const STAFF_ROLES = ['barman', 'bouncer', 'vip_host', 'cloakroom', 'manager'] as const;

export default function DirectoryStaff() {
  const { t } = useLanguage();
  const [data, setData] = useState<any[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    // Get staff user_roles with count
    let query = supabase
      .from('user_roles')
      .select('user_id, role, created_at', { count: 'exact' })
      .in('role', ['barman', 'bouncer', 'vip_host', 'cloakroom', 'manager'] as const);

    const { data: roles, count: total } = await query
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (roles && roles.length > 0) {
      const userIds = [...new Set(roles.map(r => r.user_id))];

      // Fetch profiles (never expose employee_pin value, only check existence)
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, first_name, last_name, venue_id, employee_pin')
        .in('id', userIds);

      const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]));

      // Fetch venue names
      const venueIds = [...new Set((profiles || []).map(p => p.venue_id).filter(Boolean))];
      const { data: venues } = venueIds.length > 0
        ? await supabase.from('venues').select('id, name').in('id', venueIds)
        : { data: [] };
      const venueMap = Object.fromEntries((venues || []).map(v => [v.id, v.name]));

      let filtered = roles.map(r => {
        const p = profileMap[r.user_id];
        return {
          id: `${r.user_id}-${r.role}`,
          userId: r.user_id,
          email: p?.email || '—',
          name: p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email : '—',
          role: r.role,
          venueName: p?.venue_id ? (venueMap[p.venue_id] || '—') : '—',
          hasPin: !!p?.employee_pin,
          created_at: r.created_at,
        };
      });

      if (search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(f => f.name.toLowerCase().includes(s) || f.email.toLowerCase().includes(s) || f.venueName.toLowerCase().includes(s));
      }

      setData(filtered);
    } else {
      setData([]);
    }
    setCount(total ?? 0);
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search]);

  const totalPages = Math.ceil(count / PAGE_SIZE);

  const roleLabel = (role: string) => {
    const map: Record<string, string> = { barman: 'Barman', bouncer: 'Bouncer', vip_host: 'VIP Host', cloakroom: t('admin.dir.cloakroom'), manager: 'Manager' };
    return map[role] || role;
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t('admin.dir.searchStaff')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <span className="text-sm text-muted-foreground">{count} {t('admin.dir.results')}</span>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.dir.name')}</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>{t('admin.dir.role')}</TableHead>
              <TableHead>Venue</TableHead>
              <TableHead>PIN</TableHead>
              <TableHead>{t('admin.dir.created')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('admin.dir.loading')}</TableCell></TableRow>
            ) : data.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('admin.dir.noResults')}</TableCell></TableRow>
            ) : data.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">
                  <Link to={`/admin/directory/user/${s.userId}`} className="text-primary hover:underline">{s.name}</Link>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">{s.email}</TableCell>
                <TableCell><Badge variant="outline">{roleLabel(s.role)}</Badge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{s.venueName}</TableCell>
                <TableCell>
                  {s.hasPin ? (
                    <span className="flex items-center gap-1 text-xs text-primary"><Shield className="h-3 w-3" /> PIN set</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground"><ShieldOff className="h-3 w-3" /> No PIN</span>
                  )}
                </TableCell>
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
