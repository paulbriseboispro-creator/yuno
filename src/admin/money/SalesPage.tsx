/**
 * Argent › Ventes et commissions : « Qu'a-t-on vendu, et qu'a gagné Yuno ? ».
 * Source unique : admin_platform_analytics (la période et la précédente).
 * La démo n'y entre jamais (règle de cette RPC). Le bar (pilier en pause)
 * n'apparaît nulle part. La guest list est un nombre à part, jamais un euro.
 */
import { useMemo } from 'react';
import { Download } from 'lucide-react';
import {
  Card, Chart, DataTable, ErrorState, Grid, Kpi, KpiRow, Page, Section, Tabs, useAdminFilters, useAdminT, useTab,
  type ColumnDef,
} from '@/admin/ui';
import { fmtAxisDay, fmtDate, fmtEur, fmtNum, fmtPct } from '@/lib/adminFormat';
import { moneyHintKey, moneyLabelKey, takeRate } from './terms';
import { useGuestlistCount, usePlatformAnalytics, type PlatformAnalytics } from './data';
import { TextLink } from '../pilotage/links';
import { proHref } from '../pilotage/format';
import { toCsv, downloadCsv } from './csv';

type Venue = PlatformAnalytics['top_venues'][number];
type Org = PlatformAnalytics['top_organizers'][number];
type Ev = PlatformAnalytics['top_events'][number];
type City = PlatformAnalytics['venue_cities'][number];

export default function SalesPage() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const q = usePlatformAnalytics(range);
  const gl = useGuestlistCount(includeDemo);
  const cur = q.data?.cur;
  const prev = q.data?.prev;
  const c = cur?.totals;
  const p = prev?.totals;

  const rate = c ? takeRate(c.yuno_revenue, c.gmv) : null;
  const prate = p ? takeRate(p.yuno_revenue, p.gmv) : null;

  const days = useMemo(() => cur?.by_day.map((d) => ({ d: d.d, tickets: d.tickets, tables: d.tables })) ?? null, [cur]);

  const tabs = [
    { value: 'clubs', label: t('adm.mon.sales.tab.clubs') },
    { value: 'organizers', label: t('adm.mon.sales.tab.organizers') },
    { value: 'events', label: t('adm.mon.sales.tab.events') },
    { value: 'cities', label: t('adm.mon.sales.tab.cities') },
  ];
  const [tab, setTab] = useTab(tabs, 'rank');

  const venueCols = useMemo<ColumnDef<Venue, unknown>[]>(() => [
    { accessorKey: 'name', header: t('adm.mon.sales.club'), cell: (x) => <TextLink to={proHref(`venue:${x.row.original.id}`)}>{x.row.original.name}</TextLink> },
    { accessorKey: 'city', header: t('adm.mon.sales.city'), cell: (x) => x.getValue<string>() ?? '—' },
    { accessorKey: 'revenue', header: t('adm.mon.sales.clubRevenue'), meta: { align: 'right' }, cell: (x) => fmtEur(x.getValue<number>(), lang) },
    { accessorKey: 'yuno', header: t(moneyLabelKey('fees')), meta: { align: 'right' }, cell: (x) => fmtEur(x.getValue<number>(), lang) },
    { accessorKey: 'tx', header: t('adm.mon.sales.tx'), meta: { align: 'right' }, cell: (x) => fmtNum(x.getValue<number>(), lang) },
  ], [t, lang]);
  const orgCols = useMemo<ColumnDef<Org, unknown>[]>(() => [
    { accessorKey: 'name', header: t('adm.mon.sales.organizer'), cell: (x) => <TextLink to={proHref(`org:${x.row.original.user_id}`)}>{x.row.original.name}</TextLink> },
    { accessorKey: 'events_count', header: t('adm.mon.sales.events'), meta: { align: 'right' }, cell: (x) => fmtNum(x.getValue<number>(), lang) },
    { accessorKey: 'revenue', header: t('adm.mon.sales.clubRevenue'), meta: { align: 'right' }, cell: (x) => fmtEur(x.getValue<number>(), lang) },
  ], [t, lang]);
  const evCols = useMemo<ColumnDef<Ev, unknown>[]>(() => [
    { accessorKey: 'title', header: t('adm.mon.sales.event'), cell: (x) => <TextLink to={`/admin/clients/events?q=${encodeURIComponent(x.row.original.id)}`}>{x.row.original.title}</TextLink> },
    { accessorKey: 'venue_name', header: t('adm.mon.sales.venue'), cell: (x) => x.getValue<string>() ?? '—' },
    { accessorKey: 'start_at', header: t('adm.mon.sales.date'), cell: (x) => fmtDate(x.getValue<string>(), lang) },
    { accessorKey: 'tickets', header: t('adm.mon.sales.tickets'), meta: { align: 'right' }, cell: (x) => fmtNum(x.getValue<number>(), lang) },
    { accessorKey: 'tables', header: t('adm.mon.sales.tables'), meta: { align: 'right' }, cell: (x) => fmtNum(x.getValue<number>(), lang) },
    { accessorKey: 'revenue', header: t('adm.mon.sales.clubRevenue'), meta: { align: 'right' }, cell: (x) => fmtEur(x.getValue<number>(), lang) },
  ], [t, lang]);
  const cityCols = useMemo<ColumnDef<City, unknown>[]>(() => [
    { accessorKey: 'city', header: t('adm.mon.sales.city') },
    { accessorKey: 'tx', header: t('adm.mon.sales.tx'), meta: { align: 'right' }, cell: (x) => fmtNum(x.getValue<number>(), lang) },
    { accessorKey: 'revenue', header: t('adm.mon.sales.clubRevenue'), meta: { align: 'right' }, cell: (x) => fmtEur(x.getValue<number>(), lang) },
  ], [t, lang]);

  const exportCsv = () => {
    if (!cur) return;
    const rows = cur.by_day.map((d) => [d.d, d.tickets, d.tables, d.ticket_n, d.table_n, d.yuno, d.refunds]);
    downloadCsv(`yuno-ventes-${range.period}.csv`, toCsv([
      ['date', 'billets_ca_club', 'tables_ca_club', 'billets_n', 'tables_n', 'frais_de_service', 'remboursements'], ...rows,
    ]));
  };

  if (q.error && !cur) return <Page title={t('adm.mon.sales.title')}><ErrorState onRetry={() => void q.refetch()} /></Page>;

  return (
    <Page title={t('adm.mon.sales.title')} subtitle={t('adm.mon.sales.sub')} period
      actions={<button type="button" className="a-btn a-btn--sm" onClick={exportCsv} disabled={!cur}><Download className="h-3.5 w-3.5" />{t('adm.mon.export')}</button>}>
      <KpiRow>
        <Kpi label={t(moneyLabelKey('sales'))} hint={t(moneyHintKey('sales'))} loading={!c}
          value={fmtEur(c?.gmv, lang, { cents: false })} current={c?.gmv} previous={p?.gmv} to="/admin/money/orders" />
        <Kpi label={t(moneyLabelKey('fees'))} hint={t(moneyHintKey('fees'))} loading={!c}
          value={fmtEur(c?.yuno_revenue, lang)} current={c?.yuno_revenue} previous={p?.yuno_revenue} to="/admin/pilot" />
        <Kpi label={t('adm.mon.sales.rate')} hint={t('adm.mon.sales.rate.hint')} loading={!c}
          value={rate == null ? '—' : fmtPct(rate * 100, 1)} current={rate} previous={prate} />
        <Kpi label={t(moneyLabelKey('refunds'))} hint={t(moneyHintKey('refunds'))} loading={!c} invert
          value={fmtEur(c?.refunds_total, lang)} current={c?.refunds_total} previous={p?.refunds_total} to="/admin/money/orders?status=refunded" />
        <Kpi label={t('adm.mon.sales.tx')} loading={!c} value={fmtNum(c?.tx_count, lang)} current={c?.tx_count} previous={p?.tx_count} to="/admin/money/orders" />
        <Kpi label={t('adm.mon.sales.basket')} hint={t('adm.mon.sales.basket.hint')} loading={!c}
          value={fmtEur(c?.avg_order, lang)} current={c?.avg_order} previous={p?.avg_order} />
      </KpiRow>

      <Grid cols={2}>
        <Card title={t('adm.mon.sales.perDay')} footer={t('adm.mon.sales.perDayNote')}>
          <Chart kind="stacked" data={days} x="d" unit="eur" loading={!cur} formatX={(v) => fmtAxisDay(v, lang)}
            series={[
              { key: 'tickets', label: t('adm.mon.sales.tickets'), color: 'var(--a-chart-1)' },
              { key: 'tables', label: t('adm.mon.sales.tables'), color: 'var(--a-chart-2)' },
            ]} />
        </Card>
        <Card title={t('adm.mon.sales.volume')}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            <dt className="a-t2">{t('adm.mon.sales.ticketsSold')}</dt><dd className="a-num a-t1 text-right font-medium">{fmtNum(c?.tickets_qty, lang)}</dd>
            <dt className="a-t2">{t('adm.mon.sales.tablesBooked')}</dt><dd className="a-num a-t1 text-right font-medium">{fmtNum(c?.tables_booked, lang)}</dd>
            <dt className="a-t2">{t('adm.mon.sales.clubRevenue')}</dt><dd className="a-num a-t1 text-right font-medium">{fmtEur(c?.club_revenue, lang)}</dd>
            <dt className="a-t2">{t('adm.mon.sales.refundCount')}</dt><dd className="a-num a-t1 text-right font-medium">{fmtNum(c?.refunds_count, lang)}</dd>
            <dt className="a-t2">{t('adm.mon.sales.guestlist')}</dt><dd className="a-num a-t1 text-right font-medium">{fmtNum(gl.data?.signups ?? gl.data?.total, lang)}</dd>
          </dl>
          <p className="a-t3 mt-3 text-[12px]">{t('adm.mon.sales.guestlistNote')}</p>
        </Card>
      </Grid>

      <Section title={t('adm.mon.sales.ranks')} description={t('adm.mon.sales.ranksSub')}>
        <Tabs items={tabs} value={tab} onChange={setTab} />
        {tab === 'clubs' && <DataTable data={cur?.top_venues} columns={venueCols} loading={!cur} initialSort={[{ id: 'revenue', desc: true }]} />}
        {tab === 'organizers' && <DataTable data={cur?.top_organizers} columns={orgCols} loading={!cur} initialSort={[{ id: 'revenue', desc: true }]} />}
        {tab === 'events' && <DataTable data={cur?.top_events} columns={evCols} loading={!cur} initialSort={[{ id: 'revenue', desc: true }]} />}
        {tab === 'cities' && <DataTable data={cur?.venue_cities} columns={cityCols} loading={!cur} initialSort={[{ id: 'revenue', desc: true }]} />}
      </Section>
      <p className="a-t3 text-[12px]">{t('adm.mon.sales.demoNote')}</p>
    </Page>
  );
}
