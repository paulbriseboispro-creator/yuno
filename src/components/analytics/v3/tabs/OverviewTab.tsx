/**
 * Vue d'ensemble (spec §4.1) : six KPI (valeur · delta · référence · sparkline),
 * le graphe principal piloté par la KPI touchée (pacing J-n d'une soirée, ou une
 * barre par soirée sur une période), trois classements, le tableau des soirées.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAn3Insights, useAn3Overview, useAn3Pacing, cardState, type An3Subject } from '@/hooks/useAn3';
import { InsightsBand } from '../InsightsBand';
import { BenchmarksCard } from '../IntelligenceCards';
import type { An3Tab } from '@/lib/analytics/an3Nav';
import type { An3Aggregate, An3Overview, An3Scope } from '@/lib/analytics/an3Types';
import type { An3Compare } from '@/lib/analytics/an3Nav';
import { an3Locale, compactMoney, compactNumber, deltaShape, deltaText, deltaTone, formatValue, pct, type An3Format } from '@/lib/analytics/an3Format';
import { deliverCsv, type CsvCell } from '@/lib/analytics/an3Csv';
import { A3Answer, A3Card, A3Status, A3Swatch } from '../an3Ui';
import { A3, MAIN_CHART_H } from '../an3Tokens';
import { KpiCard, type KpiSpec } from '../KpiCard';
import { PacingChart, type PacingMetric } from '../charts/PacingChart';
import { NightsBars } from '../charts/NightsBars';
import { HBarList, type HBarRow } from '../charts/HBarList';
import { DetailDrawer, type DrawerTable } from '../DetailDrawer';
import { compareLabel } from '../an3Labels';

type KpiKey = 'revenue' | 'tickets' | 'conversion' | 'aov' | 'attendance' | 'new_share';

function ratio(n: number, d: number, min = 1): number | null { return d >= min && d > 0 ? (n / d) * 100 : null; }

function kpiValue(a: An3Aggregate | null, key: KpiKey, median: boolean): number | null {
  if (!a) return null;
  if (median) {
    const m = a.median;
    return key === 'revenue' ? m.revenue : key === 'tickets' ? m.tickets : key === 'conversion' ? m.conversion : key === 'aov' ? m.aov : key === 'attendance' ? m.attendance : m.new_share;
  }
  switch (key) {
    case 'revenue': return a.money_nights > 0 ? a.revenue : null;
    case 'tickets': return a.tickets;
    case 'conversion': return ratio(a.buyers, a.visitors, 10);
    case 'aov': return a.orders > 0 && a.money_nights > 0 ? a.money_revenue / a.orders : null;
    case 'attendance': return a.scanned_nights > 0 && a.expected > 0 ? Math.min(100, (a.entries / a.expected) * 100) : null;
    case 'new_share': return ratio(a.new_customers, a.customers, 10);
  }
}

export function OverviewTab({ scope, subject, compare, onOpenEvent, registerExport, onOpenTab }: {
  scope: An3Scope; subject: An3Subject; compare: An3Compare; onOpenEvent: (id: string) => void;
  registerExport: (fn: (() => void) | null) => void; onOpenTab: (tab: An3Tab) => void;
}) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const q = useAn3Overview(scope, subject, compare);
  const data = q.data;
  const money = data?.money ?? false;
  const [metric, setMetric] = useState<KpiKey>('tickets');
  const pacing = useAn3Pacing(subject.eventId, compare);
  const insights = useAn3Insights(scope, subject, compare);
  const [drawer, setDrawer] = useState<'rounds' | 'promoters' | 'sources' | null>(null);
  useEffect(() => { if (!money && (metric === 'revenue' || metric === 'aov')) setMetric('tickets'); }, [money, metric]);

  const vs = data ? compareLabel(t, language, data.compare) : '';
  const median = data?.compare.median ?? false;
  const cur = data?.current ?? null, ref = data?.reference ?? null;

  const specs = useMemo<KpiSpec[]>(() => {
    if (!data || !cur) return [];
    const isEvent = data.subject.kind === 'event';
    const sparks = (key: 'revenue' | 'tickets' | 'aov' | 'conversion' | 'attendance' | 'new_share') => {
      if (isEvent) {
        if (key !== 'revenue' && key !== 'tickets') return undefined;
        const pts = data.series.slice().sort((a, b) => b.d - a.d);
        return { cur: pts.map((p) => (key === 'revenue' ? p.revenue : p.tickets)), ref: pts.map((p) => (key === 'revenue' ? p.ref_revenue : p.ref_tickets)) };
      }
      const pick = (n: An3Aggregate['per_night'][number]) => key === 'revenue' ? (n.money ? n.revenue : null) : key === 'tickets' ? n.tickets : key === 'aov' ? n.aov : key === 'conversion' ? n.conversion : key === 'attendance' ? n.attendance : n.new_share;
      return { cur: cur.per_night.map(pick), ref: (ref?.per_night ?? []).map(pick) };
    };
    const refOf = (key: KpiKey) => kpiValue(ref, key, median);
    const vsText = (key: KpiKey, format: An3Format) => {
      const r = refOf(key);
      return r == null ? (data.compare.kind === 'none' ? undefined : t('an3.vs.noRef')) : `${t('an3.vs.prefix')} ${formatValue(r, format, locale)} · ${vs}`;
    };
    const list: KpiSpec[] = [];
    if (money) list.push({ key: 'revenue', label: t('an3.kpi.revenue'), hint: t('an3.kpi.revenueHint'), value: kpiValue(cur, 'revenue', false), reference: refOf('revenue'), format: 'money', polarity: 'up', vsLabel: vsText('revenue', 'money'), series: sparks('revenue') });
    list.push({
      key: 'tickets', label: t('an3.kpi.tickets'), hint: t('an3.kpi.ticketsHint'), value: cur.tickets, reference: refOf('tickets'), format: 'n', polarity: 'up',
      vsLabel: vsText('tickets', 'n'), series: sparks('tickets'), unit: t('an3.unit.tickets'),
      progress: cur.cap ? (cur.tickets_with_cap / cur.cap) * 100 : null,
      sub: cur.cap ? t('an3.kpi.sellThrough').replace('{pct}', pct((cur.tickets_with_cap / cur.cap) * 100, locale)).replace('{cap}', compactNumber(cur.cap, locale)) : undefined,
    });
    list.push({
      key: 'conversion', label: t('an3.kpi.conversion'), hint: t('an3.kpi.conversionHint'), value: kpiValue(cur, 'conversion', false), reference: refOf('conversion'), format: 'pct', polarity: 'up', pointDiff: true,
      vsLabel: vsText('conversion', 'pct'), series: sparks('conversion'),
      sub: cur.visitors > 0 ? t('an3.kpi.conversionSub').replace('{buyers}', compactNumber(cur.buyers, locale)).replace('{visitors}', compactNumber(cur.visitors, locale)) : t('an3.kpi.noVisits'),
    });
    if (money) list.push({ key: 'aov', label: t('an3.kpi.aov'), hint: t('an3.kpi.aovHint'), value: kpiValue(cur, 'aov', false), reference: refOf('aov'), format: 'money', polarity: 'up', vsLabel: vsText('aov', 'money'), series: sparks('aov') });
    list.push({
      key: 'attendance', label: t('an3.kpi.attendance'), hint: t('an3.kpi.attendanceHint'), value: kpiValue(cur, 'attendance', false), reference: refOf('attendance'), format: 'pct', polarity: 'up', pointDiff: true,
      vsLabel: vsText('attendance', 'pct'), series: sparks('attendance'),
      sub: cur.scanned_nights > 0 ? t('an3.kpi.attendanceSub').replace('{in}', compactNumber(cur.entries, locale)).replace('{exp}', compactNumber(cur.expected, locale)) : (isEvent && data.subject.kind === 'event' && data.subject.event.status !== 'past' ? t('an3.kpi.afterNight') : t('an3.kpi.noScan')),
    });
    list.push({
      key: 'new_share', label: t('an3.kpi.newShare'), hint: t('an3.kpi.newShareHint'), value: kpiValue(cur, 'new_share', false), reference: refOf('new_share'), format: 'pct', polarity: 'neutral', pointDiff: true,
      vsLabel: vsText('new_share', 'pct'), series: sparks('new_share'),
      sub: t('an3.kpi.newShareSub').replace('{new}', compactNumber(cur.new_customers, locale)).replace('{all}', compactNumber(cur.customers, locale)),
    });
    return list;
  }, [data, cur, ref, median, money, vs, t, locale]);

  // Export CSV : les soirées (période) ou la courbe (soirée).
  useEffect(() => {
    if (!data) { registerExport(null); return; }
    registerExport(() => {
      if (data.subject.kind === 'period') {
        const header = [t('an3.col.night'), t('an3.col.date'), t('an3.col.tickets'), t('an3.col.tables'), t('an3.col.guestList'), t('an3.col.entries'), t('an3.col.expected'), t('an3.col.customers'), ...(money ? [t('an3.col.revenue')] : [])];
        const rows: CsvCell[][] = data.nights.map((n) => [n.title, n.start_at.slice(0, 10), n.tickets, n.tables, n.gl, n.entries, n.expected, n.customers, ...(money ? [n.money ? n.revenue : null] : [])]);
        void deliverCsv('analytics-soirees', header, rows);
      } else {
        const header = ['J-n', t('an3.col.tickets'), `${t('an3.col.tickets')} (${t('an3.vs.ref')})`, ...(money ? [t('an3.col.revenue'), `${t('an3.col.revenue')} (${t('an3.vs.ref')})`] : [])];
        const rows: CsvCell[][] = data.series.map((p) => [p.d, p.tickets, p.ref_tickets, ...(money ? [p.revenue, p.ref_revenue] : [])]);
        void deliverCsv('analytics-pacing', header, rows);
      }
    });
    return () => registerExport(null);
  }, [data, money, registerExport, t]);

  const state = cardState(q, () => true);
  const isEvent = data?.subject.kind === 'event';
  const chartFormat: An3Format = metric === 'revenue' || metric === 'aov' ? 'money' : metric === 'tickets' ? 'n' : 'pct';
  const pacingMetric: PacingMetric = metric === 'revenue' && money ? 'revenue' : 'tickets';
  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });

  const empty = data && cur && cur.nights === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Phrase-réponse */}
      {data && cur && !empty && <Headline data={data} money={money} />}

      {/* Constats par règles (jamais sous 20 observations) */}
      {insights.data && insights.data.insights.length > 0 && <InsightsBand insights={insights.data.insights} onOpen={onOpenTab} />}

      {/* KPI */}
      {state === 'loading' ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <A3Card key={i} state="loading" minHeight={112} />)}
        </div>
      ) : state === 'error' ? (
        <A3Card state="error" error={{ title: t('an3.state.errorTitle'), retry: () => q.refetch() }} minHeight={112} />
      ) : empty ? (
        <A3Card state="empty" minHeight={160} empty={{ title: t('an3.empty.noNightsTitle'), body: t(isEvent ? 'an3.empty.noSalesBody' : 'an3.empty.noNightsBody') }} />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {specs.map((s) => <KpiCard key={s.key} spec={s} active={metric === s.key} onSelect={() => setMetric(s.key as KpiKey)} />)}
        </div>
      )}

      {/* Graphe principal */}
      {isEvent ? (
        <A3Card
          title={pacing.data ? pacingTitle(t, pacing.data, locale) : t('an3.pacing.title')}
          hint={t('an3.pacing.hint')}
          right={pacing.data && pacing.data.status !== 'unknown' ? <PacingStatus status={pacing.data.status} /> : undefined}
          state={cardState(pacing, (d) => d.curve.some((p) => (p.tickets ?? 0) > 0) || d.compare.n > 0)}
          minHeight={MAIN_CHART_H + 96}
          empty={{ title: t('an3.pacing.emptyTitle'), body: t('an3.pacing.emptyBody') }}
          error={{ title: t('an3.state.errorTitle'), retry: () => pacing.refetch() }}
        >
          {pacing.data && (
            <>
              <PacingChart data={pacing.data} metric={pacingMetric} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                <A3Swatch color={A3.accent}>{pacing.data.event.title}</A3Swatch>
                {pacing.data.compare.n > 0 && <A3Swatch color={A3.ref}>{pacing.data.compare.n > 1 ? t('an3.pacing.legendMedian').replace('{n}', String(pacing.data.compare.n)) : `${pacing.data.compare.refs[0]?.title ?? ''} · ${dateFmt.format(new Date(pacing.data.compare.refs[0]?.start_at ?? 0))}`}</A3Swatch>}
                {pacing.data.compare.n > 1 && <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: A3.t2 }}><span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: A3.refSoft }} />{t('an3.pacing.legendBand')}</span>}
              </div>
            </>
          )}
        </A3Card>
      ) : (
        <A3Card
          title={t('an3.chart.perNight').replace('{metric}', t(`an3.kpi.${metric === 'new_share' ? 'newShare' : metric}`))}
          state={state === 'ready' && data && cur && cur.per_night.length > 0 ? 'ready' : state === 'ready' ? 'empty' : state}
          minHeight={MAIN_CHART_H + 96}
          empty={{ title: t('an3.empty.noNightsTitle'), body: t('an3.empty.noNightsBody') }}
        >
          {data && cur && (
            <>
              <NightsBars
                rows={cur.per_night.map((n) => ({ id: n.id, title: n.title, startAt: n.start_at, live: !n.scanned && new Date(n.end_at) > new Date(data.now), value: kpiOfNight(n, metric, money) }))}
                format={chartFormat}
                reference={ref ? kpiValue(ref, metric, true) : null}
                referenceLabel={ref ? t('an3.chart.refMedian') : undefined}
                onSelect={onOpenEvent}
              />
              <p className="m-0 mt-2 text-[11.5px]" style={{ color: A3.t3 }}>{t('an3.chart.tapBar')}</p>
            </>
          )}
        </A3Card>
      )}

      {/* Classements */}
      {data && cur && !empty && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <BreakdownCard title={t('an3.bd.rounds')} rows={data.breakdowns.rounds.map((r) => ({ key: r.name, label: r.name, value: r.qty, display: compactNumber(r.qty, locale), note: money && r.revenue != null ? compactMoney(r.revenue, locale) : undefined }))}
            emptyTitle={t('an3.bd.roundsEmpty')} onOpen={() => setDrawer('rounds')} />
          <BreakdownCard title={t('an3.bd.sources')} rows={data.breakdowns.sources.map((s) => ({ key: s.source, label: t(`an3.source.${s.source}`) === `an3.source.${s.source}` ? s.source : t(`an3.source.${s.source}`), value: s.orders, display: compactNumber(s.orders, locale), note: money && s.revenue != null ? compactMoney(s.revenue, locale) : undefined }))}
            emptyTitle={t('an3.bd.sourcesEmpty')} onOpen={() => setDrawer('sources')} />
          <BreakdownCard title={t('an3.bd.promoters')} rows={data.breakdowns.promoters.map((p) => ({ key: p.id, label: p.name || t('an3.promoter.unnamed'), value: money ? (p.revenue ?? 0) : p.tickets, display: money && p.revenue != null ? compactMoney(p.revenue, locale) : compactNumber(p.tickets, locale), note: t('an3.bd.promoterNote').replace('{n}', compactNumber(p.tickets, locale)) }))}
            emptyTitle={t('an3.bd.promotersEmpty')} onOpen={() => setDrawer('promoters')} />
        </div>
      )}

      {/* Tableau des soirées (période) */}
      {data && cur && !isEvent && data.nights.length > 0 && (
        <A3Card title={t('an3.nights.title')}>
          <NightsTable data={data} money={money} onOpen={onOpenEvent} />
        </A3Card>
      )}

      {data && cur && !empty && !isEvent && (
        <BenchmarksCard scope={scope} mine={{ attendance: kpiValue(cur, 'attendance', false), fill: cur.cap ? (cur.tickets_with_cap / cur.cap) * 100 : null, per_head: money && cur.entries > 0 ? cur.money_revenue / cur.entries : null }} />
      )}

      {data && (
        <DetailDrawer open={drawer !== null} onOpenChange={(o) => !o && setDrawer(null)}
          title={drawer === 'rounds' ? t('an3.bd.rounds') : drawer === 'sources' ? t('an3.bd.sources') : t('an3.bd.promoters')}
          table={drawer ? drawerTable(drawer, data, money, t) : undefined} />
      )}
    </div>
  );
}

function kpiOfNight(n: An3Aggregate['per_night'][number], key: KpiKey, money: boolean): number | null {
  switch (key) {
    case 'revenue': return money && n.money ? n.revenue : null;
    case 'tickets': return n.tickets;
    case 'conversion': return n.conversion;
    case 'aov': return money && n.money ? n.aov : null;
    case 'attendance': return n.attendance;
    case 'new_share': return n.new_share;
  }
}

function Headline({ data, money }: { data: An3Overview; money: boolean }) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const c = data.current, r = data.reference;
  const median = data.compare.median;
  const isEvent = data.subject.kind === 'event';
  const parts: string[] = [];
  if (money && c.money_nights > 0) parts.push(compactMoney(c.revenue, locale));
  parts.push(t('an3.head.tickets').replace('{n}', compactNumber(c.tickets, locale)));
  if (c.scanned_nights > 0) parts.push(t('an3.head.entries').replace('{n}', compactNumber(c.entries, locale)));
  const main = isEvent ? parts.join(', ') : t('an3.head.overNights').replace('{n}', String(c.nights)).replace('{parts}', parts.join(', '));
  let cmp = '';
  const key: KpiKey = money && c.money_nights > 0 ? 'revenue' : 'tickets';
  const cv = kpiValue(c, key, false), rv = kpiValue(r, key, median);
  if (cv != null && rv != null) {
    const shape = deltaShape(cv, rv);
    const tone = deltaTone(shape, 'up');
    const txt = deltaText(shape, key === 'revenue' ? 'money' : 'n', locale);
    const vsLabel = compareLabel(t, language, data.compare);
    if (shape.kind === 'same') cmp = t('an3.head.same').replace('{vs}', vsLabel);
    // « de plus que » / « de moins que » portent déjà le sens : on retire flèche et signe.
    else if (txt) cmp = t(tone === 'good' ? 'an3.head.up' : 'an3.head.down').replace('{delta}', txt.replace(/^[▲▼] [+−]?/, '')).replace('{vs}', vsLabel);
    cmp = cmp.replace(/\.\.$/, '.');
  }
  return <A3Answer><strong style={{ color: A3.t1 }}>{main}.</strong> {cmp}</A3Answer>;
}

function pacingTitle(t: (k: string) => string, p: NonNullable<ReturnType<typeof useAn3Pacing>['data']>, locale: ReturnType<typeof an3Locale>): string {
  if (p.status === 'good' || p.status === 'warn' || p.status === 'bad') {
    const cur = p.at_d.tickets ?? 0, ref = p.at_d.ref_tickets ?? 0;
    const shape = deltaShape(cur, ref);
    const d = deltaText(shape, 'n', locale).replace(/^[▲▼] /, '');
    // Une seule référence : on la nomme, plutôt que « médiane de 1 soirée ».
    const single = p.compare.n === 1 && p.compare.refs[0];
    const vs = single
      ? t('an3.vs.night').replace('{date}', new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(single.start_at)))
      : t('an3.vs.median').replace('{n}', String(p.compare.n));
    return t(p.event.status === 'past' ? 'an3.pacing.titleFinal' : 'an3.pacing.titleAtD').replace('{d}', String(p.today_d)).replace('{delta}', d || '=').replace('{vs}', vs);
  }
  return t('an3.pacing.title');
}

function PacingStatus({ status }: { status: 'good' | 'warn' | 'bad' | 'no_reference_yet' }) {
  const { t } = useLanguage();
  return <A3Status tone={status === 'good' ? 'good' : status === 'warn' ? 'warn' : status === 'bad' ? 'bad' : 'neutral'}>{t(`an3.pacing.status.${status}`)}</A3Status>;
}

function BreakdownCard({ title, rows, emptyTitle, onOpen }: { title: string; rows: HBarRow[]; emptyTitle: string; onOpen: () => void }) {
  const { t } = useLanguage();
  return (
    <A3Card title={title} minHeight={200} state={rows.length ? 'ready' : 'empty'} empty={{ title: emptyTitle }}
      right={<button type="button" onClick={onOpen} className="text-[12px] font-medium min-h-[32px] px-2" style={{ color: A3.accent }}>{t('an3.bd.seeAll')}</button>}>
      <HBarList rows={rows} limit={5} onSelect={() => onOpen()} />
    </A3Card>
  );
}

function drawerTable(kind: 'rounds' | 'promoters' | 'sources', data: An3Overview, money: boolean, t: (k: string) => string): DrawerTable {
  if (kind === 'rounds') return {
    filename: 'analytics-billets', header: [t('an3.col.round'), t('an3.col.price'), t('an3.col.tickets'), ...(money ? [t('an3.col.revenue')] : [])],
    rows: data.breakdowns.rounds.map((r) => [r.name, r.price, r.qty, ...(money ? [r.revenue] : [])]),
  };
  if (kind === 'sources') return {
    filename: 'analytics-sources', header: [t('an3.col.source'), t('an3.col.orders'), ...(money ? [t('an3.col.revenue')] : [])],
    rows: data.breakdowns.sources.map((s) => [t(`an3.source.${s.source}`) === `an3.source.${s.source}` ? s.source : t(`an3.source.${s.source}`), s.orders, ...(money ? [s.revenue] : [])]),
  };
  return {
    filename: 'analytics-promoteurs', header: [t('an3.col.promoter'), t('an3.col.orders'), t('an3.col.tickets'), ...(money ? [t('an3.col.attributed')] : [])],
    rows: data.breakdowns.promoters.map((p) => [p.name || t('an3.promoter.unnamed'), p.orders, p.tickets, ...(money ? [p.revenue] : [])]),
  };
}

function NightsTable({ data, money, onOpen }: { data: An3Overview; money: boolean; onOpen: (id: string) => void }) {
  const { t, language } = useLanguage();
  const locale = an3Locale(language);
  const dateFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const rows = data.nights;
  const cell = (v: string, dim = false) => <span className="tabular-nums" style={{ color: dim ? A3.t3 : A3.t1 }}>{v}</span>;
  return (
    <>
      {/* Desktop : tableau */}
      <div className="hidden md:block overflow-x-auto -mx-1">
        <table className="w-full text-[12.5px]" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              {[t('an3.col.night'), t('an3.col.tickets'), t('an3.col.entries'), ...(money ? [t('an3.col.revenue')] : []), t('an3.col.vsComparable')].map((h, i) => (
                <th key={h} className={`py-2 px-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] ${i === 0 ? 'text-left' : 'text-right'}`} style={{ color: A3.t3, borderBottom: `1px solid ${A3.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const shape = money && n.money && n.ref?.revenue != null ? deltaShape(n.revenue, n.ref.revenue) : n.ref ? deltaShape(n.tickets, n.ref.tickets) : { kind: 'none' as const };
              const tone = deltaTone(shape, 'up');
              const txt = deltaText(shape, money && n.money && n.ref?.revenue != null ? 'money' : 'n', locale);
              return (
                <tr key={n.id} className="cursor-pointer" onClick={() => onOpen(n.id)}>
                  <td className="py-2.5 px-2" style={{ borderBottom: `1px solid ${A3.faint}` }}>
                    <span className="block truncate max-w-[280px]" style={{ color: A3.t1 }}>{n.title}</span>
                    <span className="block text-[11.5px]" style={{ color: A3.t3 }}>{dateFmt.format(new Date(n.start_at))}</span>
                  </td>
                  <td className="py-2.5 px-2 text-right" style={{ borderBottom: `1px solid ${A3.faint}` }}>{cell(compactNumber(n.tickets, locale))}{n.cap ? <span className="text-[11px]" style={{ color: A3.t3 }}> / {compactNumber(n.cap, locale)}</span> : null}</td>
                  <td className="py-2.5 px-2 text-right" style={{ borderBottom: `1px solid ${A3.faint}` }}>{n.scanned ? cell(`${compactNumber(n.entries, locale)} / ${compactNumber(n.expected, locale)}`) : cell(t('an3.nights.notScanned'), true)}</td>
                  {money && <td className="py-2.5 px-2 text-right" style={{ borderBottom: `1px solid ${A3.faint}` }}>{n.money ? cell(compactMoney(n.revenue, locale)) : cell('—', true)}</td>}
                  <td className="py-2.5 px-2 text-right" style={{ borderBottom: `1px solid ${A3.faint}` }}>
                    {txt ? <span className="tabular-nums font-semibold" style={{ color: tone === 'good' ? A3.deltaUp : tone === 'bad' ? A3.deltaDown : A3.t2 }}>{txt}</span> : cell('—', true)}
                    {n.ref && <span className="block text-[11px]" style={{ color: A3.t3 }}>{n.ref.comparable ? t('an3.vs.night').replace('{date}', dateFmt.format(new Date(n.ref.start_at))) : t('an3.vs.previousNight').replace('{date}', dateFmt.format(new Date(n.ref.start_at)))}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Téléphone : cartes */}
      <ul className="md:hidden m-0 p-0 list-none flex flex-col gap-2">
        {rows.map((n) => {
          const shape = money && n.money && n.ref?.revenue != null ? deltaShape(n.revenue, n.ref.revenue) : n.ref ? deltaShape(n.tickets, n.ref.tickets) : { kind: 'none' as const };
          const tone = deltaTone(shape, 'up');
          const txt = deltaText(shape, money && n.money && n.ref?.revenue != null ? 'money' : 'n', locale);
          return (
            <li key={n.id}>
              <button type="button" onClick={() => onOpen(n.id)} className="w-full text-left rounded-xl p-3 min-h-[44px] flex flex-col gap-1" style={{ background: A3.faint, border: `1px solid ${A3.border}` }}>
                <span className="flex items-baseline justify-between gap-2 text-[13px]"><span className="truncate" style={{ color: A3.t1 }}>{n.title}</span><span className="shrink-0 text-[11.5px]" style={{ color: A3.t3 }}>{dateFmt.format(new Date(n.start_at))}</span></span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] tabular-nums" style={{ color: A3.t2 }}>
                  <span>{compactNumber(n.tickets, locale)} {t('an3.unit.tickets')}</span>
                  {n.scanned && <span>{compactNumber(n.entries, locale)} {t('an3.unit.entries')}</span>}
                  {money && n.money && <span style={{ color: A3.t1 }}>{compactMoney(n.revenue, locale)}</span>}
                  {txt && <span className="font-semibold" style={{ color: tone === 'good' ? A3.deltaUp : tone === 'bad' ? A3.deltaDown : A3.t2 }}>{txt}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
