import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { toast } from 'sonner';
import { ArrowRight, RefreshCw, ScrollText } from 'lucide-react';
import { AdminPage, Card, Btn, Pill, Seg, TableWrap, Th, Td, EmptyState, Spinner, Kbd, T1, T3 } from '@/components/admin/ui';
import { fmtDate, fmtNum, fmtPlural } from '@/lib/adminFormat';
import { Paginator, SearchBox, safeLike } from './directory/Paginator';

interface AuditRow { id: string; admin_id: string | null; action: string; entity_type: string | null; entity_id: string | null; metadata: Record<string, unknown> | null; created_at: string }
type Family = 'all' | 'destructive' | 'warn';
type Range = '7d' | '30d' | 'all';
const PAGE_SIZE = 40;
// Taxonomie réelle des actions écrites (SQL log_admin_action, edges, front).
const DESTRUCTIVE = ['user_suspended', 'event_cancelled', 'user_mfa_reset', 'venue_purged', 'venue_decommissioned', 'organizer_deleted', 'role_admin_revoked', 'refund_issued'];
const WARN_ACTIONS = ['event_depublished', 'role_admin_granted', 'event_discovery_rejected', 'password_reset_sent', 'showcase_owner_created', 'showcase_organizer_created', 'organizer_bde_unverified', 'dj_unverified'];

function targetLink(type: string | null, id: string | null): string | null {
  if (!id) return null;
  switch (type) {
    case 'user': case 'profile': case 'organizer': case 'dj': return `/admin/people/${id}`;
    case 'venue': return `/admin/venues/${id}`;
    case 'event': return '/admin/events';
    case 'ticket': case 'order': case 'table_reservation': return '/admin/orders';
    default: return null;
  }
}

export default function AdminAuditLog() {
  const { t, language } = useLanguage();
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState<Family>('all');
  const [range, setRange] = useState<Range>('30d');
  const [data, setData] = useState<AuditRow[]>([]);
  const [admins, setAdmins] = useState<Record<string, string>>({});
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('admin_audit_log').select('id, admin_id, action, entity_type, entity_id, metadata, created_at', { count: 'exact' });
    const s = safeLike(search);
    if (s) query = query.or(`action.ilike.%${s}%,entity_type.ilike.%${s}%,entity_id.ilike.%${s}%`);
    if (family === 'destructive') query = query.in('action', DESTRUCTIVE);
    if (family === 'warn') query = query.in('action', WARN_ACTIONS);
    if (range !== 'all') { const from = new Date(); from.setDate(from.getDate() - (range === '7d' ? 7 : 30)); query = query.gte('created_at', from.toISOString()); }
    const { data: rows, count: total, error } = await query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) { toast.error(error.message); setLoading(false); return; }
    const list = (rows ?? []) as AuditRow[];
    setData(list); setCount(total ?? 0);
    const adminIds = [...new Set(list.map((r) => r.admin_id).filter(Boolean))] as string[];
    if (adminIds.length) { const { data: profs } = await supabase.from('profiles').select('id, email').in('id', adminIds); setAdmins(Object.fromEntries((profs ?? []).map((p) => [p.id, p.email ?? p.id]))); }
    setLoading(false);
  }, [search, family, range, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, family, range]);

  const aLabel = (a: string) => { const k = `adm.audit.a.${a}`; const v = t(k); return v === k ? null : v; };
  const details = (m: Record<string, unknown> | null) => {
    if (!m) return '—';
    const parts: string[] = [];
    for (const [k, v] of Object.entries(m)) { if (v === null || v === undefined || v === '') continue; parts.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`); }
    return parts.length ? parts.join(' · ') : '—';
  };

  return (
    <AdminPage eyebrow={t('adm.audit.eyebrow')} title={t('adm.audit.title')} subtitle={t('adm.audit.subtitle')}
      actions={<><Seg<Range> size="sm" value={range} onChange={setRange} options={[{ key: '7d', label: t('adm.audit.f.7d') }, { key: '30d', label: t('adm.audit.f.30d') }, { key: 'all', label: t('adm.audit.f.allTime') }]} /><Btn onClick={load} icon={RefreshCw} loading={loading}>{t('adm.common.refresh')}</Btn></>}>
      <SearchBox value={search} onChange={setSearch} placeholder={t('adm.audit.search')} right={<>
        <Seg<Family> size="sm" value={family} onChange={setFamily} options={[{ key: 'all', label: t('adm.audit.f.all') }, { key: 'destructive', label: t('adm.audit.f.destructive') }, { key: 'warn', label: t('adm.audit.f.warn') }]} />
        <span className="tabular-nums" style={{ color: T3, fontSize: 12.5 }}>{fmtPlural(count, language, t('adm.audit.entriesOne'), t('adm.audit.entries'))}</span>
      </>} />
      <Card flush>
        {loading ? <Spinner /> : data.length === 0 ? <EmptyState icon={ScrollText} text={t('adm.audit.none')} /> : (
          <TableWrap minWidth={820}>
            <thead><tr><Th>{t('adm.audit.col.date')}</Th><Th>{t('adm.audit.col.admin')}</Th><Th>{t('adm.audit.col.action')}</Th><Th>{t('adm.audit.col.target')}</Th><Th>{t('adm.audit.col.details')}</Th></tr></thead>
            <tbody>{data.map((row) => {
              const link = targetLink(row.entity_type, row.entity_id);
              const label = aLabel(row.action);
              const tone = DESTRUCTIVE.includes(row.action) ? 'neg' : WARN_ACTIONS.includes(row.action) ? 'accent' : 'default';
              return (
                <tr key={row.id}>
                  <Td muted style={{ whiteSpace: 'nowrap' }}>{fmtDate(row.created_at, language, 'datetime')}</Td>
                  <Td className="max-w-[200px] truncate">{row.admin_id ? (admins[row.admin_id] ?? row.admin_id.slice(0, 8)) : '—'}</Td>
                  <Td><div className="flex items-center gap-2 flex-wrap"><Pill size="xs" tone={tone}>{label ?? row.action}</Pill>{label && <Kbd>{row.action}</Kbd>}</div></Td>
                  <Td>{row.entity_type && <span style={{ color: T3 }}>{row.entity_type} </span>}{row.entity_id ? (link ? <Link to={link} className="hover:underline" style={{ color: T1 }}>{row.entity_id.slice(0, 8)}</Link> : <span>{row.entity_id.slice(0, 8)}</span>) : '—'}</Td>
                  <Td muted className="max-w-[360px] truncate" title={details(row.metadata)}>{details(row.metadata)}</Td>
                </tr>
              );
            })}</tbody>
          </TableWrap>
        )}
      </Card>
      <Paginator page={page} totalPages={Math.ceil(count / PAGE_SIZE)} onPage={setPage} />
      <p style={{ color: T3, fontSize: 11 }}>{t('adm.audit.supportNote')} <Link to="/admin/support" className="inline-flex items-center gap-1 hover:underline" style={{ color: T1 }}><ArrowRight className="h-3 w-3" />{t('adm.nav.support')}</Link></p>
    </AdminPage>
  );
}
