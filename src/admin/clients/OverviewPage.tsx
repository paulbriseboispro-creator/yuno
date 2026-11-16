/** « Qui achète sur Yuno ? » : cinq chiffres, les nouveaux clients, les segments, les cohortes. */
import { useQuery } from '@tanstack/react-query';
import { Card, Chart, DataTable, Kpi, KpiRow, Page, Section, useAdminFilters, useAdminT, type ColumnDef } from '@/admin/ui';
import { fmtEur, fmtNum, fmtPct } from '@/lib/adminFormat';
import { rpc, SEGMENT_KEYS, type Overview, type Period } from './data';

type SegRow = { key: string; count: number; share: number; avg_ltv: number; revenue: number };
type CohortRow = { month: string; new_customers: number; revenue: number };

export default function OverviewPage() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const days = range.days;

  const overview = useQuery({ queryKey: ['adm-clients-overview'], queryFn: () => rpc<Overview>('admin_segmentation_overview') });
  const period = useQuery({ queryKey: ['adm-clients-period', days], queryFn: () => rpc<Period>('admin_clients_period', { p_days: days }) });

  const o = overview.data;
  const p = period.data;
  const joinable = o ? o.totals.customers - o.totals.unreachable : null;
  const spark = p?.daily.map((d) => d.new);

  const segs: SegRow[] = o
    ? SEGMENT_KEYS.map((k) => {
        const s = o.segments.find((x) => x.key === k);
        return { key: k, count: s?.count ?? 0, share: o.totals.customers ? ((s?.count ?? 0) / o.totals.customers) * 100 : 0, avg_ltv: s?.avg_ltv ?? 0, revenue: s?.revenue ?? 0 };
      })
    : [];
  const segCols: ColumnDef<SegRow>[] = [
    { id: 'seg', header: t('adm.cl.ov.seg'), accessorFn: (r) => t(`adm.cl.seg.${r.key}`), cell: (c) => (
      <div><div className="a-t1 font-medium">{c.getValue<string>()}</div><div className="a-t3 text-[12px]">{t(`adm.cl.seg.${c.row.original.key}.rule`)}</div></div>
    ) },
    { accessorKey: 'count', header: t('adm.cl.ov.people'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'share', header: t('adm.cl.ov.share'), meta: { align: 'right' }, cell: (c) => fmtPct(c.getValue<number>(), 1) },
    { accessorKey: 'avg_ltv', header: t('adm.cl.ov.avgSpend'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
    { accessorKey: 'revenue', header: t('adm.cl.ov.spend'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
  ];

  const cohortCols: ColumnDef<CohortRow>[] = [
    { accessorKey: 'month', header: t('adm.cl.ov.month') },
    { accessorKey: 'new_customers', header: t('adm.cl.ov.newClients'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'revenue', header: t('adm.cl.ov.spend'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
  ];

  const L = '/admin/clients/list';
  return (
    <Page title={t('adm.cl.ov.title')} subtitle={t('adm.cl.ov.subtitle')} period>
      {includeDemo && <p className="a-t2 a-subtle rounded-lg px-3 py-2 text-[12.5px]">{t('adm.cl.ov.demoNote')}</p>}

      <KpiRow>
        <Kpi label={t('adm.cl.kpi.clients')} hint={t('adm.cl.kpi.clients.hint')} loading={period.isLoading}
          value={fmtNum(p?.clients.current, lang)} current={p?.clients.current} previous={p?.clients.previous} to={L} />
        <Kpi label={t('adm.cl.kpi.joinable')} hint={t('adm.cl.kpi.joinable.hint')} loading={overview.isLoading}
          value={fmtNum(joinable, lang)} to={L} />
        <Kpi label={t('adm.cl.kpi.active')} hint={t('adm.cl.kpi.active.hint')} loading={period.isLoading}
          value={fmtNum(p?.active.current, lang)} current={p?.active.current} previous={p?.active.previous} to={`${L}?activity=active_30d`} />
        <Kpi label={t('adm.cl.kpi.new')} hint={t('adm.cl.kpi.new.hint')} loading={period.isLoading}
          value={fmtNum(p?.new.current, lang)} current={p?.new.current} previous={p?.new.previous} spark={spark} to={`${L}?sort=first_at&dir=desc`} />
        <Kpi label={t('adm.cl.kpi.returning')} hint={t('adm.cl.kpi.returning.hint')} loading={period.isLoading}
          value={p?.returning.current == null ? '—' : fmtPct(p.returning.current, 1)} current={p?.returning.current} previous={p?.returning.previous} to={L} />
      </KpiRow>

      <Card title={t('adm.cl.ov.chart')}>
        <Chart kind="line" data={p?.daily ?? null} x="day" unit="count" loading={period.isLoading} error={period.error} onRetry={() => void period.refetch()}
          formatX={(v) => v.slice(5)}
          series={[{ key: 'new', label: t('adm.cl.ov.newClients') }]} previous={{ key: 'prev', label: t('adm.cl.ov.prev') }} />
      </Card>

      <Section title={t('adm.cl.ov.segments')} description={t('adm.cl.ov.segments.desc')}>
        <DataTable data={segs} columns={segCols} loading={overview.isLoading} error={overview.error} onRetry={() => void overview.refetch()}
          rowHref={(r) => `${L}?segment=${r.key}`} getRowId={(r) => r.key} />
      </Section>

      <Section title={t('adm.cl.ov.cohorts')} description={t('adm.cl.ov.cohorts.desc')}>
        <DataTable data={o?.cohorts ?? null} columns={cohortCols} loading={overview.isLoading} error={overview.error} onRetry={() => void overview.refetch()}
          initialSort={[{ id: 'month', desc: true }]} getRowId={(r) => r.month} />
      </Section>
    </Page>
  );
}
