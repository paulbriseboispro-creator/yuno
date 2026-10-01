/**
 * « Comment évoluent mes ventes ? » pour TOUTES les soirées d'une période : la
 * courbe J-N MOYENNE par soirée (ventes cumulées, alignées sur le nombre de
 * jours avant la soirée), en rouge, contre la même moyenne sur les soirées de
 * la période d'avant, en encre pointillée. C'est la jumelle de `ReportTrend`
 * (une soirée contre une autre) : mêmes mesures, même échelle, même lecture.
 * Les chiffres viennent de `get_sales_period_curve` ; ici on ne fait que
 * cumuler et diviser par le nombre de soirées.
 */
import { useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import type { ReportDay, SeriesMetric } from '@/lib/eventReport';
import type { PeriodCurve } from '@/hooks/usePeriodInsights';
import { CardTitle, EmptyNote, ReportCard, Segmented } from './ui';

const MAIN = '#E8192C';
const COMPARE = 'rgb(var(--ink)/0.5)';

interface Point { d: number; main: number | null; compare: number | null }

function valueOf(day: ReportDay | undefined, metric: SeriesMetric): number {
  if (!day) return 0;
  return metric === 'amount' ? day.amount ?? 0 : day[metric];
}

/** Les mesures qui ont un sens sur cette période (pas de CA sans argent visible ni sans vente payante). */
function availableMetrics(c: PeriodCurve): SeriesMetric[] {
  const sum = (metric: SeriesMetric) => c.cur.series.reduce((acc, s) => acc + valueOf(s, metric), 0);
  const out: SeriesMetric[] = [];
  if (sum('tickets') > 0) out.push('tickets');
  if (c.money && sum('amount') > 0) out.push('amount');
  if (sum('guests') > 0) out.push('guests');
  if (sum('tables') > 0) out.push('tables');
  out.push('visits');
  return out;
}

/**
 * Points de J-90 au lendemain : moyenne PAR SOIRÉE (total du bucket ÷ nombre
 * de soirées), cumulée par défaut. Ce qui s'est vendu avant J-90 entre dans
 * le point de départ, comme dans `buildCurve`.
 */
function buildPeriodCurve(c: PeriodCurve, metric: SeriesMetric, cumulative: boolean): Point[] {
  const mainBy = new Map(c.cur.series.map((s) => [s.d, s]));
  const cmpBy = new Map(c.prev.series.map((s) => [s.d, s]));
  const allD = [...mainBy.keys(), ...cmpBy.keys()];
  if (allD.length === 0 || c.cur.nights === 0) return [];
  const maxD = Math.min(Math.max(...allD, 0), 90);
  const minD = Math.max(Math.min(...allD, 0, -1), -3);
  const nMain = c.cur.nights;
  const nCmp = c.prev.nights;
  let accMain = 0;
  let accCmp = 0;
  for (const [d, s] of mainBy) if (d > maxD) accMain += valueOf(s, metric);
  for (const [d, s] of cmpBy) if (d > maxD) accCmp += valueOf(s, metric);
  const points: Point[] = [];
  for (let d = maxD; d >= minD; d--) {
    const vm = valueOf(mainBy.get(d), metric);
    const vc = valueOf(cmpBy.get(d), metric);
    accMain += vm;
    accCmp += vc;
    points.push({
      d,
      main: (cumulative ? accMain : vm) / nMain,
      compare: nCmp > 0 ? (cumulative ? accCmp : vc) / nCmp : null,
    });
  }
  return points;
}

function dayLabel(d: number, t: (k: string) => string): string {
  if (d > 0) return t('er.day.before').replace('{n}', String(d));
  if (d === 0) return t('er.day.j');
  return t('er.day.after').replace('{n}', String(-d));
}

export function PeriodTrend({ curve }: { curve: PeriodCurve }) {
  const { t, language } = useLanguage();
  const { n, eur } = useNumberFormat();
  const metrics = availableMetrics(curve);
  const [metric, setMetric] = useState<SeriesMetric>(metrics[0]);
  const [mode, setMode] = useState<'cum' | 'day'>('cum');
  const active = metrics.includes(metric) ? metric : metrics[0];
  const fmt = (v: number) => (active === 'amount' ? eur(v) : n(Math.round(v * 10) / 10));

  const points = useMemo(() => buildPeriodCurve(curve, active, mode === 'cum'), [curve, active, mode]);
  const finalMain = points.length ? points.find((p) => p.d === 0)?.main ?? points[points.length - 1].main : null;
  const finalCmp = points.length ? points.find((p) => p.d === 0)?.compare ?? points[points.length - 1].compare : null;
  const hasCompare = curve.prev.nights > 0;

  const metricOptions = metrics.map((m) => ({ value: m, label: t(`er.metric.${m}`) }));

  return (
    <ReportCard>
      <CardTitle
        title={t(`er.metric.${active}`) + ` · ${t('pi.perNight').toLowerCase()}`}
        hint={t('pi.curveHint')}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented<SeriesMetric> label={t('er.metricLabel')} value={active} options={metricOptions} onChange={setMetric} />
        <Segmented<'cum' | 'day'> label={t('er.modeLabel')} value={mode} onChange={setMode}
          options={[{ value: 'cum', label: t('er.cumulative') }, { value: 'day', label: t('er.daily') }]} />
      </div>

      {curve.cur.nights > 0 && finalMain !== null && mode === 'cum' && (
        <p className="mb-3 text-[13px]" style={{ color: KIT.T2 }}>
          {(hasCompare && finalCmp !== null ? t('pi.curveSentence') : t('pi.curveSentenceAlone'))
            .replace('{main}', fmt(finalMain))
            .replace('{n}', n(curve.cur.nights))
            .replace('{cmp}', fmt(finalCmp ?? 0))
            .replace('{m}', n(curve.prev.nights))}
          {hasCompare && finalCmp !== null && finalCmp > 0 && (
            <strong className="ml-1 tabular-nums" style={{ color: finalMain >= finalCmp ? 'var(--acc-34d399)' : 'var(--acc-ff5c63)' }}>
              {finalMain >= finalCmp ? '+' : ''}{Math.round(((finalMain - finalCmp) / finalCmp) * 100)} %
            </strong>
          )}
        </p>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-4 text-[12px]" style={{ color: KIT.T2 }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-4 rounded" style={{ background: MAIN }} aria-hidden />
          {t('pi.thisPeriod').replace('{n}', n(curve.cur.nights))}
        </span>
        {hasCompare && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: COMPARE }} aria-hidden />
            <span className="truncate">{t('pi.prevPeriod').replace('{n}', n(curve.prev.nights))}</span>
          </span>
        )}
      </div>

      {points.length === 0 ? (
        <EmptyNote text={t(curve.cur.nights === 0 ? 'pi.noNights' : 'er.trend.empty')} />
      ) : (
        <div className="h-[260px] w-full" lang={language}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="piMain" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={MAIN} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={MAIN} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgb(var(--ink)/0.06)" />
              <XAxis
                dataKey="d"
                tickFormatter={(d: number) => dayLabel(d, t)}
                tick={{ fill: 'rgb(var(--ink)/0.4)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                width={48}
                tick={{ fill: 'rgb(var(--ink)/0.4)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => (active === 'amount' ? eur(v) : n(v))}
              />
              <Tooltip
                cursor={{ stroke: 'rgb(var(--ink)/0.25)', strokeDasharray: '3 3' }}
                contentStyle={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${KIT.BORDER}`, borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: KIT.T3 }}
                itemStyle={{ color: KIT.T1 }}
                labelFormatter={(d) => dayLabel(Number(d), t)}
                formatter={(value, name) => [
                  fmt(Number(value)),
                  name === 'main' ? t('pi.thisPeriod').replace('{n}', n(curve.cur.nights)) : t('pi.prevPeriod').replace('{n}', n(curve.prev.nights)),
                ]}
              />
              <ReferenceLine x={0} stroke="rgb(var(--ink)/0.2)" strokeDasharray="2 4" />
              {hasCompare && (
                <Line type="monotone" dataKey="compare" stroke={COMPARE} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} connectNulls />
              )}
              <Area type="monotone" dataKey="main" stroke={MAIN} strokeWidth={2} fill="url(#piMain)" dot={false} isAnimationActive={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ReportCard>
  );
}
