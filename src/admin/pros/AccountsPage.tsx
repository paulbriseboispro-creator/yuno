/**
 * Pros › Tous les comptes (v3) : « Qui sont mes pros et où en sont-ils ? »
 *   1. En tête, la réponse : le nombre de comptes, une phrase (combien vendent,
 *      combien à risque) et la barre du cycle de vie (invité → inscrit →
 *      configuré → vend → à risque → en pause), un segment par statut,
 *      largeur = nombre de comptes, un clic filtre la liste ;
 *   2. une vue partagée : la liste dense à gauche (une ligne par compte, j / k
 *      au clavier), l'aperçu du compte choisi à droite, « entrée » ouvre la fiche.
 * Données : admin_accounts (une ligne par compte, tous produits). Il n'y a pas
 * de série de ventes par jour et par compte : la ligne compare la période à la
 * précédente en deux barres. Filtres dans l'adresse (`?type=&product=&status=&city=`).
 * Deux vues des comptes Yuno CRM remplacent la liste (`?view=risk|onboarding`).
 */
import { useCallback, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, MessageCircle, Phone, Plus, Search } from 'lucide-react';
import { Badge, Hero, SplitView, Status, Page, useAdminT, useAdminFilters, EmptyState, ErrorState, Chip, KeyValue, PairBars, SegmentBar, stepInk, useListKeys, type Segment, MiniBar } from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum, fmtRelative } from '@/lib/adminFormat';
import {
  DEFAULT_FILTERS, LIFECYCLE, LIFECYCLE_TONE, accountHref, accountKpis, citiesOf, matchesFilters, phoneLinks,
  type AccountFilters, type AccountRow, type AccountType, type Lifecycle,
} from './accounts';
import { useAccount, useAccounts } from './data';
import { CrmViews, type CrmView } from './CrmViews';
import { AccountGestures } from './gestures';
import { LIFE_ORDER, accountStory, lifecycleCounts } from './story';
import { AccountSentence } from './account/Sentence';

const TYPES: AccountType[] = ['club', 'organizer', 'association', 'agency'];
const PRODUCTS: AccountFilters['product'][] = ['tickets', 'crm', 'both'];
type Sort = 'seen' | 'sales' | 'revenue' | 'name' | 'health';

function readFilters(sp: URLSearchParams): AccountFilters {
  const type = sp.get('type') as AccountType | null;
  const product = sp.get('product') as AccountFilters['product'] | null;
  const status = sp.get('status') as Lifecycle | null;
  return {
    type: type && TYPES.includes(type) ? type : 'all',
    product: product && PRODUCTS.includes(product) ? product : 'all',
    status: status && (LIFECYCLE as readonly string[]).includes(status) ? status : 'all',
    city: sp.get('city') || 'all',
  };
}

/** Couleur d'un statut dans la barre : encre qui fonce le long du parcours ; vend et à risque à part. */
function lifeColor(s: Lifecycle): string {
  if (s === 'selling') return 'color-mix(in srgb, var(--a-pos) 42%, transparent)';
  if (s === 'at_risk') return 'color-mix(in srgb, var(--a-warn) 48%, transparent)';
  if (s === 'closed') return 'color-mix(in srgb, var(--a-neg) 30%, transparent)';
  if (s === 'paused') return 'var(--a-grid)';
  return stepInk(['invited', 'signed_up', 'configured'].indexOf(s), 3);
}

export default function AccountsPage() {
  const { t, lang } = useAdminT();
  const { range } = useAdminFilters();
  const q = useAccounts();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const f = readFilters(sp);
  const rows = q.data?.accounts;
  const legacyTab = sp.get('tab') === 'risks' ? 'risk' : sp.get('tab');
  const view = (['risk', 'onboarding'] as const).find((v) => v === (sp.get('view') ?? legacyTab)) ?? 'all';
  const legacyOpen = sp.get('open');
  const [search, setSearch] = useState(sp.get('q') ?? '');
  const [sort, setSort] = useState<Sort>('seen');
  const [picked, setPicked] = useState<string | null>(null);

  const setView = (v: 'all' | CrmView) => setSp((prev) => { const n = new URLSearchParams(prev); n.delete('tab'); if (v === 'all') n.delete('view'); else n.set('view', v); return n; }, { replace: true });
  const setFilter = (k: keyof AccountFilters, v: string) => setSp((prev) => {
    const next = new URLSearchParams(prev);
    if (v === 'all' || v === DEFAULT_FILTERS[k]) next.delete(k); else next.set(k, v);
    return next;
  }, { replace: true });

  const kpi = useMemo(() => (q.data ? accountKpis(q.data.accounts, q.data.from, q.data.prev_from) : null), [q.data]);
  const cities = useMemo(() => citiesOf(rows ?? []), [rows]);
  // La barre compte selon les autres filtres, jamais selon le statut (sinon elle se viderait au clic).
  const base = useMemo(() => (rows ?? []).filter((r) => matchesFilters(r, { ...f, status: 'all' })), [rows, f]);
  const counts = useMemo(() => lifecycleCounts(base), [base]);
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = base.filter((r) => (f.status === 'all' || r.status === f.status)
      && (!needle || `${r.name} ${r.city ?? ''} ${r.owner_email ?? ''} ${r.owner_name ?? ''} ${r.tags.join(' ')}`.toLowerCase().includes(needle)));
    const by: Record<Sort, (a: AccountRow, b: AccountRow) => number> = {
      seen: (a, b) => (b.last_seen ?? '').localeCompare(a.last_seen ?? ''),
      sales: (a, b) => b.sales_period - a.sales_period || b.sales_30d - a.sales_30d,
      revenue: (a, b) => (b.revenue_period ?? -1) - (a.revenue_period ?? -1),
      name: (a, b) => a.name.localeCompare(b.name),
      health: (a, b) => (a.crm?.health ?? 999) - (b.crm?.health ?? 999),
    };
    return [...list].sort(by[sort]);
  }, [base, f.status, search, sort]);

  const selected = picked && shown.some((r) => r.key === picked) ? picked : shown[0]?.key ?? null;
  const idOf = useCallback((r: AccountRow) => r.key, []);
  const open = useCallback((r: AccountRow) => navigate(accountHref(r.key)), [navigate]);
  useListKeys(view === 'all' ? shown : [], idOf, selected, setPicked, open);

  if (legacyOpen && legacyOpen.includes(':')) return <Navigate to={accountHref(legacyOpen)} replace />;

  const segments: Segment[] = LIFE_ORDER.filter((s) => s !== 'closed' || counts.closed > 0).map((s) => ({
    key: s, label: t(`adm.pros.st.${s}`), value: counts[s], color: lifeColor(s), hint: t(`adm.pros.st.${s}.def`),
  }));
  const total = kpi?.total ?? 0;
  const sentence = !kpi ? null : total === 0 ? t('adm.pros.v3.noAccounts') : (
    <>
      <b>{fmtNum(total, lang)}</b> {t(total === 1 ? 'adm.pros.v3.pro' : 'adm.pros.v3.pros')}
      {', '}{kpi.selling === 0 ? t('adm.pros.v3.noneSelling', { n: range.days }) : <><b>{fmtNum(kpi.selling, lang)}</b> {t(kpi.selling === 1 ? 'adm.pros.v3.sellsOne' : 'adm.pros.v3.sells', { n: range.days })}</>}
      {kpi.atRisk > 0 ? <>, <b>{fmtNum(kpi.atRisk, lang)}</b> {t('adm.pros.v3.atRisk')}</> : <>, {t('adm.pros.v3.noRisk')}</>}
      {kpi.newOnes > 0 ? <>. <b>{fmtNum(kpi.newOnes, lang)}</b> {t(kpi.newOnes === 1 ? 'adm.pros.v3.newOne' : 'adm.pros.v3.new', { n: range.days })}</> : null}
      {kpi.paidCrm > 0 ? <>. {t('adm.pros.v3.crmPaid', { n: fmtNum(kpi.paidCrm, lang), mrr: fmtEur(kpi.mrr, lang, { cents: false }) })}</> : null}.
    </>
  );

  return (
    <Page title={t('adm.pros.list.title')} period
      actions={<Link to="/admin/pros/invite" className="a-btn a-btn--primary"><Plus className="h-4 w-4" />{t('adm.pros.invite.cta')}</Link>}>
      <Hero kicker={t('adm.pros.v3.kicker')} loading={q.isLoading} value={fmtNum(total, lang)}
        current={kpi?.total} previous={kpi?.totalPrev} sentence={sentence}
        chart={q.isLoading ? <div className="a-skel h-9 w-full" /> : (
          <SegmentBar segments={segments} selected={f.status === 'all' ? null : f.status} onSelect={(k) => setFilter('status', k ?? 'all')}
            ariaLabel={t('adm.pros.v3.lifeAria')} fmt={(n) => fmtNum(n, lang)} />
        )}
        note={t('adm.pros.v3.lifeNote')} />

      <div className="flex flex-col gap-3 border-t pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="a-seg" role="group" aria-label={t('adm.pros.cv.view')}>
            {(['all', 'risk', 'onboarding'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{t(`adm.pros.cv.v.${v}`)}</button>
            ))}
          </div>
          {view === 'all' && (
            <>
              <span aria-hidden className="mx-1 h-5 w-px" style={{ background: 'var(--a-border)' }} />
              {TYPES.map((v) => <Chip key={v} on={f.type === v} onClick={() => setFilter('type', f.type === v ? 'all' : v)}>{t(`adm.pros.type.${v}`)}</Chip>)}
              <span aria-hidden className="mx-1 h-5 w-px" style={{ background: 'var(--a-border)' }} />
              {PRODUCTS.map((v) => <Chip key={v} on={f.product === v} onClick={() => setFilter('product', f.product === v ? 'all' : v)}>{t(`adm.pros.product.${v}`)}</Chip>)}
              {cities.length > 1 && (
                <select className="a-input a-input--filter" value={f.city} onChange={(e) => setFilter('city', e.target.value)} aria-label={t('adm.pros.filter.city')}>
                  <option value="all">{t('adm.pros.filter.city')}</option>
                  {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </>
          )}
        </div>
        {view === 'all' && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-[220px] max-w-[360px] flex-1">
              <Search className="a-t3 pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
              <input className="a-input" style={{ paddingLeft: 30 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('adm.pros.list.search')} aria-label={t('adm.pros.list.search')} />
            </label>
            <span className="a-mono a-t3 text-[11px]">{t('adm.pros.v3.shown', { n: fmtNum(shown.length, lang), total: fmtNum(base.length, lang) })}</span>
            <span className="a-mono a-t3 ml-auto hidden text-[11px] lg:inline">{t('adm.pros.v3.keys')}</span>
          </div>
        )}
      </div>

      {view !== 'all' ? <CrmViews view={view} /> : q.error ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <SplitView
          list={<AccountList rows={shown} loading={q.isLoading} selected={selected} onSelect={setPicked} onOpen={open} sort={sort} onSort={setSort} days={range.days} />}
          panel={selected ? <AccountPreview key={selected} row={shown.find((r) => r.key === selected) ?? null} /> : null} />
      )}
    </Page>
  );
}

function AccountList({ rows, loading, selected, onSelect, onOpen, sort, onSort, days }: {
  rows: AccountRow[]; loading: boolean; selected: string | null; onSelect: (k: string) => void; onOpen: (r: AccountRow) => void; sort: Sort; onSort: (s: Sort) => void; days: number;
}) {
  const { t, lang } = useAdminT();
  const grid = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 md:grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_5.5rem_4.5rem_5.5rem]';
  const head = (s: Sort, label: string, right = false) => (
    <button type="button" onClick={() => onSort(s)} aria-pressed={sort === s}
      className={`a-kicker a-focus border-0 bg-transparent p-0 ${right ? 'text-right' : 'text-left'}`}
      style={{ cursor: 'pointer', color: sort === s ? 'var(--a-text)' : undefined }}>{label}{sort === s ? ' ↓' : ''}</button>
  );
  if (loading) return <div className="flex flex-col gap-1">{Array.from({ length: 8 }, (_, i) => <div key={i} className="a-skel h-11 w-full" />)}</div>;
  if (rows.length === 0) return <EmptyState title={t('adm.pros.list.empty')} body={t('adm.pros.list.emptyBody')} />;
  return (
    <div className="flex flex-col">
      <div className={`${grid} border-b px-2 pb-2`}>
        {head('name', t('adm.pros.col.account'))}
        <span className="a-kicker hidden md:block">{t('adm.pros.col.products')}</span>
        <span className="hidden justify-self-end md:block">{head('sales', t('adm.pros.v3.colSales', { n: days }), true)}</span>
        <span className="hidden justify-self-end md:block">{head('revenue', t('adm.pros.v3.colRev'), true)}</span>
        <span className="hidden md:block">{head('health', t('adm.pros.v3.colHealth'))}</span>
        <span className="justify-self-end">{head('seen', t('adm.pros.v3.colSeen'), true)}</span>
      </div>
      <ul role="listbox" aria-label={t('adm.pros.list.title')} className="flex flex-col">
        {rows.map((r) => {
          const on = r.key === selected;
          return (
            <li key={r.key} role="option" aria-selected={on} data-row-id={r.key}>
              <button type="button" onClick={() => onSelect(r.key)} onDoubleClick={() => onOpen(r)}
                className={`a-focus ${grid} w-full border-0 border-b bg-transparent px-2 py-2 text-left font-[inherit] hover:bg-[var(--a-hover)] ${on ? 'a-row-active' : ''}`}
                style={{ cursor: 'pointer' }}>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: lifeDot(r.status) }} title={t(`adm.pros.st.${r.status}`)} />
                    <span className="a-t1 truncate text-[13.5px] font-medium">{r.name}</span>
                    {r.is_demo && <Badge>{t('adm.pros.demo')}</Badge>}
                    {r.support === 'active' && <span className="a-mono a-t3 flex-none text-[10.5px] uppercase tracking-[0.04em]" title={t('adm.pros.support.active')}>{t('adm.pros.v3.supportShort')}</span>}
                  </span>
                  <span className="a-t3 block truncate pl-3.5 text-[12px]">{[t(`adm.pros.type.${r.type}`), r.city].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="hidden gap-1 md:flex">
                  {r.products.map((p) => <span key={p} className="a-mono rounded-[4px] border px-1.5 py-[1px] text-[10.5px] uppercase tracking-[0.04em]" style={{ color: 'var(--a-text-2)' }}>{t(`adm.pros.v3.pill.${p}`)}</span>)}
                </span>
                <span className="hidden items-center justify-end gap-2 md:flex">
                  <PairBars prev={r.sales_prev} cur={r.sales_period} title={t('adm.pros.v3.pairTitle', { prev: r.sales_prev, cur: r.sales_period })} />
                  <span className="a-num a-t1 w-8 text-right text-[12.5px]">{fmtNum(r.sales_period, lang)}</span>
                </span>
                <span className="a-num a-t1 hidden text-right text-[12.5px] md:block">{r.revenue_period == null ? <span className="a-t3">—</span> : r.revenue_period === 0 ? <span className="a-t3">0 €</span> : fmtEur(r.revenue_period, lang, { cents: false })}</span>
                <span className="hidden md:block">{r.crm ? <MiniBar value={r.crm.health} max={100} width={34} tone={r.crm.health != null && r.crm.health < 40 ? 'warning' : 'neutral'} display={r.crm.health == null ? undefined : Math.round(r.crm.health)} label={t('adm.pros.k.crmHealthHint')} /> : <span className="a-t3 text-[12px]">—</span>}</span>
                <span className="a-mono a-t3 whitespace-nowrap text-right text-[11px]">{r.last_seen ? fmtRelative(r.last_seen, lang) : t('adm.pros.never')}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function lifeDot(s: Lifecycle): string {
  if (s === 'selling') return 'var(--a-pos)';
  if (s === 'at_risk') return 'var(--a-warn)';
  if (s === 'closed') return 'var(--a-neg)';
  return 'var(--a-text-3)';
}

/** L'aperçu à droite : l'essentiel de la fiche et ses gestes. */
function AccountPreview({ row }: { row: AccountRow | null }) {
  const { t, lang } = useAdminT();
  const q = useAccount(row?.key);
  if (!row) return null;
  const card = q.data;
  const phone = phoneLinks(row.owner_phone);
  const story = card ? accountStory(card) : null;
  const pinned = card?.notes.filter((n) => n.pinned) ?? [];
  return (
    <div className="flex flex-col gap-5 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Status tone={LIFECYCLE_TONE[row.status]}>{t(`adm.pros.st.${row.status}`)}</Status>
          <span className="a-mono a-t3 text-[11px]">{[t(`adm.pros.type.${row.type}`), row.city].filter(Boolean).join(' · ')}</span>
        </div>
        <h2 className="a-t1 text-[19px] font-semibold leading-snug tracking-[-0.01em]">{row.name}</h2>
        {story ? <AccountSentence story={story} row={row} className="a-t2 text-[13.5px] leading-relaxed" />
          : q.isLoading ? <div className="a-skel h-10 w-full" /> : null}
      </div>

      <div className="grid grid-cols-3 border-y">
        {[
          { k: 'sales30', label: t('adm.pros.k.sales30'), v: fmtNum(row.sales_30d, lang) },
          { k: 'rev', label: t('adm.pros.v3.colRev'), v: row.revenue_period == null ? '—' : fmtEur(row.revenue_period, lang, { cents: false }) },
          { k: 'up', label: t('adm.pros.k.upcoming'), v: fmtNum(row.upcoming, lang) },
        ].map((s, i) => (
          <div key={s.k} className={`flex flex-col gap-1 py-2.5 ${i > 0 ? 'border-l pl-3' : ''}`}>
            <span className="a-kicker truncate">{s.label}</span>
            <span className="a-num a-t1 text-[17px] font-semibold">{s.v}</span>
          </div>
        ))}
      </div>

      <KeyValue hideEmpty items={[
        { label: t('adm.pros.card.owner'), value: row.owner_name || row.owner_email },
        { label: t('adm.pros.f.email'), value: row.owner_email ? <a className="hover:underline" href={`mailto:${row.owner_email}`}>{row.owner_email}</a> : null },
        { label: t('adm.pros.f.phone'), value: row.owner_phone, mono: true },
        { label: 'Stripe', value: row.type === 'agency' && !row.stripe_ready ? null : <Status tone={row.stripe_ready ? 'positive' : 'neutral'}>{t(row.stripe_ready ? 'adm.pros.stripe.ready' : 'adm.pros.stripe.no')}</Status> },
        { label: 'CRM', value: row.crm ? <span className="inline-flex items-center gap-2">{t(`adm.pros.crm.${row.crm.state}`)}<MiniBar value={row.crm.health} max={100} width={40} tone={row.crm.health != null && row.crm.health < 40 ? 'warning' : 'neutral'} display={row.crm.health == null ? undefined : Math.round(row.crm.health)} /></span> : null },
        { label: t('adm.pros.f.created'), value: fmtDate(row.created_at, lang) },
        { label: t('adm.pros.f.lastLogin'), value: row.last_login ? fmtRelative(row.last_login, lang) : t('adm.pros.never') },
        { label: t('adm.pros.f.tags'), value: row.tags.length ? row.tags.join(', ') : null },
      ]} />

      {pinned.length > 0 && (
        <div className="flex flex-col gap-1 border-l-2 pl-3" style={{ borderColor: 'var(--a-warn)' }}>
          <span className="a-kicker">{t('adm.pros.v3.pinned')}</span>
          {pinned.map((n) => <p key={n.id} className="a-t1 whitespace-pre-wrap text-[13px]">{n.body}</p>)}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Link to={accountHref(row.key)} className="a-btn a-btn--primary">{t('adm.pros.v3.openCard')}<ArrowUpRight className="h-3.5 w-3.5" /></Link>
          {phone && <a className="a-btn" href={phone.wa} target="_blank" rel="noreferrer"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</a>}
          {phone && <a className="a-btn" href={phone.tel}><Phone className="h-3.5 w-3.5" />{t('adm.pros.call')}</a>}
        </div>
        {card && <div className="flex flex-wrap gap-2"><AccountGestures card={card} /></div>}
        <span className="a-mono a-t3 text-[11px]">{t('adm.pros.v3.enterHint')}</span>
      </div>
    </div>
  );
}
