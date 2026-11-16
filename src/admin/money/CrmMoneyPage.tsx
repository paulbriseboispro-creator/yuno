/**
 * Argent › Abonnements et Yunits : « Combien rapporte Yuno CRM ? ».
 * Réécriture de l'ex-page Argent CRM. Source : crm_admin_money (formules
 * inchangées). Le MRR affiché en tête est LE MRR de l'admin : la somme des
 * `mrr` de _crm_admin_rows, lue par admin_pilot_overview (même chiffre que la
 * vue d'ensemble) ; crm_admin_money fournit l'historique et les listes.
 */
import { useMemo } from 'react';
import {
  Card, Chart, DataTable, ErrorState, Grid, Kpi, KpiRow, Page, Section, useAdminFilters, useAdminT, type ColumnDef,
} from '@/admin/ui';
import { fmtDate, fmtEur, fmtNum } from '@/lib/adminFormat';
import { moneyHintKey, moneyLabelKey } from './terms';
import { useCrmMoney, type CrmMoney } from './data';
import { usePilotOverview } from '../pilotage/data';
import { fmtMonth } from '../pilotage/format';
import { TextLink } from '../pilotage/links';
import { proHref } from '../pilotage/format';

type Sub = CrmMoney['subs'][number];
type Buy = CrmMoney['buys'][number];
type Margin = CrmMoney['margin'][number];

export default function CrmMoneyPage() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const q = useCrmMoney(includeDemo);
  const ov = usePilotOverview(range, includeDemo);
  const d = q.data;
  const mrr = ov.data?.kpis.mrr;
  const last = d?.months[d.months.length - 1];
  const prevMonth = d?.months[d.months.length - 2];
  const threshold = d?.cfg.price_switch_at ?? null;

  const months = useMemo(() => d?.months.map((m) => ({ m: m.m.slice(0, 7), new: m.new, lost: m.lost, mrr: m.mrr })) ?? null, [d]);
  const weeks = useMemo(() => d?.weeks.map((w) => ({ w: w.w.slice(0, 10), eur: w.eur })) ?? null, [d]);

  const subCols = useMemo<ColumnDef<Sub, unknown>[]>(() => [
    { accessorKey: 'name', header: t('adm.mon.crm.account'), cell: (c) => <TextLink to={proHref(c.row.original.id)}>{c.row.original.name ?? c.row.original.id}</TextLink> },
    { accessorKey: 'interval', header: t('adm.mon.crm.interval'), cell: (c) => t(c.getValue<string>() === 'year' ? 'adm.mon.crm.yearly' : 'adm.mon.crm.monthly') },
    { accessorKey: 'price', header: t('adm.mon.crm.mrrShare'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
    { accessorKey: 'since', header: t('adm.mon.crm.since'), cell: (c) => fmtDate(c.getValue<string>(), lang) },
    { accessorKey: 'next', header: t('adm.mon.crm.next'), cell: (c) => fmtDate(c.getValue<string>(), lang) },
    { accessorKey: 'late', header: t('adm.mon.crm.late'), cell: (c) => (c.getValue<boolean>() ? t('adm.mon.crm.yes') : '—') },
  ], [t, lang]);
  const buyCols = useMemo<ColumnDef<Buy, unknown>[]>(() => [
    { accessorKey: 'at', header: t('adm.mon.ord.date'), cell: (c) => fmtDate(c.getValue<string>(), lang) },
    { accessorKey: 'name', header: t('adm.mon.crm.account'), cell: (c) => <TextLink to={proHref(c.row.original.id)}>{c.row.original.name ?? c.row.original.id}</TextLink> },
    { accessorKey: 'yunits', header: t('adm.mon.crm.yunits'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'eur', header: t('adm.mon.crm.paidExVat'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
  ], [t, lang]);
  const marginCols = useMemo<ColumnDef<Margin, unknown>[]>(() => [
    { accessorKey: 'name', header: t('adm.mon.crm.account'), cell: (c) => <TextLink to={proHref(c.row.original.id)}>{c.row.original.name ?? c.row.original.id}</TextLink> },
    { accessorKey: 'revenue', header: t(moneyLabelKey('yunoRevenue')), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
    { accessorKey: 'cost', header: t('adm.mon.crm.sendCost'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
    { accessorKey: 'margin', header: t(moneyLabelKey('margin')), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang) },
  ], [t, lang]);

  if (q.error && !d) return <Page title={t('adm.mon.crm.title')}><ErrorState onRetry={() => void q.refetch()} /></Page>;

  return (
    <Page title={t('adm.mon.crm.title')} subtitle={t('adm.mon.crm.sub')}>
      <KpiRow>
        <Kpi label={t(moneyLabelKey('mrr'))} hint={t(moneyHintKey('mrr'))} loading={!mrr}
          value={fmtEur(mrr?.cur, lang, { cents: false })} current={mrr?.cur} previous={mrr?.prev} to="#subs" />
        <Kpi label={t('adm.mon.crm.newMrr')} hint={t('adm.mon.crm.newMrr.hint')} loading={!d}
          value={fmtEur(last?.new, lang, { cents: false })} current={last?.new} previous={prevMonth?.new} />
        <Kpi label={t('adm.mon.crm.lostMrr')} loading={!d} invert
          value={fmtEur(last?.lost, lang, { cents: false })} current={last?.lost} previous={prevMonth?.lost} to="/admin/pilot/retention#departures" />
        <Kpi label={t('adm.mon.crm.paying')} hint={t('adm.mon.crm.paying.hint')} loading={!d}
          value={threshold ? t('adm.mon.crm.ofThreshold', { n: fmtNum(d?.kpi.paying, lang), max: fmtNum(threshold, lang) }) : fmtNum(d?.kpi.paying, lang)} to="#subs" />
        <Kpi label={t('adm.mon.crm.late')} loading={!d} invert value={fmtNum(d?.kpi.late, lang)} to="#subs" />
      </KpiRow>
      {threshold != null && d && (
        <p className="a-t3 -mt-3 text-[12px]">{t('adm.mon.crm.thresholdNote', { n: fmtNum(Math.max(0, threshold - d.kpi.paying), lang), launch: fmtEur(d.cfg.price_month, lang, { cents: false }), pub: fmtEur(d.cfg.price_month_next, lang, { cents: false }) })}</p>
      )}

      <Grid cols={2}>
        <Card title={t('adm.mon.crm.mrrChart')}>
          <Chart kind="line" data={months} x="m" unit="eur" loading={!d} formatX={(v) => fmtMonth(v, lang)}
            series={[{ key: 'mrr', label: t('adm.mon.crm.mrrEnd') }]} />
        </Card>
        <Card title={t('adm.mon.crm.movesChart')}>
          <Chart kind="bar" data={months} x="m" unit="eur" loading={!d} formatX={(v) => fmtMonth(v, lang)}
            series={[
              { key: 'new', label: t('adm.mon.crm.newMrr'), color: 'var(--a-chart-2)' },
              { key: 'lost', label: t('adm.mon.crm.lostMrr'), color: 'var(--a-chart-5)' },
            ]} />
        </Card>
      </Grid>

      <Section title={t('adm.mon.crm.subs')} description={t('adm.mon.crm.subsSub')}>
        <div id="subs"><DataTable data={d?.subs} columns={subCols} loading={!d} empty={{ title: t('adm.mon.crm.noSubs') }} /></div>
      </Section>

      <Grid cols={2}>
        <Card title={t('adm.mon.crm.rechargeChart')}>
          <Chart kind="bar" data={weeks} x="w" unit="eur" loading={!d} height={220}
            series={[{ key: 'eur', label: t(moneyLabelKey('recharges')) }]} />
        </Card>
        <Section title={t('adm.mon.crm.buys')}>
          <DataTable data={d?.buys} columns={buyCols} loading={!d} pageSize={8} empty={{ title: t('adm.mon.crm.noBuys') }} />
        </Section>
      </Grid>

      <Section title={t('adm.mon.crm.margin')} description={t('adm.mon.crm.marginSub')}>
        <DataTable data={d?.margin} columns={marginCols} loading={!d} initialSort={[{ id: 'margin', desc: false }]} />
      </Section>
    </Page>
  );
}
