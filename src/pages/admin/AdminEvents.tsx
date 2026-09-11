import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAdminScope } from '@/components/admin/AdminScope';
import { toast } from 'sonner';
import { Ban, CalendarDays, Check, Clock, ExternalLink, Eye, EyeOff, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { AdminPage, Card, Stat, Btn, Pill, Modal, Field, TableWrap, Th, Td, EmptyState, Spinner, INPUT_STYLE, T1, T3 } from '@/components/admin/ui';
import { fmtDate, fmtNum, fmtPlural } from '@/lib/adminFormat';
import { Paginator, SearchBox } from './directory/Paginator';

interface EventRow { id: string; title: string | null; start_at: string; end_at: string | null; venue_id: string | null; partner_venue_id: string | null; location_name: string | null; location_city: string | null; discovery_status: string | null; visibility: string | null; is_discoverable: boolean; is_active: boolean; status: string; is_bde: boolean | null; slug: string | null; organizer_user_id: string | null }
type Mod = 'all' | 'pending' | 'approved' | 'rejected';
type St = 'all' | 'upcoming' | 'live' | 'depublished' | 'cancelled';
const PAGE_SIZE = 25;

export default function AdminEvents() {
  const { t, language } = useLanguage();
  const { includeDemo } = useAdminScope();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const [mod, setMod] = useState<Mod>('all');
  const [st, setSt] = useState<St>('all');
  const [rows, setRows] = useState<EventRow[]>([]);
  const [venues, setVenues] = useState<Record<string, string>>({});
  const [demo, setDemo] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<EventRow | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    // La table est petite (une centaine de lignes) : on charge tout et on
    // filtre / pagine côté client. La porte démo vient de demo_event_ids(),
    // jamais d'un `not.in` de 100 uuids dans l'URL PostgREST.
    const [ev, vs, de] = await Promise.all([
      supabase.from('events').select('id, title, start_at, end_at, venue_id, partner_venue_id, location_name, location_city, discovery_status, visibility, is_discoverable, is_active, status, is_bde, slug, organizer_user_id').order('start_at', { ascending: false }).limit(2000),
      supabase.from('venues').select('id, name'),
      supabase.rpc('demo_event_ids' as never),
    ]);
    if (ev.error) toast.error(ev.error.message);
    setRows((ev.data ?? []) as EventRow[]);
    setVenues(Object.fromEntries(((vs.data ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name])));
    setDemo(new Set(((de.data as unknown as string[] | null) ?? [])));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, mod, st, includeDemo]);

  const now = Date.now();
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((e) => {
      if (!includeDemo && demo.has(e.id)) return false;
      if (s && !(e.title ?? '').toLowerCase().includes(s)) return false;
      if (mod !== 'all' && e.discovery_status !== mod) return false;
      if (st === 'cancelled' && e.status !== 'cancelled') return false;
      if (st === 'live' && !(e.status === 'active' && e.is_discoverable && e.is_active)) return false;
      if (st === 'depublished' && (e.is_discoverable || e.status === 'cancelled')) return false;
      if (st === 'upcoming' && new Date(e.end_at ?? e.start_at).getTime() < now) return false;
      return true;
    });
  }, [rows, demo, includeDemo, search, mod, st, now]);
  const visible = includeDemo ? rows : rows.filter((e) => !demo.has(e.id));
  const kpis = { total: visible.length, upcoming: visible.filter((e) => new Date(e.end_at ?? e.start_at).getTime() >= now && e.status !== 'cancelled').length, pending: visible.filter((e) => e.discovery_status === 'pending').length, cancelled: visible.filter((e) => e.status === 'cancelled').length };
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const run = async (id: string, fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(id);
    const { error } = await fn();
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(ok); load();
  };
  const togglePublish = (ev: EventRow) => {
    const publish = !ev.is_discoverable;
    if (!publish && !window.confirm(t('adm.events.confirmUnpublish').replace('{t}', ev.title ?? ''))) return;
    run(ev.id, () => supabase.rpc('admin_set_event_published', { _event_id: ev.id, _published: publish }), publish ? t('adm.events.published') : t('adm.events.unpublished'));
  };
  const setDiscovery = (ev: EventRow, status: 'approved' | 'rejected') =>
    run(ev.id, () => supabase.rpc('admin_set_event_discovery_status', { _event_id: ev.id, _status: status }), status === 'approved' ? t('adm.events.approved') : t('adm.events.rejected'));
  const confirmCancel = async () => {
    if (!cancelTarget) return;
    const ev = cancelTarget; setCancelTarget(null);
    await run(ev.id, () => supabase.rpc('admin_cancel_event', { _event_id: ev.id, _reason: reason.trim() || null }), t('adm.events.cancelledOk'));
    setReason('');
  };

  const modLabel = (s: string | null) => (s ? t(`adm.events.mod.${s}`) : t('adm.events.mod.none'));
  const where = (e: EventRow) => venues[e.venue_id ?? e.partner_venue_id ?? ''] ?? e.location_name ?? e.location_city ?? '—';
  const state = (e: EventRow): { label: string; tone: 'neg' | 'pos' | 'muted' | 'default' } => e.status === 'cancelled' ? { label: t('adm.events.st.cancelled'), tone: 'neg' } : e.visibility && e.visibility !== 'public' ? { label: t('adm.events.st.private'), tone: 'default' } : e.is_discoverable && e.is_active && e.status === 'active' ? { label: t('adm.events.st.live'), tone: 'pos' } : { label: t('adm.events.st.depublished'), tone: 'muted' };

  return (
    <AdminPage eyebrow={t('adm.events.eyebrow')} title={t('adm.events.title')} subtitle={t('adm.events.subtitle')}
      actions={<>{includeDemo && <Pill tone="accent">{t('adm.common.demoIncluded')}</Pill>}<Btn onClick={load} icon={RefreshCw} loading={loading}>{t('adm.common.refresh')}</Btn></>}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat compact label={t('adm.events.total')} value={fmtNum(kpis.total, language)} icon={CalendarDays} highlight />
        <Stat compact label={t('adm.events.upcoming')} value={fmtNum(kpis.upcoming, language)} icon={CalendarDays} />
        <Stat compact label={t('adm.events.pending')} value={fmtNum(kpis.pending, language)} icon={Clock} tone={kpis.pending > 0 ? 'warn' : undefined} />
        <Stat compact label={t('adm.events.cancelled')} value={fmtNum(kpis.cancelled, language)} icon={Ban} tone={kpis.cancelled > 0 ? 'neg' : undefined} />
      </div>

      <SearchBox value={search} onChange={(v) => setParams(v ? { q: v } : {}, { replace: true })} placeholder={t('adm.events.search')} right={<>
        <select value={mod} onChange={(e) => setMod(e.target.value as Mod)} style={{ ...INPUT_STYLE, width: 'auto', minWidth: 150 }}>
          {(['all', 'pending', 'approved', 'rejected'] as Mod[]).map((k) => <option key={k} value={k}>{t(`adm.events.f.${k === 'all' ? 'allMod' : k}`)}</option>)}
        </select>
        <select value={st} onChange={(e) => setSt(e.target.value as St)} style={{ ...INPUT_STYLE, width: 'auto', minWidth: 150 }}>
          {(['all', 'upcoming', 'live', 'depublished', 'cancelled'] as St[]).map((k) => <option key={k} value={k}>{t(`adm.events.f.${k === 'all' ? 'allStates' : k}`)}</option>)}
        </select>
        <span className="tabular-nums" style={{ color: T3, fontSize: 12.5 }}>{fmtPlural(filtered.length, language, t('adm.events.resultsOne'), t('adm.events.results'))}</span>
      </>} />

      <Card flush>
        {loading ? <Spinner /> : pageRows.length === 0 ? <EmptyState icon={CalendarDays} text={t('adm.events.none')} /> : (
          <TableWrap minWidth={900}>
            <thead><tr><Th>{t('adm.events.col.event')}</Th><Th>{t('adm.events.col.where')}</Th><Th>{t('adm.events.col.date')}</Th><Th>{t('adm.events.col.moderation')}</Th><Th>{t('adm.events.col.state')}</Th><Th right>{t('adm.common.actions')}</Th></tr></thead>
            <tbody>{pageRows.map((ev) => {
              const b = busy === ev.id; const s = state(ev);
              return (
                <tr key={ev.id}>
                  <Td strong><div className="flex items-center gap-2 max-w-[300px]"><span className="truncate" style={{ color: T1 }}>{ev.title ?? '—'}</span>{demo.has(ev.id) && <Pill size="xs" tone="accent">{t('adm.events.demo')}</Pill>}{ev.is_bde && <Pill size="xs" tone="muted">BDE</Pill>}<a href={`/event/${ev.id}`} target="_blank" rel="noopener noreferrer" title={t('adm.common.seePage')}><ExternalLink className="h-3 w-3" style={{ color: T3 }} /></a></div></Td>
                  <Td>{where(ev)}</Td>
                  <Td muted style={{ whiteSpace: 'nowrap' }}>{fmtDate(ev.start_at, language, 'datetime')}</Td>
                  <Td>{ev.discovery_status ? <Pill size="xs" tone={ev.discovery_status === 'approved' ? 'pos' : ev.discovery_status === 'rejected' ? 'neg' : 'accent'}>{modLabel(ev.discovery_status)}</Pill> : <span style={{ color: T3 }}>—</span>}</Td>
                  <Td><Pill size="xs" tone={s.tone}>{s.label}</Pill></Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {ev.discovery_status === 'pending' && ev.status !== 'cancelled' && (<>
                        <Btn size="sm" variant="primary" icon={Check} loading={b} onClick={() => setDiscovery(ev, 'approved')} title={t('adm.events.approveTitle')}>{t('adm.events.approve')}</Btn>
                        <Btn size="sm" icon={X} disabled={b} onClick={() => setDiscovery(ev, 'rejected')} title={t('adm.events.rejectTitle')}>{t('adm.events.reject')}</Btn>
                      </>)}
                      {ev.status !== 'cancelled' && <Btn size="sm" icon={ev.is_discoverable ? EyeOff : Eye} disabled={b} onClick={() => togglePublish(ev)}>{ev.is_discoverable ? t('adm.events.unpublish') : t('adm.events.republish')}</Btn>}
                      <Btn size="sm" variant="danger" icon={ShieldAlert} disabled={b || ev.status === 'cancelled'} onClick={() => { setReason(''); setCancelTarget(ev); }}>{t('adm.events.cancel')}</Btn>
                    </div>
                  </Td>
                </tr>
              );
            })}</tbody>
          </TableWrap>
        )}
      </Card>
      <Paginator page={page} totalPages={Math.ceil(filtered.length / PAGE_SIZE)} onPage={setPage} />

      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title={t('adm.events.confirmCancelTitle').replace('{t}', cancelTarget?.title ?? '')} subtitle={t('adm.events.confirmCancelHint')}
        footer={<><Btn onClick={() => setCancelTarget(null)}>{t('adm.common.cancel')}</Btn><Btn variant="danger" icon={ShieldAlert} onClick={confirmCancel}>{t('adm.events.cancel')}</Btn></>}>
        <Field label={t('adm.events.cancelReason')}><input value={reason} onChange={(e) => setReason(e.target.value)} style={INPUT_STYLE} /></Field>
      </Modal>
    </AdminPage>
  );
}
