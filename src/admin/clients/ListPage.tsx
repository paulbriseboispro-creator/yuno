/** Tous les clients : liste paginée côté serveur, filtres en puces dans l'adresse, export CSV. */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Download, Search } from 'lucide-react';
import { EmptyState, ErrorState, Page, SplitView, cellTint, useAdminT, Chip, KeyValue, useListKeys } from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum } from '@/lib/adminFormat';
import { rpc, personName, PILLAR_KEYS, SEGMENT_KEYS, TIER_KEYS, type CustomerList, type CustomerRow, type Person } from './data';
import { personHref } from './personKey';

const PAGE_SIZE = 25;
const SORTS = ['total_spent', 'last_at', 'first_at', 'visit_nights', 'rev_90d'] as const;
const ACTIVITY = ['active_30d', 'cooling', 'lapsed'] as const;
const REACH = ['email', 'sms', 'push', 'none'] as const;
const YESNO = ['yes', 'no'] as const;


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
  const pills = (param: 'segment' | 'activity' | 'reach', values: readonly string[], text: (v: string) => string) => values.map((v) => (
    <Chip key={`${param}${v}`} on={f[param] === v} onClick={() => set({ [param]: f[param] === v ? null : v })}>{text(v)}</Chip>
  ));

  const rows = q.data?.rows ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked && rows.some((r) => r.email === picked) ? picked : rows[0]?.email ?? null;
  const navigate = useNavigate();
  const idOf = useCallback((r: CustomerRow) => r.email, []);
  const openRow = useCallback((r: CustomerRow) => navigate(personHref(r.email)), [navigate]);
  useListKeys(rows, idOf, selected, setPicked, openRow);
  const maxSpent = Math.max(0, ...rows.map((r) => r.total_spent));

  return (
    <Page title={t('adm.cl.list.title')} subtitle={t('adm.cl.list.subtitle')}
      actions={<button type="button" className="a-btn" onClick={() => void exportCsv()} disabled={exporting || total === 0}><Download className="h-3.5 w-3.5" />{exporting ? t('adm.ui.working') : t('adm.cl.list.export')}</button>}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">{pills('segment', SEGMENT_KEYS, (v) => t(`adm.cl.seg.${v}`))}</div>
        <div className="flex flex-wrap items-center gap-2">
          {pills('activity', ACTIVITY, (v) => t(`adm.cl.activity.${v}`))}
          <span aria-hidden className="mx-1 h-5 w-px" style={{ background: 'var(--a-border)' }} />
          {pills('reach', REACH, (v) => t(`adm.cl.reach.${v}`))}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <label className="relative min-w-[220px] max-w-[360px] flex-1">
            <Search className="a-t3 pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
            <input className="a-input" style={{ paddingLeft: 30 }} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('adm.cl.list.search')} aria-label={t('adm.cl.list.search')} />
          </label>
          {chip('tier', t('adm.cl.list.tier'), TIER_KEYS, (v) => t(`adm.cl.tier.${v}`))}
          {chip('category', t('adm.cl.list.pillar'), PILLAR_KEYS, (v) => t(`adm.cl.pillar.${v}`))}
          {chip('account', t('adm.cl.list.hasAccount'), YESNO, (v) => t(`adm.cl.yn.${v}`))}
          {chip('app', t('adm.cl.list.hasApp'), YESNO, (v) => t(`adm.cl.yn.${v}`))}
          <select className="a-input a-input--filter" aria-label={t('adm.cl.list.sort')} value={f.sort} onChange={(e) => set({ sort: e.target.value === 'total_spent' ? null : e.target.value })}>
            {SORTS.map((v) => <option key={v} value={v}>{t(`adm.cl.sort.${v}`)}</option>)}
          </select>
          <button type="button" className="a-btn a-btn--sm" onClick={() => set({ dir: f.dir === 'desc' ? 'asc' : null })} aria-label={t('adm.cl.list.dir')}>
            {f.dir === 'desc' ? '↓' : '↑'}
          </button>
          <span className="a-mono a-t3 ml-auto text-[11px]">{t('adm.cl.list.total', { n: fmtNum(total, lang), page: f.page + 1, pages })}</span>
        </div>

        {q.error ? <ErrorState onRetry={() => void q.refetch()} /> : (
          <SplitView
            list={q.isLoading ? <div className="flex flex-col gap-1">{Array.from({ length: 10 }, (_, i) => <div key={i} className="a-skel h-11 w-full" />)}</div>
              : rows.length === 0 ? <EmptyState title={t('adm.cl.list.empty')} /> : (
              <div className="flex flex-col">
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_5.5rem] items-center gap-x-4 border-b px-2 pb-2 md:grid-cols-[minmax(0,1fr)_6.5rem_5.5rem_3rem_5.5rem_4rem]">
                  <span className="a-kicker">{t('adm.cl.list.person')}</span>
                  <span className="a-kicker">{t('adm.cl.list.segment')}</span>
                  <span className="a-kicker text-right">{t('adm.cl.list.spent')}</span>
                  <span className="a-kicker hidden text-right md:block">{t('adm.cl.v3.nightsShort')}</span>
                  <span className="a-kicker hidden text-right md:block">{t('adm.cl.list.last')}</span>
                  <span className="a-kicker hidden md:block">{t('adm.cl.v3.reachShort')}</span>
                </div>
                <ul role="listbox" aria-label={t('adm.cl.list.title')} className="flex flex-col">
                  {rows.map((r) => {
                    const on = r.email === selected; const name = personName(r.first_name, r.last_name);
                    return (
                      <li key={r.email} role="option" aria-selected={on} data-row-id={r.email}>
                        <button type="button" onClick={() => setPicked(r.email)} onDoubleClick={() => openRow(r)}
                          className={`a-focus grid w-full grid-cols-[minmax(0,1fr)_6.5rem_5.5rem] items-center gap-x-4 border-0 border-b bg-transparent px-2 py-2 text-left font-[inherit] hover:bg-[var(--a-hover)] md:grid-cols-[minmax(0,1fr)_6.5rem_5.5rem_3rem_5.5rem_4rem] ${on ? 'a-row-active' : ''}`}
                          style={{ cursor: 'pointer' }}>
                          <span className="min-w-0">
                            <span className="a-t1 block truncate text-[13.5px] font-medium">{name || r.email}</span>
                            <span className="a-t3 block truncate text-[12px]">{name ? r.email : (r.venue_names || '—')}</span>
                          </span>
                          <span className="a-mono truncate text-[10.5px] uppercase tracking-[0.04em]" style={{ color: SEG_INK[r.segment] ?? 'var(--a-text-2)' }}>{t(`adm.cl.seg.${r.segment}`)}</span>
                          <span className="a-num a-t1 rounded-[3px] px-1 text-right text-[12.5px]" style={{ background: cellTint(r.total_spent, maxSpent) }}>{fmtEur(r.total_spent, lang, { cents: false })}</span>
                          <span className="a-num a-t2 hidden text-right text-[12.5px] md:block">{fmtNum(r.visit_nights, lang)}</span>
                          <span className="a-mono a-t3 hidden text-right text-[11px] md:block">{fmtDate(r.last_at, lang)}</span>
                          <span className="hidden items-center gap-1 md:flex"><ReachDots r={r} /></span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            panel={selected ? <PersonPreview key={selected} email={selected} /> : null} />
        )}
        <div className="a-t2 flex items-center gap-3 text-[12.5px]">
          <span className="a-mono a-t3 flex-1 text-[11px]">{t('adm.pros.v3.keys')}</span>
          <button type="button" className="a-btn a-btn--sm" disabled={f.page <= 0} onClick={() => set({ page: f.page - 1 ? String(f.page - 1) : null })}>{t('adm.ui.table.prev')}</button>
          <button type="button" className="a-btn a-btn--sm" disabled={f.page + 1 >= pages} onClick={() => set({ page: String(f.page + 1) })}>{t('adm.ui.table.next')}</button>
        </div>
      </div>
    </Page>
  );
}

/** Segments à surveiller en couleur d'état ; les autres en encre. */
const SEG_INK: Record<string, string> = { at_risk: 'var(--a-warn)', lost: 'var(--a-text-3)', dormant: 'var(--a-text-3)', champions: 'var(--a-pos)' };

/** Trois points : compte, app, joignable (e-mail ou SMS). */
function ReachDots({ r }: { r: Pick<CustomerRow, 'has_account' | 'has_app' | 'email_opt_in' | 'sms_opt_in' | 'email_suppressed'> }) {
  const { t } = useAdminT();
  const dots = [
    { k: 'acc', on: r.has_account, label: t(r.has_account ? 'adm.cl.flag.account' : 'adm.cl.flag.noAccount') },
    { k: 'app', on: r.has_app, label: t(r.has_app ? 'adm.cl.flag.app' : 'adm.cl.flag.noApp') },
    { k: 'reach', on: (r.email_opt_in || r.sms_opt_in) && !r.email_suppressed, label: t(r.email_suppressed ? 'adm.cl.flag.suppressed' : (r.email_opt_in || r.sms_opt_in) ? 'adm.cl.flag.joinable' : 'adm.cl.flag.notJoinable') },
  ];
  return <>{dots.map((d) => <span key={d.k} title={d.label} aria-label={d.label} className="h-2 w-2 rounded-full" style={{ background: d.on ? 'var(--a-text-2)' : 'transparent', border: '1.5px solid var(--a-text-3)' }} />)}</>;
}

/** L'aperçu d'une personne : identité, statuts, derniers achats, gestes. */
function PersonPreview({ email }: { email: string }) {
  const { t, lang } = useAdminT();
  const q = useQuery({ queryKey: ['adm-person', email], queryFn: () => rpc<Person>('admin_person', { p_email: email, p_user_id: null }) });
  const p = q.data;
  if (q.isLoading) return <div className="flex flex-col gap-3 lg:border-l lg:pl-6"><div className="a-skel h-6 w-48" /><div className="a-skel h-32 w-full" /></div>;
  if (!p || !p.found) return null;
  const idn = p.detail?.identity; const st = p.detail?.stats;
  const name = personName(idn?.first_name, idn?.last_name);
  const recent = [...p.purchases].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  return (
    <div className="flex flex-col gap-5 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
      <div className="flex flex-col gap-1.5">
        {st && <span className="a-mono text-[11px] uppercase tracking-[0.04em]" style={{ color: SEG_INK[st.segment] ?? 'var(--a-text-2)' }}>{t(`adm.cl.seg.${st.segment}`)} · {t(`adm.cl.tier.${st.tier}`)}</span>}
        <h2 className="a-t1 text-[19px] font-semibold leading-snug tracking-[-0.01em]">{name || p.email}</h2>
        {name && <span className="a-t3 text-[12.5px]">{p.email}</span>}
        <span className="flex items-center gap-1.5 pt-1"><ReachDots r={{ has_account: !!idn?.has_account, has_app: !!idn?.has_app, email_opt_in: !!idn?.email_opt_in, sms_opt_in: !!idn?.sms_opt_in, email_suppressed: !!idn?.email_suppressed }} /></span>
      </div>
      {st && (
        <div className="grid grid-cols-3 border-y">
          {[
            { k: 's', label: t('adm.cl.p.kpi.spent'), v: fmtEur(st.total_spent, lang, { cents: false }) },
            { k: 'n', label: t('adm.cl.p.kpi.nights'), v: fmtNum(st.visit_nights, lang) },
            { k: 'c', label: t('adm.cl.p.kpi.clubs'), v: fmtNum(st.venues_count, lang) },
          ].map((x, i) => (
            <div key={x.k} className={`flex flex-col gap-1 py-2.5 ${i > 0 ? 'border-l pl-3' : ''}`}>
              <span className="a-kicker truncate">{x.label}</span><span className="a-num a-t1 text-[17px] font-semibold">{x.v}</span>
            </div>
          ))}
        </div>
      )}
      <KeyValue hideEmpty items={[
        { label: t('adm.cl.p.id.phone'), value: idn?.phone, mono: true },
        { label: t('adm.cl.p.id.city'), value: idn?.city },
        { label: t('adm.cl.p.kpi.first'), value: st ? fmtDate(st.first_at, lang) : null },
        { label: t('adm.cl.p.kpi.last'), value: st ? fmtDate(st.last_at, lang) : null },
      ]} />
      <section className="flex flex-col gap-1">
        <h3 className="a-kicker mb-1">{t('adm.cl.v3.lastBuys')}</h3>
        {recent.length === 0 ? <p className="a-t3 text-[12.5px]">{t('adm.cl.p.purchases.empty')}</p> : recent.map((r) => (
          <div key={`${r.kind}${r.id}`} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-baseline gap-3 py-1 text-[12.5px]">
            <span className="a-mono a-t3 text-[11px]">{fmtDate(r.at, lang)}</span>
            <span className="a-t1 truncate">{r.event_title ?? '—'}</span>
            <span className="a-num a-t2">{r.kind === 'guestlist' ? t('adm.cl.p.kind.guestlist') : fmtEur(r.amount, lang, { cents: false })}</span>
          </div>
        ))}
      </section>
      <Link to={personHref(p.email)} className="a-btn a-btn--primary self-start">{t('adm.cl.v3.openPerson')}<ArrowUpRight className="h-3.5 w-3.5" /></Link>
    </div>
  );
}
