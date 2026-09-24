/**
 * « Comment évoluent mes ventes ? » — courbe jour par jour, alignée sur J-N,
 * avec « Comparer avec » une autre soirée de la portée. Deux soirées se
 * comparent au même nombre de jours avant la soirée, jamais à la même date :
 * c'est la seule façon de répondre à « suis-je en avance sur la dernière
 * fois ? ». Une seule échelle (jamais deux axes), la soirée en rouge, la
 * comparaison en encre pointillée, légende + réticule au survol.
 */
import { useMemo, useState } from 'react';
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { useLanguage } from '@/contexts/LanguageContext';
import { KIT, useNumberFormat } from '@/components/analytics/kitFormat';
import {
  availableMetrics, buildCurve, compareAtSameD, todayD,
  type EventReport, type SeriesMetric,
} from '@/lib/eventReport';
import { CardTitle, EmptyNote, ReportCard, Segmented } from './ui';

const MAIN = '#E8192C';
const COMPARE = 'rgb(var(--ink)/0.5)';

export interface ScopeEventOption { id: string; title: string; startAt: string }

function dayLabel(d: number, t: (k: string) => string): string {
  if (d > 0) return t('er.day.before').replace('{n}', String(d));
  if (d === 0) return t('er.day.j');
  return t('er.day.after').replace('{n}', String(-d));
}

export function ReportTrend({ report, compare, compareId, onCompare, options, compareLoading }: {
  report: EventReport;
  compare: EventReport | null;
  compareId: string | null;
  onCompare: (id: string | null) => void;
  options: ScopeEventOption[];
  compareLoading: boolean;
}) {
  const { t, language } = useLanguage();
  const { n, eur, locale } = useNumberFormat();
  const metrics = availableMetrics(report);
  const [metric, setMetric] = useState<SeriesMetric>(metrics[0]);
  const [mode, setMode] = useState<'cum' | 'day'>('cum');
  const active = metrics.includes(metric) ? metric : metrics[0];
  const fmt = (v: number) => (active === 'amount' ? eur(v) : n(v));

  const points = useMemo(
    () => buildCurve(report, compare, active, mode === 'cum'),
    [report, compare, active, mode],
  );
  const today = todayD(report);
  const headline = compare && mode === 'cum' ? compareAtSameD(report, compare, active) : null;

  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Europe/Paris' });
  const others = options.filter((o) => o.id !== report.event.id);

  const metricOptions = metrics.map((m) => ({ value: m, label: t(`er.metric.${m}`) }));

  return (
    <ReportCard>
      <CardTitle
        title={t(`er.metric.${active}`) + (mode === 'cum' ? ` · ${t('er.cumulative').toLowerCase()}` : ` · ${t('er.daily').toLowerCase()}`)}
        right={
          <label className="inline-flex items-center gap-2 text-[12px]" style={{ color: KIT.T3 }}>
            {t('er.compare')}
            <select
              id="er-compare"
              value={compareId ?? ''}
              onChange={(e) => onCompare(e.target.value || null)}
              className="max-w-[220px] cursor-pointer truncate rounded-lg px-2.5 py-1.5 text-[12px]"
              style={{ background: 'var(--sf-0a0a0c)', border: `1px solid ${KIT.BORDER}`, color: KIT.T1, outline: 'none' }}
            >
              <option value="">{t('er.compareNone')}</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>{o.title} · {dateFmt.format(new Date(o.startAt))}</option>
              ))}
            </select>
          </label>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented<SeriesMetric> label={t('er.metricLabel')} value={active} options={metricOptions} onChange={setMetric} />
        <Segmented<'cum' | 'day'> label={t('er.modeLabel')} value={mode} onChange={setMode}
          options={[{ value: 'cum', label: t('er.cumulative') }, { value: 'day', label: t('er.daily') }]} />
      </div>

      {headline && compare && (
        <p className="mb-3 text-[13px]" style={{ color: KIT.T2 }}>
          {t('er.compareSentence')
            .replace('{when}', dayLabel(today, t))
            .replace('{main}', fmt(headline.main))
            .replace('{cmp}', fmt(headline.compare))
            .replace('{title}', compare.event.title)}
          {headline.compare > 0 && (
            <strong className="ml-1 tabular-nums" style={{ color: headline.main >= headline.compare ? 'var(--acc-34d399)' : 'var(--acc-ff5c63)' }}>
              {headline.main >= headline.compare ? '+' : ''}{Math.round(((headline.main - headline.compare) / headline.compare) * 100)} %
            </strong>
          )}
        </p>
      )}

      {/* Légende : toujours présente dès qu'il y a deux séries. */}
      <div className="mb-2 flex flex-wrap items-center gap-4 text-[12px]" style={{ color: KIT.T2 }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-4 rounded" style={{ background: MAIN }} aria-hidden />
          {t('er.thisEvent')}
        </span>
        {compare && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: COMPARE }} aria-hidden />
            <span className="truncate">{compare.event.title}</span>
          </span>
        )}
        {compareLoading && <span style={{ color: KIT.T3 }}>…</span>}
      </div>

      {points.length === 0 ? (
        <EmptyNote text={t('er.trend.empty')} />
      ) : (
        <div className="h-[260px] w-full" lang={language}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="erMain" x1="0" y1="0" x2="0" y2="1">
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
                allowDecimals={false}
                tickFormatter={(v: number) => (active === 'amount' ? eur(v) : n(v))}
              />
              <ReferenceLine x={0} stroke="rgb(var(--ink)/0.25)" strokeDasharray="2 3"
                label={{ value: t('er.day.j'), position: 'insideTopLeft', fill: 'rgb(var(--ink)/0.45)', fontSize: 10.5 }} />
              {today > 0 && (
                <ReferenceLine x={today} stroke="rgb(var(--ink)/0.18)"
                  label={{ value: t('er.day.today'), position: 'insideTopRight', fill: 'rgb(var(--ink)/0.45)', fontSize: 10.5 }} />
              )}
              <Tooltip
                cursor={{ stroke: 'rgb(var(--ink)/0.25)', strokeWidth: 1 }}
                content={({ active: on, payload, label }) => {
                  if (!on || !payload?.length) return null;
                  const p = payload[0].payload as { main: number | null; compare: number | null };
                  return (
                    <div className="rounded-xl px-3 py-2 text-[12px]" style={{ background: 'var(--sf-111113)', border: `1px solid ${KIT.BORDER}`, color: KIT.T1, boxShadow: '0 10px 30px -12px rgb(0 0 0/.6)' }}>
                      <div style={{ color: KIT.T3, marginBottom: 4 }}>{dayLabel(Number(label), t)}</div>
                      {p.main !== null && (
                        <div className="flex items-center justify-between gap-4">
                          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: MAIN }} />{t('er.thisEvent')}</span>
                          <span className="tabular-nums font-semibold">{fmt(p.main)}</span>
                        </div>
                      )}
                      {compare && p.compare !== null && (
                        <div className="flex items-center justify-between gap-4">
                          <span className="inline-flex max-w-[180px] items-center gap-1.5 truncate"><span className="h-2 w-2 flex-none rounded-full" style={{ background: COMPARE }} />{compare.event.title}</span>
                          <span className="tabular-nums font-semibold">{fmt(p.compare)}</span>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              {compare && (
                <Line type="monotone" dataKey="compare" stroke={COMPARE} strokeWidth={2} strokeDasharray="5 4"
                  dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--sf-0a0a0c)' }} connectNulls={false} isAnimationActive={false} />
              )}
              <Area type="monotone" dataKey="main" stroke={MAIN} strokeWidth={2} fill="url(#erMain)"
                dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--sf-0a0a0c)' }} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ReportCard>
  );
}
