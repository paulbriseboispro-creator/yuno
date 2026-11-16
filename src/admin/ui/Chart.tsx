/**
 * Le graphique de l'admin (Recharts), trois formes seulement : courbe,
 * barres, barres empilées. Règles posées ici pour toutes les pages :
 *   - axes TOUJOURS visibles, l'unité écrite sur l'axe vertical ;
 *   - UNE seule échelle par graphique (jamais de second axe caché : deux
 *     ordres de grandeur = deux graphiques) ;
 *   - la période précédente, quand elle est donnée, en gris pointillé ;
 *   - aucune animation (lecture immédiate, captures fiables) ;
 *   - série principale en rouge (`--a-chart-1`), puis bleu, sarcelle, violet ;
 *     légende seulement à partir de deux séries, texte en encre neutre ;
 *     barres empilées : la série principale en bas (la première de `series`).
 *
 *   <Chart kind="line" data={rows} x="day" unit="eur"
 *     series={[{ key: 'revenue', label: t('…') }]} previous={{ key: 'prevRevenue', label: t('…') }} />
 */
import type { ReactNode } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fmtCompact, fmtEur, fmtNum, fmtPct } from '@/lib/adminFormat';
import { useAdminT } from './i18n';
import { EmptyState, ErrorState } from './EmptyState';

export type ChartUnit = 'count' | 'eur' | 'pct' | { label: string; format: (v: number) => string };

export interface ChartSeries {
  key: string;
  label: string;
  /** Une variable du kit (`var(--a-chart-2)`) ; par défaut la palette dans l'ordre. */
  color?: string;
}

const PALETTE = ['var(--a-chart-1)', 'var(--a-chart-2)', 'var(--a-chart-3)', 'var(--a-chart-4)', 'var(--a-chart-5)'];

export interface ChartProps {
  kind: 'line' | 'bar' | 'stacked';
  data: Array<Record<string, string | number | null>> | null | undefined;
  /** Clé de l'axe horizontal (déjà mise en forme, ou passée à `formatX`). */
  x: string;
  formatX?: (v: string) => string;
  series: ChartSeries[];
  /** La même mesure sur la période précédente (gris, pointillé). Courbe seulement. */
  previous?: { key: string; label: string };
  unit: ChartUnit;
  /** Hauteur : 280 (grand, défaut), 200 (moyen) ; une mini-courbe passe par Sparkline. */
  height?: number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: ReactNode;
}

export function Chart({ kind, data, x, formatX, series, previous, unit, height = 280, loading, error, onRetry, empty }: ChartProps) {
  const { t, lang } = useAdminT();
  const fmt = (v: number): string => {
    if (typeof unit === 'object') return unit.format(v);
    if (unit === 'eur') return fmtEur(v, lang, { compact: true, cents: false });
    if (unit === 'pct') return fmtPct(v);
    return fmtCompact(v, lang);
  };
  const fmtFull = (v: number): string => {
    if (typeof unit === 'object') return unit.format(v);
    if (unit === 'eur') return fmtEur(v, lang);
    if (unit === 'pct') return fmtPct(v, 1);
    return fmtNum(v, lang);
  };
  const unitLabel = typeof unit === 'object' ? unit.label : t(`adm.ui.unit.${unit}`);

  if (error && !loading) return <div style={{ minHeight: height }} className="grid place-items-center"><ErrorState onRetry={onRetry} /></div>;
  if (loading) return <div className="a-skel w-full" style={{ height }} aria-busy />;
  if (!data || data.length === 0) return <div style={{ minHeight: height }} className="grid place-items-center"><EmptyState title={empty ?? t('adm.ui.chart.empty')} /></div>;

  // Largeur de l'axe vertical calée sur l'étiquette la plus longue (« 0,750 $US » ne chevauche plus l'unité).
  const maxVal = data.reduce((m, row) => Math.max(m, ...series.map((sr) => Math.abs(Number(row[sr.key]) || 0))), 0);
  const yWidth = Math.min(96, Math.max(44, Math.max(fmt(maxVal).length, fmt(maxVal / 4).length) * 7 + 22));
  const axisTick = { fill: 'var(--a-axis)', fontSize: 12, fontFamily: 'var(--a-font-sans)', fontVariantNumeric: 'tabular-nums' };
  const common = {
    data,
    margin: { top: 8, right: 4, bottom: 0, left: 4 },
  };
  const xAxis = (
    <XAxis dataKey={x} tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--a-border)' }} tickMargin={8}
      tickFormatter={formatX} minTickGap={24} />
  );
  const yAxis = (
    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={yWidth} tickMargin={6}
      tickFormatter={(v: number) => fmt(v)} allowDecimals={unit !== 'count'}
      label={{ value: unitLabel, angle: -90, position: 'insideLeft', offset: 0, style: { ...axisTick, textAnchor: 'middle' } }} />
  );
  const grid = <CartesianGrid stroke="var(--a-grid)" vertical={false} />;
  const tooltip = (
    <Tooltip
      cursor={kind === 'line' ? { stroke: 'var(--a-border-strong)' } : { fill: 'var(--a-hover)' }}
      contentStyle={{ background: 'var(--a-panel)', border: '1px solid var(--a-border)', borderRadius: 8, boxShadow: 'var(--a-shadow-pop)', fontSize: 12.5, color: 'var(--a-text)', fontVariantNumeric: 'tabular-nums', padding: '8px 10px' }}
      itemStyle={{ color: 'var(--a-text)', padding: '1px 0' }}
      labelStyle={{ color: 'var(--a-text-2)', marginBottom: 4 }}
      labelFormatter={(v) => (formatX ? formatX(String(v)) : String(v))}
      formatter={(v: number | string, name: string) => [typeof v === 'number' ? fmtFull(v) : v, name]}
    />
  );
  const legend = (series.length > 1 || previous) ? (
    <Legend verticalAlign="top" align="left" height={30} iconType={kind === 'line' ? 'plainline' : 'square'} iconSize={kind === 'line' ? 14 : 9}
      wrapperStyle={{ fontSize: 12, paddingLeft: yWidth }}
      formatter={(value: string) => <span style={{ color: 'var(--a-text-2)' }}>{value}</span>} />
  ) : null;

  return (
    <div style={{ height }} role="img" aria-label={series.map((s) => s.label).join(', ')}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'line' ? (
          <LineChart {...common}>
            {grid}{xAxis}{yAxis}{tooltip}{legend}
            {previous && (
              <Line type="monotone" dataKey={previous.key} name={previous.label} stroke="var(--a-prev)" strokeWidth={1.5}
                strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            )}
            {series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? PALETTE[i % PALETTE.length]}
                strokeWidth={2} dot={false} activeDot={{ r: 3.5 }} isAnimationActive={false} />
            ))}
          </LineChart>
        ) : (
          <BarChart {...common} barCategoryGap="22%">
            {grid}{xAxis}{yAxis}{tooltip}{legend}
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? PALETTE[i % PALETTE.length]}
                stackId={kind === 'stacked' ? 'a' : undefined}
                stroke={kind === 'stacked' ? 'var(--a-panel)' : undefined} strokeWidth={kind === 'stacked' ? 1 : 0}
                maxBarSize={kind === 'stacked' ? 28 : 32}
                radius={kind === 'stacked' ? (i === series.length - 1 ? [3, 3, 0, 0] : 0) : [3, 3, 0, 0]}
                isAnimationActive={false} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
