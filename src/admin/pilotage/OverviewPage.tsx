/**
 * Pilotage › Vue d'ensemble : « Comment va l'entreprise ? ».
 * Six chiffres comparés à la période précédente, le revenu de Yuno par jour et
 * par source, les douze derniers mois, la concentration des ventes.
 * Source unique : admin_pilot_overview (src/admin/money/terms.ts pour les mots).
 */
import { useMemo } from 'react';
import {
  Card, Chart, DataTable, ErrorState, Kpi, KpiRow, Page, Section, useAdminFilters, useAdminT, type ColumnDef,
} from '@/admin/ui';
import { fmtAxisDay, fmtEur, fmtNum, fmtPct } from '@/lib/adminFormat';
import { moneyHintKey, moneyLabelKey, topShare, yunoRevenue } from '../money/terms';
import { usePilotOverview, type OverviewMonth } from './data';
import { TextLink } from './links';
import { fmtMonth, proHref } from './format';

export default function OverviewPage() {
  const { t, lang } = useAdminT();
  const { range, includeDemo } = useAdminFilters();
  const q = usePilotOverview(range, includeDemo);
  const d = q.data;
  const k = d?.kpis;

  const revCur = k ? yunoRevenue({ fees: k.fees.cur, subs: k.subs.cur, recharges: k.recharges.cur }) : 0;
  const revPrev = k ? yunoRevenue({ fees: k.fees.prev, subs: k.subs.prev, recharges: k.recharges.prev }) : 0;

  const series = useMemo(() => {
    if (!d) return null;
    return d.series.map((row, i) => ({
      d: row.d, fees: row.fees, subs: row.subs, recharges: row.recharges,
      total: yunoRevenue(row),
      prev: d.prev_series[i]?.total ?? null,
    }));
  }, [d]);

  const monthColumns = useMemo<ColumnDef<OverviewMonth, unknown>[]>(() => [
    { accessorKey: 'm', header: t('adm.pil.ov.month'), cell: (c) => fmtMonth(c.getValue<string>(), lang) },
    { accessorKey: 'sales', header: t(moneyLabelKey('sales')), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang, { cents: false }) },
    { id: 'revenue', accessorFn: (r) => yunoRevenue(r), header: t(moneyLabelKey('yunoRevenue')), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang, { cents: false }) },
    { accessorKey: 'mrr_end', header: t('adm.pil.ov.mrrEnd'), meta: { align: 'right' }, cell: (c) => fmtEur(c.getValue<number>(), lang, { cents: false }) },
    { accessorKey: 'new_pros', header: t('adm.pil.kpi.newPros'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'selling', header: t('adm.pil.kpi.selling'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    { accessorKey: 'buyers', header: t('adm.pil.kpi.buyers'), meta: { align: 'right' }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
  ], [t, lang]);

  const months = useMemo(() => (d ? [...d.months].reverse() : null), [d]);
  const conc = d?.concentration;
  const share = conc ? topShare(conc.top5, conc.total, conc.pros_selling) : null;

  if (q.error && !d) return <Page title={t('adm.pil.ov.title')}><ErrorState onRetry={() => void q.refetch()} /></Page>;

  return (
    <Page title={t('adm.pil.ov.title')} subtitle={t('adm.pil.ov.sub')} period>
      <KpiRow>
        <Kpi label={t(moneyLabelKey('sales'))} hint={t(moneyHintKey('sales'))} loading={!k}
          value={fmtEur(k?.sales.cur, lang, { cents: false })} current={k?.sales.cur} previous={k?.sales.prev} to="/admin/money" />
        <Kpi label={t(moneyLabelKey('yunoRevenue'))} hint={t(moneyHintKey('yunoRevenue'))} loading={!k}
          value={fmtEur(revCur, lang)} current={revCur} previous={revPrev} to="/admin/money" />
        <Kpi label={t(moneyLabelKey('mrr'))} hint={t(moneyHintKey('mrr'))} loading={!k}
          value={fmtEur(k?.mrr.cur, lang, { cents: false })} current={k?.mrr.cur} previous={k?.mrr.prev} to="/admin/money/crm" />
        <Kpi label={t('adm.pil.kpi.selling')} hint={t('adm.pil.kpi.selling.hint')} loading={!k}
          value={fmtNum(k?.selling.cur, lang)} current={k?.selling.cur} previous={k?.selling.prev} to="/admin/pros?status=selling" />
        <Kpi label={t('adm.pil.kpi.buyers')} hint={t('adm.pil.kpi.buyers.hint')} loading={!k}
          value={fmtNum(k?.buyers.cur, lang)} current={k?.buyers.cur} previous={k?.buyers.prev} to="/admin/pilot/audience" />
        <Kpi label={t('adm.pil.kpi.newPros')} hint={t('adm.pil.kpi.newPros.hint')} loading={!k}
          value={fmtNum(k?.new_pros.cur, lang)} current={k?.new_pros.cur} previous={k?.new_pros.prev} to="/admin/pilot/acquisition" />
      </KpiRow>

      <Card title={t('adm.pil.ov.revenueChart')} footer={t('adm.pil.ov.revenueFoot')}>
        <Chart kind="line" data={series} x="d" unit="eur" loading={!d} error={q.error} onRetry={() => void q.refetch()}
          formatX={(v) => fmtAxisDay(v, lang)}
          series={[{ key: 'total', label: t(moneyLabelKey('yunoRevenue')) }]}
          previous={{ key: 'prev', label: t('adm.pil.ov.prevPeriod') }} />
      </Card>

      <Card title={t('adm.pil.ov.sourcesChart')}>
        <Chart kind="stacked" data={series} x="d" unit="eur" loading={!d} error={q.error} onRetry={() => void q.refetch()}
          formatX={(v) => fmtAxisDay(v, lang)}
          series={[
            { key: 'fees', label: t(moneyLabelKey('fees')), color: 'var(--a-chart-1)' },
            { key: 'subs', label: t(moneyLabelKey('subs')), color: 'var(--a-chart-2)' },
            { key: 'recharges', label: t(moneyLabelKey('recharges')), color: 'var(--a-chart-3)' },
          ]} />
      </Card>

      <Section title={t('adm.pil.ov.monthsTitle')} description={t('adm.pil.ov.monthsSub')}>
        <DataTable data={months} columns={monthColumns} loading={!d} error={q.error} onRetry={() => void q.refetch()} pageSize={12} />
      </Section>

      <Section title={t('adm.pil.ov.concTitle')} description={t('adm.pil.ov.concSub')}>
        <Card>
          {!conc ? <div className="a-skel h-20 w-full" /> : (
            <div className="flex flex-col gap-3">
              <p className="a-t1 text-[14px]">
                {share == null
                  ? t('adm.pil.ov.concRaw', { top: fmtEur(conc.top5, lang, { cents: false }), total: fmtEur(conc.total, lang, { cents: false }), n: fmtNum(conc.pros_selling, lang) })
                  : t('adm.pil.ov.concPct', { pct: fmtPct(share * 100), n: fmtNum(conc.pros_selling, lang) })}
              </p>
              {conc.pros_selling < 10 && <p className="a-t3 text-[12px]">{t('adm.pil.smallSample')}</p>}
              <ol className="flex flex-col gap-1.5">
                {conc.top.map((p, i) => (
                  <li key={p.key} className="flex items-center gap-3 text-[13px]">
                    <span className="a-t3 a-num w-5">{i + 1}</span>
                    <TextLink to={proHref(p.key)} className="flex-1">{p.name ?? p.key}</TextLink>
                    <span className="a-num a-t1 font-medium">{fmtEur(p.amount, lang, { cents: false })}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Card>
      </Section>
      <p className="a-t3 text-[12px]">{t('adm.pil.ov.demoNote')}</p>
    </Page>
  );
}
