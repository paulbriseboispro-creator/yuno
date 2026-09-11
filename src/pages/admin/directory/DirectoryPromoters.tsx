import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { Card, Pill, TableWrap, Th, Td, EmptyState, Spinner, Kbd, T1, T3 } from '@/components/admin/ui';
import { fmtDate, fmtEur, fmtNum, fmtPlural } from '@/lib/adminFormat';
import { Paginator, SearchBox, safeLike } from './Paginator';

interface Row { id: string; user_id: string | null; first_name: string | null; last_name: string | null; promo_code: string | null; venue_id: string | null; pending_amount: number | null; total_paid: number | null; is_active: boolean; created_at: string; venueName: string; clicks: number; conversions: number }
const PAGE_SIZE = 25;

export default function DirectoryPromoters() {
  const { t, language } = useLanguage();
  const [data, setData] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('promoters').select('id, user_id, first_name, last_name, promo_code, venue_id, pending_amount, total_paid, is_active, created_at', { count: 'exact' });
    const s = safeLike(search);
    if (s) query = query.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,promo_code.ilike.%${s}%`);
    const { data: proms, count: total, error } = await query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) { toast.error(error.message); setLoading(false); return; }
    const rows = proms ?? [];
    const venueIds = [...new Set(rows.map((p) => p.venue_id).filter(Boolean))] as string[];
    const ids = rows.map((p) => p.id);
    // Compteurs par promoteur : une requête `count` par table, jamais les lignes
    // brutes (promoter_clicks est une table de tracking qui grossit sans limite).
    const [venues, ...counts] = await Promise.all([
      venueIds.length ? supabase.from('venues').select('id, name').in('id', venueIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ...ids.flatMap((id) => [
        supabase.from('promoter_clicks').select('id', { count: 'exact', head: true }).eq('promoter_id', id),
        supabase.from('promoter_conversions').select('id', { count: 'exact', head: true }).eq('promoter_id', id),
      ]),
    ]);
    const venueMap = Object.fromEntries((venues.data ?? []).map((v) => [v.id, v.name]));
    setData(rows.map((p, i) => ({
      ...p,
      venueName: p.venue_id ? venueMap[p.venue_id] ?? '—' : '—',
      clicks: (counts[i * 2] as { count: number | null }).count ?? 0,
      conversions: (counts[i * 2 + 1] as { count: number | null }).count ?? 0,
    })));
    setCount(total ?? 0);
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search]);

  return (
    <div className="space-y-4 mt-4">
      <SearchBox value={search} onChange={setSearch} placeholder={t('admin.dir.searchPromoters')} right={<span className="tabular-nums" style={{ color: T3, fontSize: 12.5 }}>{fmtPlural(count, language, t('adm.people.resultsOne'), t('adm.people.results'))}</span>} />
      <Card flush>
        {loading ? <Spinner /> : data.length === 0 ? <EmptyState text={t('admin.dir.noResults')} /> : (
          <TableWrap minWidth={820}>
            <thead><tr><Th>{t('admin.dir.name')}</Th><Th>{t('adm.people.col.code')}</Th><Th>{t('adm.people.col.venue')}</Th><Th right>{t('adm.people.col.clicks')}</Th><Th right>{t('adm.people.col.conversions')}</Th><Th right>{t('adm.people.col.pending')}</Th><Th>{t('adm.people.col.status')}</Th><Th right>{t('admin.dir.created')}</Th></tr></thead>
            <tbody>{data.map((p) => {
              const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—';
              return (
                <tr key={p.id}>
                  <Td strong>{p.user_id ? <Link to={`/admin/people/${p.user_id}`} style={{ color: T1 }} className="hover:underline">{name}</Link> : name}</Td>
                  <Td><Kbd>{p.promo_code ?? '—'}</Kbd></Td>
                  <Td muted>{p.venueName}</Td>
                  <Td right>{fmtNum(p.clicks, language)}</Td>
                  <Td right>{fmtNum(p.conversions, language)}</Td>
                  <Td right strong>{fmtEur(Number(p.pending_amount ?? 0), language)}</Td>
                  <Td><Pill size="xs" tone={p.is_active ? 'pos' : 'muted'}>{p.is_active ? t('admin.dir.active') : t('admin.dir.inactive')}</Pill></Td>
                  <Td right muted>{fmtDate(p.created_at, language)}</Td>
                </tr>
              );
            })}</tbody>
          </TableWrap>
        )}
      </Card>
      <Paginator page={page} totalPages={Math.ceil(count / PAGE_SIZE)} onPage={setPage} />
    </div>
  );
}
