/** Soirées à modérer : tri, recherche, trois filtres, gestes existants par motif. */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge, DataTable, Kpi, KpiRow, Page, ReasonDialog, Status, useAdminFilters, useAdminT, type ColumnDef, type Tone } from '@/admin/ui';
import { fmtDate, fmtNum } from '@/lib/adminFormat';
import { canAdminRepublish, discoveryBlockers } from '@/lib/adminEventDiscovery';

interface Ev {
  id: string; title: string | null; start_at: string; end_at: string | null; venue_id: string | null; partner_venue_id: string | null;
  location_name: string | null; location_city: string | null; discovery_status: string | null; visibility: string | null;
  is_discoverable: boolean; is_active: boolean; status: string; is_bde: boolean | null; organizer_user_id: string | null;
  event_kind: string | null; poster_url: string | null; description: string | null;
}
type Filter = 'all' | 'upcoming' | 'pending' | 'cancelled';
const FILTERS: Filter[] = ['all', 'upcoming', 'pending', 'cancelled'];
type Act = { kind: 'approve' | 'reject' | 'publish' | 'unpublish' | 'cancel'; ev: Ev };

async function load(): Promise<{ rows: Ev[]; venues: Record<string, string>; demo: string[] }> {
  const [ev, vs, de] = await Promise.all([
    supabase.from('events').select('id, title, start_at, end_at, venue_id, partner_venue_id, location_name, location_city, discovery_status, visibility, is_discoverable, is_active, status, is_bde, organizer_user_id, event_kind, poster_url, description').is('external_source', null).order('start_at', { ascending: false }).limit(2000),
    supabase.from('venues').select('id, name'),
    supabase.rpc('demo_event_ids' as never),
  ]);
  if (ev.error) throw new Error(ev.error.message);
  return {
    rows: (ev.data ?? []) as Ev[],
    venues: Object.fromEntries(((vs.data ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name])),
    demo: (de.data as unknown as string[] | null) ?? [],
  };
}

export default function EventsPage() {
  const { t, lang } = useAdminT();
  const { includeDemo } = useAdminFilters();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const filter = (FILTERS as string[]).includes(sp.get('f') ?? '') ? (sp.get('f') as Filter) : 'all';
  const q = useQuery({ queryKey: ['adm-clients-events'], queryFn: load });
  const [act, setAct] = useState<Act | null>(null);

  const demo = useMemo(() => new Set(q.data?.demo ?? []), [q.data]);
  const visible = useMemo(() => (q.data?.rows ?? []).filter((e) => includeDemo || !demo.has(e.id)), [q.data, demo, includeDemo]);
  const now = Date.now();
  const upcoming = (e: Ev) => new Date(e.end_at ?? e.start_at).getTime() >= now && e.status !== 'cancelled';
  const rows = useMemo(() => visible.filter((e) => {
    if (filter === 'upcoming') return upcoming(e);
    if (filter === 'pending') return e.discovery_status === 'pending' && e.status !== 'cancelled';
    if (filter === 'cancelled') return e.status === 'cancelled';
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [visible, filter]);
  const counts = { all: visible.length, upcoming: visible.filter(upcoming).length, pending: visible.filter((e) => e.discovery_status === 'pending' && e.status !== 'cancelled').length, cancelled: visible.filter((e) => e.status === 'cancelled').length };

  const venues = q.data?.venues ?? {};
  const where = (e: Ev) => venues[e.venue_id ?? e.partner_venue_id ?? ''] ?? e.location_name ?? e.location_city ?? '—';
  const state = (e: Ev): { label: string; tone: Tone; why?: string } => {
    if (e.status === 'cancelled') return { label: t('adm.events.st.cancelled'), tone: 'negative' };
    if (e.is_discoverable && e.is_active && e.status === 'active') return { label: t('adm.events.st.live'), tone: 'positive' };
    const b = discoveryBlockers(e, demo.has(e.id));
    if (b[0] === 'rejected') return { label: t('adm.events.st.rejectedByYuno'), tone: 'negative', why: b.slice(1).map((k) => t(`adm.events.why.${k}`)).join(' · ') || undefined };
    if (b.length === 1 && b[0] === 'private') return { label: t('adm.events.st.private'), tone: 'neutral' };
    if (b.length > 0) return { label: t('adm.events.st.outOfExplore'), tone: 'warning', why: b.map((k) => t(`adm.events.why.${k}`)).join(' · ') };
    return { label: t('adm.events.st.depublished'), tone: 'neutral' };
  };

  const cols: ColumnDef<Ev>[] = [
    { accessorKey: 'title', header: t('adm.cl.ev.col.event'), cell: (c) => {
      const e = c.row.original;
      return (
        <div className="flex max-w-[320px] items-center gap-2">
          <span className="a-t1 truncate font-medium">{e.title ?? '—'}</span>
          {demo.has(e.id) && <Badge tone="accent">{t('adm.events.demo')}</Badge>}
          {e.is_bde && <Badge>{t('adm.events.assoPill')}</Badge>}
          <a href={`/event/${e.id}`} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()} aria-label={t('adm.common.seePage')}><ExternalLink className="a-t3 h-3 w-3" /></a>
        </div>
      );
    } },
    { id: 'where', header: t('adm.cl.ev.col.where'), accessorFn: where },
    { accessorKey: 'start_at', header: t('adm.cl.ev.col.date'), cell: (c) => fmtDate(c.getValue<string>(), lang, 'datetime') },
    { id: 'moderation', header: t('adm.cl.ev.col.moderation'), accessorFn: (e) => e.discovery_status ?? '', cell: (c) => {
      const s = c.getValue<string>();
      return s ? <Badge tone={s === 'approved' ? 'positive' : s === 'rejected' ? 'negative' : 'accent'}>{t(`adm.events.mod.${s}`)}</Badge> : <span className="a-t3">—</span>;
    } },
    { id: 'state', header: t('adm.cl.ev.col.state'), accessorFn: (e) => state(e).label, cell: (c) => {
      const s = state(c.row.original);
      return <div className="flex flex-col items-start gap-0.5"><Status tone={s.tone}>{s.label}</Status>{s.why && <span className="a-t3 max-w-[220px] text-[11.5px] leading-snug">{s.why}</span>}</div>;
    } },
    { id: 'actions', header: '', enableSorting: false, meta: { align: 'right' }, cell: (c) => {
      const e = c.row.original; const cancelled = e.status === 'cancelled';
      return (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {e.discovery_status === 'pending' && !cancelled && (<>
            <button type="button" className="a-btn a-btn--sm a-btn--primary" onClick={() => setAct({ kind: 'approve', ev: e })}>{t('adm.events.approve')}</button>
            <button type="button" className="a-btn a-btn--sm" onClick={() => setAct({ kind: 'reject', ev: e })}>{t('adm.events.reject')}</button>
          </>)}
          {!cancelled && e.is_discoverable && <button type="button" className="a-btn a-btn--sm" onClick={() => setAct({ kind: 'unpublish', ev: e })}>{t('adm.events.unpublish')}</button>}
          {canAdminRepublish(e) && <button type="button" className="a-btn a-btn--sm" onClick={() => setAct({ kind: 'publish', ev: e })}>{t('adm.events.republish')}</button>}
          <button type="button" className="a-btn a-btn--sm a-btn--danger" disabled={cancelled} onClick={() => setAct({ kind: 'cancel', ev: e })}>{t('adm.events.cancel')}</button>
        </div>
      );
    } },
  ];

  const confirm = async (reason: string) => {
    if (!act) return;
    const { kind, ev } = act;
    const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };
    if (kind === 'approve' || kind === 'reject') fail((await supabase.rpc('admin_set_event_discovery_status', { _event_id: ev.id, _status: kind === 'approve' ? 'approved' : 'rejected' })).error);
    else if (kind === 'publish' || kind === 'unpublish') fail((await supabase.rpc('admin_set_event_published', { _event_id: ev.id, _published: kind === 'publish' })).error);
    else fail((await supabase.rpc('admin_cancel_event', { _event_id: ev.id, _reason: reason })).error);
    // Les RPC de publication ne prennent pas de motif : il part au journal d'audit.
    if (kind !== 'cancel') await supabase.rpc('admin_log_action', { _action: `event_${kind}`, _entity_type: 'event', _entity_id: ev.id, _metadata: { reason } });
    toast.success(t(`adm.cl.ev.done.${kind}`));
    await qc.invalidateQueries({ queryKey: ['adm-clients-events'] });
  };

  const initialSearch = sp.get('q') ?? '';
  const searchRows = useMemo(() => {
    const s = initialSearch.trim().toLowerCase();
    return s ? rows.filter((e) => (e.title ?? '').toLowerCase().includes(s) || e.id.toLowerCase() === s) : rows;
  }, [rows, initialSearch]);

  return (
    <Page title={t('adm.cl.ev.title')} subtitle={t('adm.cl.ev.subtitle')}>
      <KpiRow>
        {FILTERS.map((f) => (
          <Kpi key={f} label={t(`adm.cl.ev.f.${f}`)} loading={q.isLoading} value={fmtNum(counts[f], lang)}
            to={`/admin/clients/events${f === 'all' ? '' : `?f=${f}`}`} />
        ))}
      </KpiRow>
      <DataTable data={searchRows} columns={cols} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} searchable
        searchPlaceholder={t('adm.events.search')} getRowId={(e) => e.id} initialSort={[{ id: 'start_at', desc: true }]}
        toolbar={<div className="flex gap-1.5">{FILTERS.map((f) => (
          <button key={f} type="button" className={`a-btn a-btn--sm ${filter === f ? 'a-btn--primary' : ''}`}
            onClick={() => setSp((prev) => { const n = new URLSearchParams(prev); if (f === 'all') n.delete('f'); else n.set('f', f); return n; }, { replace: true })}>
            {t(`adm.cl.ev.f.${f}`)}
          </button>))}</div>}
        empty={{ title: t('adm.events.none') }} />
      {act && (
        <ReasonDialog open onOpenChange={(v) => { if (!v) setAct(null); }} tone={act.kind === 'cancel' || act.kind === 'reject' ? 'danger' : 'primary'}
          title={t(`adm.cl.ev.dlg.${act.kind}`, { title: act.ev.title ?? '' })} description={t(`adm.cl.ev.dlg.${act.kind}.desc`)} onConfirm={confirm} />
      )}
    </Page>
  );
}
