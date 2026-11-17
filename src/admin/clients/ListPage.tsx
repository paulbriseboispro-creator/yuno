/** Tous les clients : liste paginée côté serveur, filtres en puces dans l'adresse, export CSV. */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { Badge, DataTable, Page, Status, useAdminT, type ColumnDef, type Tone } from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum } from '@/lib/adminFormat';
import { rpc, personName, PILLAR_KEYS, SEGMENT_KEYS, TIER_KEYS, type CustomerList, type CustomerRow } from './data';
import { personHref } from './personKey';

const PAGE_SIZE = 25;
const SORTS = ['total_spent', 'last_at', 'first_at', 'visit_nights', 'rev_90d'] as const;
const ACTIVITY = ['active_30d', 'cooling', 'lapsed'] as const;
const REACH = ['email', 'sms', 'push', 'none'] as const;
const YESNO = ['yes', 'no'] as const;

const SEG_TONE: Record<string, Tone> = { champions: 'positive', loyal: 'positive', promising: 'accent', new: 'accent', at_risk: 'warning', dormant: 'neutral', lost: 'negative' };

interface Filters { q: string; segment: string; tier: string; category: string; activity: string; account: string; app: string; reach: string; sort: string; dir: string; page: number }

function args(f: Filters, limit: number, offset: number) {
  return {
    p_segment: f.segment || null, p_tier: f.tier || null, p_category: f.category || null, p_activity: f.activity || null,
    p_search: f.q || null, p_multi_venue: null, p_account: f.account || null, p_app: f.app || null,
    p_reach: f.reach || null, p_tag: null, p_sort: f.sort, p_dir: f.dir, p_limit: limit, p_offset: offset,
  };
}

export default function ListPage() {
  const { t, lang } = useAdminT();
  const [sp, setSp] = useSearchParams();
  const f: Filters = {
    q: sp.get('q') ?? '', segment: sp.get('segment') ?? '', tier: sp.get('tier') ?? '', category: sp.get('category') ?? '',
    activity: sp.get('activity') ?? '', account: sp.get('account') ?? '', app: sp.get('app') ?? '', reach: sp.get('reach') ?? '',
    sort: (SORTS as readonly string[]).includes(sp.get('sort') ?? '') ? (sp.get('sort') as string) : 'total_spent',
    dir: sp.get('dir') === 'asc' ? 'asc' : 'desc', page: Math.max(0, Number(sp.get('page') ?? 0) || 0),
  };
  const set = (patch: Record<string, string | null>) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    if (!('page' in patch)) n.delete('page');
    return n;
  }, { replace: true });

  // La recherche part 350 ms après la dernière frappe.
  const [draft, setDraft] = useState(f.q);
  useEffect(() => { setDraft(f.q); }, [f.q]);
  useEffect(() => {
    if (draft === f.q) return;
    const id = setTimeout(() => set({ q: draft.trim() || null }), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const key = JSON.stringify(f);
  const q = useQuery({
    queryKey: ['adm-clients-list', key],
    queryFn: () => rpc<CustomerList>('admin_segmentation_customers', args(f, PAGE_SIZE, f.page * PAGE_SIZE)),
    placeholderData: (prev) => prev,
  });
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns = useMemo<ColumnDef<CustomerRow>[]>(() => [
    { id: 'person', header: t('adm.cl.list.person'), enableSorting: false, cell: (c) => {
      const r = c.row.original; const name = personName(r.first_name, r.last_name);
      return <div className="min-w-0"><div className="a-t1 truncate font-medium">{name || r.email}</div>{name && <div className="a-t3 truncate text-[12px]">{r.email}</div>}</div>;
    } },
    { id: 'segment', header: t('adm.cl.list.segment'), enableSorting: false, cell: (c) => <Badge tone={SEG_TONE[c.row.original.segment] ?? 'neutral'}>{t(`adm.cl.seg.${c.row.original.segment}`)}</Badge> },
    { id: 'tier', header: t('adm.cl.list.tier'), enableSorting: false, cell: (c) => t(`adm.cl.tier.${c.row.original.tier}`) },
    { id: 'spent', header: t('adm.cl.list.spent'), enableSorting: false, meta: { align: 'right' }, cell: (c) => fmtEur(c.row.original.total_spent, lang) },
    { id: 'nights', header: t('adm.cl.list.nights'), enableSorting: false, meta: { align: 'right' }, cell: (c) => fmtNum(c.row.original.visit_nights, lang) },
    { id: 'clubs', header: t('adm.cl.list.clubs'), enableSorting: false, cell: (c) => <span className="a-t2 block max-w-[200px] truncate">{c.row.original.venue_names || '—'}</span> },
    { id: 'last', header: t('adm.cl.list.last'), enableSorting: false, cell: (c) => fmtDate(c.row.original.last_at, lang) },
    { id: 'reach', header: t('adm.cl.list.reach'), enableSorting: false, cell: (c) => {
      const r = c.row.original;
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Status tone={r.has_account ? 'positive' : 'neutral'}>{t(r.has_account ? 'adm.cl.flag.account' : 'adm.cl.flag.noAccount')}</Status>
          {r.has_app && <Status tone="accent">{t('adm.cl.flag.app')}</Status>}
          {r.email_suppressed ? <Status tone="negative">{t('adm.cl.flag.suppressed')}</Status>
            : (r.email_opt_in || r.sms_opt_in) ? <Status tone="positive">{t('adm.cl.flag.joinable')}</Status> : null}
        </div>
      );
    } },
  ], [t, lang]);

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all: CustomerRow[] = [];
      for (let off = 0; off < 4000; off += 500) {
        const part = await rpc<CustomerList>('admin_segmentation_customers', args(f, 500, off));
        if (!part?.rows?.length) break;
        all.push(...part.rows);
        if (all.length >= part.total) break;
      }
      const header = ['email', 'first_name', 'last_name', 'city', 'segment', 'tier', 'category', 'has_account', 'has_app', 'email_opt_in', 'sms_opt_in', 'email_suppressed', 'total_spent', 'rev_90d', 'visit_nights', 'ticket_count', 'table_count', 'guestlist_count', 'venues_count', 'venue_names', 'first_at', 'last_at'];
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [header.join(';'), ...all.map((r) => header.map((h) => esc((r as unknown as Record<string, unknown>)[h])).join(';'))].join('\n');
      const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = `yuno-clients-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  const chip = (param: keyof Filters, label: string, values: readonly string[], text: (v: string) => string) => (
    <select className="a-input a-input--filter" aria-label={label} value={f[param] as string}
      onChange={(e) => set({ [param]: e.target.value || null })}>
      <option value="">{label}</option>
      {values.map((v) => <option key={v} value={v}>{text(v)}</option>)}
    </select>
  );

  const toolbar = (
    <>
      {chip('segment', t('adm.cl.list.segment'), SEGMENT_KEYS, (v) => t(`adm.cl.seg.${v}`))}
      {chip('tier', t('adm.cl.list.tier'), TIER_KEYS, (v) => t(`adm.cl.tier.${v}`))}
      {chip('category', t('adm.cl.list.pillar'), PILLAR_KEYS, (v) => t(`adm.cl.pillar.${v}`))}
      {chip('activity', t('adm.cl.list.activity'), ACTIVITY, (v) => t(`adm.cl.activity.${v}`))}
      {chip('account', t('adm.cl.list.hasAccount'), YESNO, (v) => t(`adm.cl.yn.${v}`))}
      {chip('app', t('adm.cl.list.hasApp'), YESNO, (v) => t(`adm.cl.yn.${v}`))}
      {chip('reach', t('adm.cl.list.joinable'), REACH, (v) => t(`adm.cl.reach.${v}`))}
      <select className="a-input a-input--filter" aria-label={t('adm.cl.list.sort')} value={f.sort} onChange={(e) => set({ sort: e.target.value === 'total_spent' ? null : e.target.value })}>
        {SORTS.map((v) => <option key={v} value={v}>{t(`adm.cl.sort.${v}`)}</option>)}
      </select>
      <button type="button" className="a-btn a-btn--sm" onClick={() => set({ dir: f.dir === 'desc' ? 'asc' : null })} aria-label={t('adm.cl.list.dir')}>
        {f.dir === 'desc' ? '↓' : '↑'}
      </button>
    </>
  );

  return (
    <Page title={t('adm.cl.list.title')} subtitle={t('adm.cl.list.subtitle')}
      actions={<button type="button" className="a-btn" onClick={() => void exportCsv()} disabled={exporting || total === 0}><Download className="h-3.5 w-3.5" />{exporting ? t('adm.ui.working') : t('adm.cl.list.export')}</button>}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] max-w-[360px] flex-1">
            <Search className="a-t3 pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
            <input className="a-input" style={{ paddingLeft: 30 }} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('adm.cl.list.search')} aria-label={t('adm.cl.list.search')} />
          </label>
          {toolbar}
        </div>
        <DataTable data={q.data?.rows ?? null} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}
          pageSize={1000} rowHref={(r) => personHref(r.email)} getRowId={(r) => r.email}
          empty={{ title: t('adm.cl.list.empty') }} />
        <div className="a-t2 flex items-center gap-3 text-[12.5px]">
          <span className="a-num flex-1">{t('adm.cl.list.total', { n: fmtNum(total, lang), page: f.page + 1, pages })}</span>
          <button type="button" className="a-btn a-btn--sm" disabled={f.page <= 0} onClick={() => set({ page: f.page - 1 ? String(f.page - 1) : null })}>{t('adm.ui.table.prev')}</button>
          <button type="button" className="a-btn a-btn--sm" disabled={f.page + 1 >= pages} onClick={() => set({ page: String(f.page + 1) })}>{t('adm.ui.table.next')}</button>
        </div>
      </div>
    </Page>
  );
}
