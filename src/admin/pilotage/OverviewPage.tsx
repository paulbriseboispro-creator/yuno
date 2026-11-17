/**
 * Pilotage › Vue d'ensemble (v3) : « Comment va l'entreprise ? »
 *   1. Héros : le revenu de Yuno de la période, en une phrase, son grand
 *      chiffre et sa courbe contre la période précédente (pic annoté, plage
 *      qu'on glisse pour lire un morceau) ; à droite, sa composition (barre à
 *      100 %) et la cascade ventes → revenu → coûts → marge ;
 *   2. les autres chiffres en small multiples sur les 12 mois (même axe) ;
 *   3. les 12 mois en tableau à cellules teintées ;
 *   4. la concentration : les cinq pros qui vendent le plus, en barres triées.
 * Source : admin_pilot_overview ; coûts : admin_costs_list (saisis au mois, donc
 * seulement sur 12 mois). Les mots d'argent : src/admin/money/terms.ts.
 */
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  Block, DataTable, ErrorState, Hero, HeroChart, HoverSync, Page, RankBars, SmallMultiples, StackedShare, Waterfall,
  cellTint, useAdminFilters, useAdminT, type ColumnDef, type Multiple, type Step,
} from '@/admin/ui';
import { fmtAxisDay, fmtCompact, fmtEur, fmtNum, fmtPct } from '@/lib/adminFormat';
import { monthCosts, moneyLabelKey, topShare, yunoRevenue } from '../money/terms';
import { useCosts } from '../money/data';
import { usePilotOverview, type OverviewMonth } from './data';
import { fmtMonth, proHref } from './format';
import { relativeDelta } from '../context/period';

export default function OverviewPage() {
  const { t, lang } = useAdminT();
  const { range, includeDemo, period } = useAdminFilters();
  const q = usePilotOverview(range, includeDemo);
  const costs = useCosts();
  const d = q.data;
  const k = d?.kpis;
  const [sel, setSel] = useState<[number, number] | null>(null);

  const eur = (v: number) => fmtEur(v, lang);
  const eur0 = (v: number) => fmtEur(v, lang, { cents: false });
  const revCur = k ? yunoRevenue({ fees: k.fees.cur, subs: k.subs.cur, recharges: k.recharges.cur }) : 0;
  const revPrev = k ? yunoRevenue({ fees: k.fees.prev, subs: k.subs.prev, recharges: k.recharges.prev }) : 0;

  const points = useMemo(() => (d ? d.series.map((row, i) => ({ x: row.d, v: yunoRevenue(row), prev: d.prev_series[i]?.total ?? null })) : []), [d]);
  const selSum = sel ? points.slice(sel[0], sel[1] + 1).reduce((s, p) => s + (p.v ?? 0), 0) : null;
  const selPrev = sel ? points.slice(sel[0], sel[1] + 1).reduce((s, p) => s + (p.prev ?? 0), 0) : null;

  // La phrase-réponse : ce que Yuno a gagné, comment ça évolue, d'où ça vient.
  const delta = relativeDelta(revCur, revPrev);
  const sentence = !k ? null : sel ? (
    <>{t('adm.pil.v3.selSentence', { from: fmtAxisDay(points[sel[0]].x, lang), to: fmtAxisDay(points[sel[1]].x, lang) })} <b>{eur(selSum ?? 0)}</b>{selPrev ? <> {t('adm.pil.v3.selVs', { prev: eur(selPrev) })}</> : null}.</>
  ) : revCur === 0 ? (
    <>{t('adm.pil.v3.none', { period: t(`adm.pil.v3.per.${period}`) })}</>
  ) : (
    <>
      {t('adm.pil.v3.earned', { period: t(`adm.pil.v3.per.${period}`) })}
      {delta == null ? '' : t(delta >= 0 ? 'adm.pil.v3.up' : 'adm.pil.v3.down', { pct: fmtPct(Math.abs(delta) * 100, Math.abs(delta) < 0.1 ? 1 : 0, lang) })}
      {t('adm.pil.v3.from')} <b>{eur0(k.sales.cur)}</b> {t(k.selling.cur === 1 ? 'adm.pil.v3.soldByOne' : 'adm.pil.v3.soldBy', { n: fmtNum(k.selling.cur, lang) })}
      {k.mrr.cur > 0 ? <>{t('adm.pil.v3.mrr')} <b>{eur0(k.mrr.cur)}</b></> : null}.
    </>
  );

  // Composition du revenu et cascade jusqu'à la marge.
  const parts = k ? [
    { key: 'fees', label: t(moneyLabelKey('fees')), value: k.fees.cur, display: eur(k.fees.cur) },
    { key: 'subs', label: t(moneyLabelKey('subs')), value: k.subs.cur, display: eur(k.subs.cur) },
    { key: 'recharges', label: t(moneyLabelKey('recharges')), value: k.recharges.cur, display: eur(k.recharges.cur) },
  ] : [];
  const costTotal = useMemo(() => {
    if (period !== '12m' || !costs.data) return null;
    return costs.data.months.reduce((s, m) => s + monthCosts(m.lines, m.ai_auto).total, 0);
  }, [period, costs.data]);
  const steps: Step[] = k ? [
    { key: 'sales', label: t(moneyLabelKey('sales')), value: k.sales.cur, display: eur0(k.sales.cur), total: true },
    { key: 'pros', label: t('adm.pil.v3.toPros'), value: -(k.sales.cur - k.fees.cur), display: `− ${eur0(k.sales.cur - k.fees.cur)}` },
    { key: 'subs', label: t(moneyLabelKey('subs')), value: k.subs.cur, display: `+ ${eur0(k.subs.cur)}` },
    { key: 'recharges', label: t(moneyLabelKey('recharges')), value: k.recharges.cur, display: `+ ${eur0(k.recharges.cur)}` },
    { key: 'rev', label: t(moneyLabelKey('yunoRevenue')), value: revCur, display: eur0(revCur), total: true },
    costTotal == null
      ? { key: 'costs', label: t(moneyLabelKey('costs')), value: 0, display: '—', unknown: t('adm.pil.v3.costsMonthly') }
      : { key: 'costs', label: t(moneyLabelKey('costs')), value: -costTotal, display: `− ${eur0(costTotal)}` },
    ...(costTotal == null ? [] : [{ key: 'margin', label: t(moneyLabelKey('margin')), value: revCur - costTotal, display: eur0(revCur - costTotal), total: true }]),
  ] : [];

  // Les autres chiffres : valeur de la période, courbe des 12 mois.
  const months = useMemo(() => (d ? [...d.months].sort((a, b) => a.m.localeCompare(b.m)) : []), [d]);
  const multiples: Multiple[] = k ? [
    { key: 'sales', label: t(moneyLabelKey('sales')), total: eur0(k.sales.cur), current: k.sales.cur, previous: k.sales.prev, series: months.map((m) => m.sales), format: eur0, kind: 'bar', to: '/admin/money' },
    { key: 'mrr', label: t(moneyLabelKey('mrr')), total: eur0(k.mrr.cur), current: k.mrr.cur, previous: k.mrr.prev, series: months.map((m) => m.mrr_end), format: eur0, to: '/admin/money/crm', emptyText: t('adm.pil.v3.noMrr') },
    { key: 'selling', label: t('adm.pil.kpi.selling'), total: fmtNum(k.selling.cur, lang), current: k.selling.cur, previous: k.selling.prev, series: months.map((m) => m.selling), format: (v) => fmtNum(v, lang), kind: 'bar', to: '/admin/pros?status=selling' },
    { key: 'buyers', label: t('adm.pil.kpi.buyers'), total: fmtNum(k.buyers.cur, lang), current: k.buyers.cur, previous: k.buyers.prev, series: months.map((m) => m.buyers), format: (v) => fmtNum(v, lang), kind: 'bar', to: '/admin/pilot/audience' },
    { key: 'new', label: t('adm.pil.kpi.newPros'), total: fmtNum(k.new_pros.cur, lang), current: k.new_pros.cur, previous: k.new_pros.prev, series: months.map((m) => m.new_pros), format: (v) => fmtNum(v, lang), kind: 'bar', to: '/admin/pilot/acquisition' },
    { key: 'refunds', label: t(moneyLabelKey('refunds')), total: eur0(k.refunds.cur), current: k.refunds.cur, previous: k.refunds.prev, invert: true, series: months.map((m) => m.refunds), format: eur0, kind: 'bar', to: '/admin/money/orders?status=refunded', emptyText: t('adm.pil.v3.noRefund') },
  ] : [];

  // Les 12 mois, cellules teintées selon la valeur de leur colonne.
  const maxOf = (f: (m: OverviewMonth) => number) => Math.max(0, ...months.map(f));
  const monthColumns = useMemo<ColumnDef<OverviewMonth, unknown>[]>(() => {
    const mx = { sales: maxOf((m) => m.sales), rev: maxOf((m) => yunoRevenue(m)), mrr: maxOf((m) => m.mrr_end), np: maxOf((m) => m.new_pros) };
    return [
      { accessorKey: 'm', header: t('adm.pil.ov.month'), cell: (c) => <span className="a-mono whitespace-nowrap text-[12px]">{fmtMonth(c.getValue<string>(), lang)}</span> },
      { accessorKey: 'sales', header: t(moneyLabelKey('sales')), meta: { align: 'right', tint: (r) => cellTint(r.sales, mx.sales) }, cell: (c) => eur0(c.getValue<number>()) },
      { id: 'revenue', accessorFn: (r) => yunoRevenue(r), header: t(moneyLabelKey('yunoRevenue')), meta: { align: 'right', tint: (r) => cellTint(yunoRevenue(r), mx.rev) }, cell: (c) => eur(c.getValue<number>()) },
      { accessorKey: 'mrr_end', header: t('adm.pil.ov.mrrEnd'), meta: { align: 'right', tint: (r) => cellTint(r.mrr_end, mx.mrr) }, cell: (c) => eur0(c.getValue<number>()) },
      { accessorKey: 'new_pros', header: t('adm.pil.kpi.newPros'), meta: { align: 'right', tint: (r) => cellTint(r.new_pros, mx.np) }, cell: (c) => fmtNum(c.getValue<number>(), lang) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- maxOf lit `months`, déjà en dépendance
  }, [t, lang, months]);

  const conc = d?.concentration;
  const share = conc ? topShare(conc.top5, conc.total, conc.pros_selling) : null;

  if (q.error && !d) return <Page title={t('adm.pil.ov.title')} period><ErrorState onRetry={() => void q.refetch()} /></Page>;

  return (
    <Page title={t('adm.pil.ov.title')} period>
      <HoverSync>
        <Hero
          kicker={t('adm.pil.v3.kicker', { period: t(`adm.pil.v3.per.${period}`) })}
          loading={!k}
          value={sel ? eur(selSum ?? 0) : eur(revCur)}
          current={sel ? selSum : revCur}
          previous={sel ? selPrev : revPrev}
          sentence={sentence}
          actions={sel ? (
            <button type="button" className="a-btn a-btn--sm" onClick={() => setSel(null)} aria-label={t('adm.pil.v3.clearSel')}>
              {fmtAxisDay(points[sel[0]].x, lang)} → {fmtAxisDay(points[sel[1]].x, lang)}<X className="h-3.5 w-3.5" />
            </button>
          ) : undefined}
          chart={!d ? <div className="a-skel h-[220px] w-full" /> : (
            <HeroChart data={points} formatX={(x) => fmtAxisDay(x, lang)} formatV={eur} formatTick={(v) => (v >= 1000 ? `${fmtCompact(v, lang)} €` : `${fmtNum(v, lang)} €`)}
              selection={sel} onSelect={setSel}
              labels={{ cur: t(moneyLabelKey('yunoRevenue')), prev: t('adm.pil.ov.prevPeriod'), peak: t('adm.pil.v3.peak') }} />
          )}
          note={<>{t('adm.pil.v3.note')} {t('adm.pil.v3.dragHint')}.</>}
          aside={k && (
            <>
              <Block title={t('adm.pil.v3.compTitle')}>
                <StackedShare parts={parts} emptyText={t('adm.pil.v3.compEmpty')} fmtShare={(s) => fmtPct(s * 100, 0, lang)} />
              </Block>
              <Block title={t('adm.pil.v3.waterTitle')}>
                <Waterfall steps={steps} />
              </Block>
            </>
          )} />
      </HoverSync>

      <Block title={t('adm.pil.v3.multiTitle')} meta={t('adm.pil.v3.multiMeta')}>
        {!k ? <div className="a-skel h-28 w-full" /> : (
          <HoverSync>
            <SmallMultiples items={multiples} xLabels={months.map((m) => fmtMonth(m.m, lang))} columns={3} height={48} />
          </HoverSync>
        )}
      </Block>

      <div className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Block title={t('adm.pil.ov.monthsTitle')} meta={t('adm.pil.v3.monthsMeta')}>
          <DataTable data={d ? [...months].reverse() : null} columns={monthColumns} loading={!d} error={q.error} onRetry={() => void q.refetch()} pageSize={12} bare />
        </Block>
        <Block title={t('adm.pil.ov.concTitle')}>
          {!conc ? <div className="a-skel h-40 w-full" /> : (
            <div className="flex flex-col gap-3">
              <p className="a-hero-sentence text-[14px]">
                {share == null
                  ? t('adm.pil.ov.concRaw', { top: eur0(conc.top5), total: eur0(conc.total), n: fmtNum(conc.pros_selling, lang) })
                  : t('adm.pil.ov.concPct', { pct: fmtPct(share * 100, 0, lang), n: fmtNum(conc.pros_selling, lang) })}
              </p>
              <RankBars emptyText={t('adm.pil.v3.concEmpty')} max={conc.top[0]?.amount}
                items={conc.top.map((p) => ({ key: p.key, label: p.name ?? p.key, value: p.amount, display: eur0(p.amount), to: proHref(p.key), sub: conc.total > 0 ? fmtPct((p.amount / conc.total) * 100, 0, lang) : undefined }))} />
              {conc.pros_selling < 10 && <p className="a-t3 text-[12px]">{t('adm.pil.smallSample')}</p>}
            </div>
          )}
        </Block>
      </div>
      <p className="a-t3 text-[12px]">{t('adm.pil.ov.demoNote')}</p>
    </Page>
  );
}
