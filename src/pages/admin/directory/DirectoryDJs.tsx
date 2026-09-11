import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { BadgeCheck, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Card, Pill, Btn, TableWrap, Th, Td, EmptyState, Spinner, T1, T3 } from '@/components/admin/ui';
import { fmtDate, fmtNum, fmtPlural } from '@/lib/adminFormat';
import { Paginator, SearchBox, safeLike } from './Paginator';

interface Row { id: string; user_id: string | null; stage_name: string | null; first_name: string | null; last_name: string | null; city: string | null; venue_id: string | null; is_active: boolean; is_verified: boolean; created_at: string; slug: string | null; eventCount: number; venueName: string }
const PAGE_SIZE = 25;

export default function DirectoryDJs() {
  const { t, language } = useLanguage();
  const [data, setData] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const verifyDj = async (userId: string, next: boolean) => {
    setBusy(userId);
    const { error } = await supabase.rpc('admin_set_dj_verified', { p_dj_user_id: userId, p_verified: next });
    setBusy(null);
    if (error) { toast.error(t('adm.common.actionFailed')); return; }
    setData((prev) => prev.map((d) => (d.user_id === userId ? { ...d, is_verified: next } : d)));
    toast.success(next ? t('adm.people.djVerified') : t('adm.people.djUnverified'));
  };

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('djs').select('id, user_id, stage_name, first_name, last_name, city, venue_id, is_active, is_verified, created_at, slug', { count: 'exact' });
    const s = safeLike(search);
    if (s) query = query.or(`stage_name.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%,city.ilike.%${s}%`);
    const { data: djs, count: total, error } = await query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) { toast.error(error.message); setLoading(false); return; }
    const rows = djs ?? [];
    const venueIds = [...new Set(rows.map((d) => d.venue_id).filter(Boolean))] as string[];
    const [eventDjs, venues] = await Promise.all([
      rows.length ? supabase.from('event_djs').select('dj_id').in('dj_id', rows.map((d) => d.id)) : Promise.resolve({ data: [] as { dj_id: string }[] }),
      venueIds.length ? supabase.from('venues').select('id, name').in('id', venueIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
    const evCount: Record<string, number> = {};
    for (const e of eventDjs.data ?? []) evCount[e.dj_id] = (evCount[e.dj_id] || 0) + 1;
    const venueMap = Object.fromEntries((venues.data ?? []).map((v) => [v.id, v.name]));
    setData(rows.map((d) => ({ ...d, eventCount: evCount[d.id] || 0, venueName: d.venue_id ? venueMap[d.venue_id] ?? '—' : '—' })));
    setCount(total ?? 0);
    setLoading(false);
  }, [page, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search]);

  return (
    <div className="space-y-4 mt-4">
      <SearchBox value={search} onChange={setSearch} placeholder={t('admin.dir.searchDJs')} right={<span className="tabular-nums" style={{ color: T3, fontSize: 12.5 }}>{fmtPlural(count, language, t('adm.people.resultsOne'), t('adm.people.results'))}</span>} />
      <Card flush>
        {loading ? <Spinner /> : data.length === 0 ? <EmptyState text={t('admin.dir.noResults')} /> : (
          <TableWrap minWidth={720}>
            <thead><tr><Th>{t('adm.people.col.dj')}</Th><Th>{t('admin.dir.city')}</Th><Th>{t('adm.people.col.venue')}</Th><Th right>{t('adm.people.col.events')}</Th><Th>{t('adm.people.col.status')}</Th><Th>{t('adm.people.col.verified')}</Th><Th right>{t('admin.dir.created')}</Th></tr></thead>
            <tbody>{data.map((d) => {
              const name = d.stage_name || `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim() || '—';
              return (
                <tr key={d.id}>
                  <Td strong>
                    <div className="flex items-center gap-2">
                      {d.user_id ? <Link to={`/admin/people/${d.user_id}`} style={{ color: T1 }} className="hover:underline">{name}</Link> : <span>{name}</span>}
                      {d.slug && <a href={`/dj/${d.slug}`} target="_blank" rel="noopener noreferrer" title={t('adm.common.seePage')}><ExternalLink className="h-3 w-3" style={{ color: T3 }} /></a>}
                    </div>
                  </Td>
                  <Td>{d.city || '—'}</Td>
                  <Td muted>{d.venueName}</Td>
                  <Td right>{fmtNum(d.eventCount, language)}</Td>
                  <Td><Pill size="xs" tone={d.is_active ? 'pos' : 'muted'}>{d.is_active ? t('admin.dir.active') : t('admin.dir.inactive')}</Pill></Td>
                  <Td>{d.user_id && <Btn size="sm" variant={d.is_verified ? 'primary' : 'ghost'} icon={BadgeCheck} loading={busy === d.user_id} onClick={() => verifyDj(d.user_id!, !d.is_verified)} title={d.is_verified ? t('adm.people.unverifyTitle') : t('adm.people.verifyTitle')}>{d.is_verified ? t('adm.people.verified') : t('adm.people.verify')}</Btn>}</Td>
                  <Td right muted>{fmtDate(d.created_at, language)}</Td>
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
