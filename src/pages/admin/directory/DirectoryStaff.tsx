import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Shield, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { Card, Pill, TableWrap, Th, Td, EmptyState, Spinner, POS, T1, T3 } from '@/components/admin/ui';
import { fmtDate, fmtNum, fmtPlural } from '@/lib/adminFormat';
import { Paginator, SearchBox, safeLike } from './Paginator';

interface Row { id: string; userId: string; email: string; name: string; role: string; venueName: string; hasPin: boolean; created_at: string }
const STAFF_ROLES = ['barman', 'bouncer', 'vip_host', 'cloakroom', 'manager'] as const;
const PAGE_SIZE = 25;

export default function DirectoryStaff() {
  const { t, language } = useLanguage();
  const [data, setData] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // Recherche côté serveur : on cherche d'abord les profils, puis leurs rôles
    // staff — sinon la recherche ne filtrait que la page courante.
    const s = safeLike(search);
    let roleQuery = supabase.from('user_roles').select('user_id, role, created_at', { count: 'exact' }).in('role', [...STAFF_ROLES]);
    if (s) {
      const { data: hits, error: he } = await supabase.from('profiles').select('id').or(`email.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%,staff_display_name.ilike.%${s}%`).limit(300);
      if (he) { toast.error(he.message); setLoading(false); return; }
      const ids = (hits ?? []).map((h) => h.id);
      if (ids.length === 0) { setData([]); setCount(0); setLoading(false); return; }
      roleQuery = roleQuery.in('user_id', ids);
    }
    const { data: roles, count: total, error } = await roleQuery.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) { toast.error(error.message); setLoading(false); return; }
    const rows = roles ?? [];
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    // Le PIN lui-même ne quitte jamais la base : on ne lit que l'existence
    // (liste des ids qui en ont un), pas la valeur.
    const [{ data: profiles }, { data: withPin }] = await Promise.all([
      userIds.length ? supabase.from('profiles').select('id, email, first_name, last_name, staff_display_name, venue_id').in('id', userIds) : Promise.resolve({ data: [] as { id: string; email: string | null; first_name: string | null; last_name: string | null; staff_display_name: string | null; venue_id: string | null }[] }),
      userIds.length ? supabase.from('profiles').select('id').in('id', userIds).not('employee_pin', 'is', null) : Promise.resolve({ data: [] as { id: string }[] }),
    ]);
    const pinSet = new Set((withPin ?? []).map((p) => p.id));
    const profileMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));
    const venueIds = [...new Set((profiles ?? []).map((p) => p.venue_id).filter(Boolean))] as string[];
    const { data: venues } = venueIds.length ? await supabase.from('venues').select('id, name').in('id', venueIds) : { data: [] as { id: string; name: string }[] };
    const venueMap = Object.fromEntries((venues ?? []).map((v) => [v.id, v.name]));
    setData(rows.map((r) => {
      const p = profileMap[r.user_id];
      return {
        id: `${r.user_id}-${r.role}`, userId: r.user_id, email: p?.email ?? '—',
        name: p ? (p.staff_display_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || '—') : '—',
        role: r.role, venueName: p?.venue_id ? venueMap[p.venue_id] ?? '—' : '—', hasPin: pinSet.has(r.user_id), created_at: r.created_at,
      };
    }));
    setCount(total ?? 0);
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search]);

  const roleLabel = (role: string) => { const k = `adm.people.role.${role}`; const v = t(k); return v === k ? role : v; };

  return (
    <div className="space-y-4 mt-4">
      <SearchBox value={search} onChange={setSearch} placeholder={t('adm.people.searchStaff')} right={<span className="tabular-nums" style={{ color: T3, fontSize: 12.5 }}>{fmtPlural(count, language, t('adm.people.resultsOne'), t('adm.people.results'))}</span>} />
      <Card flush>
        {loading ? <Spinner /> : data.length === 0 ? <EmptyState text={t('admin.dir.noResults')} /> : (
          <TableWrap minWidth={760}>
            <thead><tr><Th>{t('admin.dir.name')}</Th><Th>{t('adm.common.email')}</Th><Th>{t('adm.people.col.role')}</Th><Th>{t('adm.people.col.venue')}</Th><Th>{t('adm.people.col.pin')}</Th><Th right>{t('admin.dir.created')}</Th></tr></thead>
            <tbody>{data.map((s) => (
              <tr key={s.id}>
                <Td strong><Link to={`/admin/people/${s.userId}`} style={{ color: T1 }} className="hover:underline">{s.name}</Link></Td>
                <Td muted className="max-w-[200px] truncate">{s.email}</Td>
                <Td><Pill size="xs">{roleLabel(s.role)}</Pill></Td>
                <Td muted>{s.venueName}</Td>
                <Td>{s.hasPin ? <span className="inline-flex items-center gap-1" style={{ color: POS, fontSize: 12, fontWeight: 560 }}><Shield className="h-3.5 w-3.5" />{t('adm.people.pinSet')}</span> : <span className="inline-flex items-center gap-1" style={{ color: T3, fontSize: 12 }}><ShieldOff className="h-3.5 w-3.5" />{t('adm.people.noPin')}</span>}</Td>
                <Td right muted>{fmtDate(s.created_at, language)}</Td>
              </tr>
            ))}</tbody>
          </TableWrap>
        )}
      </Card>
      <Paginator page={page} totalPages={Math.ceil(count / PAGE_SIZE)} onPage={setPage} />
    </div>
  );
}
