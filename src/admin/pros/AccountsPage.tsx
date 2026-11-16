/**
 * « Qui sont mes comptes pros et où en sont-ils ? » (`/admin/pros`).
 * Une ligne par compte, tous produits (admin_accounts). Cinq chiffres en tête,
 * chacun comparé à la période précédente quand la comparaison a un sens, et
 * chacun filtre la liste. Les filtres vivent dans l'adresse (`?type=&product=&status=&city=`).
 * Deux vues des comptes Yuno CRM remplacent la liste (`?view=risk|onboarding`,
 * CrmViews.tsx) : santé et risques, mise en route des comptes récents.
 */
import { useMemo } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Info, Plus } from 'lucide-react';
import { DataTable, Kpi, KpiRow, Page, Status, Badge, useAdminT, useAdminFilters, type ColumnDef } from '@/admin/ui';
import { fmtEur, fmtNum, fmtRelative } from '@/lib/adminFormat';
import {
  DEFAULT_FILTERS, LIFECYCLE, LIFECYCLE_TONE, accountHref, accountKpis, citiesOf, matchesFilters,
  type AccountFilters, type AccountRow, type AccountType, type Lifecycle,
} from './accounts';
import { useAccounts } from './data';
import { ProductBadges, TypeLabel } from './bits';
import { CrmViews, type CrmView } from './CrmViews';

const TYPES: AccountType[] = ['club', 'organizer', 'association', 'agency'];
const PRODUCTS: AccountFilters['product'][] = ['tickets', 'crm', 'both'];

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

export default function AccountsPage() {
  const { t, lang } = useAdminT();
  const { range } = useAdminFilters();
  const q = useAccounts();
  const [sp, setSp] = useSearchParams();
  const f = readFilters(sp);
  const rows = q.data?.accounts;
  // `?tab=risks|onboarding` et `?open=<compte>` : liens de l'ancienne liste des comptes CRM.
  const legacyTab = sp.get('tab') === 'risks' ? 'risk' : sp.get('tab');
  const view = (['risk', 'onboarding'] as const).find((v) => v === (sp.get('view') ?? legacyTab)) ?? 'all';
  const legacyOpen = sp.get('open');
  const setView = (v: 'all' | CrmView) => setSp((prev) => { const n = new URLSearchParams(prev); n.delete('tab'); if (v === 'all') n.delete('view'); else n.set('view', v); return n; }, { replace: true });

  const setFilter = (k: keyof AccountFilters, v: string) => setSp((prev) => {
    const next = new URLSearchParams(prev);
    if (v === 'all' || v === DEFAULT_FILTERS[k]) next.delete(k); else next.set(k, v);
    return next;
  }, { replace: true });

  const kpi = useMemo(() => (q.data ? accountKpis(q.data.accounts, q.data.from, q.data.prev_from) : null), [q.data]);
  const cities = useMemo(() => citiesOf(rows ?? []), [rows]);
  const shown = useMemo(() => (rows ?? []).filter((r) => matchesFilters(r, f)), [rows, f]);
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams(sp);
    for (const k of ['type', 'product', 'status', 'city']) p.delete(k);
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    const s = p.toString();
    return `/admin/pros${s ? `?${s}` : ''}`;
  };

  const columns = useMemo<ColumnDef<AccountRow, unknown>[]>(() => [
    {
      id: 'name', accessorFn: (r) => `${r.name} ${r.city ?? ''} ${r.owner_email ?? ''} ${r.owner_name ?? ''} ${r.tags.join(' ')}`,
      header: t('adm.pros.col.account'),
      cell: ({ row: { original: r } }) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="a-t1 truncate font-medium">{r.name}</span>
            {r.is_demo && <Badge>{t('adm.pros.demo')}</Badge>}
            {r.support && <Badge tone={r.support === 'active' ? 'accent' : 'warning'}>{t(`adm.pros.support.${r.support}`)}</Badge>}
          </div>
          <div className="a-t3 mt-0.5 flex flex-wrap gap-x-2 text-[12px]">
            <TypeLabel type={r.type} />
            {r.city && <span>· {r.city}</span>}
            {r.note && <span className="truncate" title={r.note}>· {r.note}</span>}
          </div>
        </div>
      ),
      sortingFn: (a, b) => a.original.name.localeCompare(b.original.name),
    },
    { id: 'products', header: t('adm.pros.col.products'), accessorFn: (r) => r.products.join(','), cell: ({ row: { original: r } }) => <ProductBadges products={r.products} />, enableSorting: false },
    {
      id: 'status', header: () => <StatusHeader />, accessorFn: (r) => LIFECYCLE.indexOf(r.status),
      cell: ({ row: { original: r } }) => <Status tone={LIFECYCLE_TONE[r.status]}>{t(`adm.pros.st.${r.status}`)}</Status>,
    },
    {
      id: 'stripe', header: 'Stripe', accessorFn: (r) => (r.stripe_ready ? 1 : 0),
      cell: ({ row: { original: r } }) => (r.type === 'agency' && !r.stripe_ready ? <span className="a-t3">—</span>
        : <Status tone={r.stripe_ready ? 'positive' : 'neutral'}>{t(r.stripe_ready ? 'adm.pros.stripe.ready' : 'adm.pros.stripe.no')}</Status>),
    },
    {
      id: 'sales', header: t('adm.pros.col.sales', { n: range.days }), accessorKey: 'sales_period', meta: { align: 'right' },
      cell: ({ row: { original: r } }) => fmtNum(r.sales_period, lang),
    },
    {
      id: 'revenue', header: t('adm.pros.col.revenue', { n: range.days }), accessorFn: (r) => r.revenue_period ?? -1, meta: { align: 'right' },
      cell: ({ row: { original: r } }) => (r.revenue_period == null ? <span className="a-t3">—</span> : fmtEur(r.revenue_period, lang, { cents: false })),
    },
    {
      id: 'total', header: t('adm.pros.col.total'), accessorFn: (r) => r.revenue_total ?? -1, meta: { align: 'right' },
      cell: ({ row: { original: r } }) => (r.revenue_total == null ? <span className="a-t3">{fmtNum(r.sales_total, lang)}</span> : fmtEur(r.revenue_total, lang, { cents: false })),
    },
    { id: 'upcoming', header: t('adm.pros.col.upcoming'), accessorKey: 'upcoming', meta: { align: 'right' }, cell: ({ row: { original: r } }) => fmtNum(r.upcoming, lang) },
    {
      id: 'crm', header: 'CRM', accessorFn: (r) => r.crm?.health ?? -1,
      cell: ({ row: { original: r } }) => (r.crm ? (
        <span className="a-t2 whitespace-nowrap text-[12.5px]">
          {t(`adm.pros.crm.${r.crm.state}`)} · <span className="a-num">{r.crm.health}/100</span>
          {r.crm.mrr > 0 && <> · <span className="a-num">{fmtEur(r.crm.mrr, lang)}</span></>}
        </span>
      ) : <span className="a-t3">—</span>),
    },
    {
      id: 'seen', header: t('adm.pros.col.seen'), accessorFn: (r) => (r.last_seen ? new Date(r.last_seen).getTime() : 0),
      cell: ({ row: { original: r } }) => <span className="a-t2 whitespace-nowrap text-[12.5px]">{r.last_seen ? fmtRelative(r.last_seen, lang) : t('adm.pros.never')}</span>,
    },
  ], [t, lang, range.days]);

  const select = (k: keyof AccountFilters, opts: { v: string; label: string }[]) => (
    <select className="a-input" style={{ width: 'auto', height: 32 }} value={f[k]} onChange={(e) => setFilter(k, e.target.value)} aria-label={t(`adm.pros.filter.${k}`)}>
      <option value="all">{t(`adm.pros.filter.${k}`)}</option>
      {opts.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );

  if (legacyOpen && legacyOpen.includes(':')) return <Navigate to={accountHref(legacyOpen)} replace />;

  return (
    <Page
      title={t('adm.pros.list.title')}
      subtitle={t('adm.pros.list.sub')}
      period
      actions={<Link to="/admin/pros/invite" className="a-btn a-btn--primary"><Plus className="h-4 w-4" />{t('adm.pros.invite.cta')}</Link>}
    >
      <KpiRow>
        <Kpi label={t('adm.pros.kpi.total')} hint={t('adm.pros.kpi.totalHint')} loading={q.isLoading}
          value={fmtNum(kpi?.total, lang)} current={kpi?.total} previous={kpi?.totalPrev} to={qs({})} />
        <Kpi label={t('adm.pros.kpi.selling')} hint={t('adm.pros.kpi.sellingHint')} loading={q.isLoading}
          value={fmtNum(kpi?.selling, lang)} current={kpi?.selling} previous={kpi?.sellingPrev} to={qs({ status: 'selling' })} />
        <Kpi label={t('adm.pros.kpi.new')} hint={t('adm.pros.kpi.newHint')} loading={q.isLoading}
          value={fmtNum(kpi?.newOnes, lang)} current={kpi?.newOnes} previous={kpi?.newPrev} to={qs({})} />
        <Kpi label={t('adm.pros.kpi.atRisk')} hint={t('adm.pros.st.at_risk.def')} loading={q.isLoading} invert
          value={fmtNum(kpi?.atRisk, lang)} to={qs({ status: 'at_risk' })} />
        <Kpi label={t('adm.pros.kpi.paidCrm')} hint={t('adm.pros.kpi.paidCrmHint')} loading={q.isLoading}
          value={<>{fmtNum(kpi?.paidCrm, lang)}<span className="a-t3 ml-2 text-[13px] font-normal">{fmtEur(kpi?.mrr ?? 0, lang)} {t('adm.pros.kpi.mrr')}</span></>}
          to={qs({ product: 'crm' })} />
      </KpiRow>

      <div className="a-seg flex-wrap self-start" role="group" aria-label={t('adm.pros.cv.view')}>
        {(['all', 'risk', 'onboarding'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{t(`adm.pros.cv.v.${v}`)}</button>
        ))}
      </div>

      {view !== 'all' ? <CrmViews view={view} /> : <DataTable
        data={shown}
        columns={columns}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        searchable
        searchPlaceholder={t('adm.pros.list.search')}
        rowHref={(r) => accountHref(r.key)}
        getRowId={(r) => r.key}
        initialSort={[{ id: 'seen', desc: true }]}
        pageSize={50}
        empty={{ title: t('adm.pros.list.empty'), body: t('adm.pros.list.emptyBody') }}
        toolbar={(
          <div className="flex flex-wrap items-center gap-2">
            {select('type', TYPES.map((v) => ({ v, label: t(`adm.pros.type.${v}`) })))}
            {select('product', PRODUCTS.map((v) => ({ v, label: t(`adm.pros.product.${v}`) })))}
            {select('status', LIFECYCLE.map((v) => ({ v, label: t(`adm.pros.st.${v}`) })))}
            {select('city', cities.map((v) => ({ v, label: v })))}
          </div>
        )}
      />}
    </Page>
  );
}

/** En-tête « Statut » avec la définition de chaque statut. */
function StatusHeader() {
  const { t } = useAdminT();
  const def = LIFECYCLE.map((s) => `${t(`adm.pros.st.${s}`)} : ${t(`adm.pros.st.${s}.def`)}`).join('\n');
  return <span className="inline-flex items-center gap-1" title={def}>{t('adm.pros.col.status')}<Info className="h-3 w-3 opacity-60" aria-label={def} /></span>;
}
