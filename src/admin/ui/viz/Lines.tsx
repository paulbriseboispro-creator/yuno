/**
 * Plusieurs séries sur la même échelle, étiquetées au bout de leur ligne (pas
 * de légende), réticule et info-bulle dessinée. Le héros n'a qu'une série et
 * sa période d'avant : `HeroChart` ; ici, deux à cinq séries comparées.
 */
import { useMemo } from 'react';
import { HoverTip } from './Tip';
import { allIntegers, linear, monotonePath, nearestIndex, niceTicks, shouldWeekly, useWidth } from './core';
import { useHoverIndex } from './Sync';

// ── Plusieurs lignes étiquetées ──────────────────────────────────────────────
export interface LineSeries {
  key: string;
  label: string;
  values: Array<number | null>;
  /** `main` = rouge, épais ; `ref` = repère pointillé gris ; défaut = encre. */
  role?: 'main' | 'ref' | 'ink';
}

const STROKE: Record<NonNullable<LineSeries['role']>, { c: string; w: number; dash?: string }> = {
  main: { c: 'var(--a-chart-1)', w: 2 },
  ink: { c: 'var(--a-text-2)', w: 1.5 },
  ref: { c: 'var(--a-prev)', w: 1.5, dash: '4 4' },
};

export function LinesChart({ xs: xsDaily, series: seriesDaily, formatX, formatV, formatTick, height = 220, weekOf, bucket = 'auto' }: {
  xs: string[];
  series: LineSeries[];
  formatX: (x: string) => string;
  formatV: (v: number) => string;
  formatTick?: (v: number) => string;
  height?: number;
  /** Titre de l'info-bulle quand la série passe par semaine. */
  weekOf?: (x: string) => string;
  /** `auto` : par semaine quand la série jour par jour ne dirait rien ; `week` : toujours. */
  bucket?: 'auto' | 'day' | 'week';
}) {
  // Une série quotidienne à jours vides ou à petit comptage se lit par semaine (même règle que le héros).
  const main = seriesDaily.find((s) => s.role === 'main') ?? seriesDaily[0];
  const weekly = bucket === 'week' ? xsDaily.length >= 14 : bucket === 'auto' && !!main && shouldWeekly(main.values);
  const { xs, series } = useMemo(() => {
    if (!weekly) return { xs: xsDaily, series: seriesDaily };
    const starts: number[] = [];
    for (let end = xsDaily.length; end > 0; end -= 7) starts.unshift(Math.max(0, end - 7));
    const bounds = starts.map((a, i) => [a, starts[i + 1] ?? xsDaily.length] as const);
    return {
      xs: bounds.map(([a]) => xsDaily[a]),
      series: seriesDaily.map((s) => ({ ...s, values: bounds.map(([a, b]) => { const c = s.values.slice(a, b); return c.every((v) => v == null) ? null : c.reduce((t: number, v) => t + (v ?? 0), 0); }) })),
    };
  }, [weekly, xsDaily, seriesDaily]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const { index, setIndex } = useHoverIndex();
  const n = xs.length;
  const max = useMemo(() => Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0))), [series]);
  const ticks = niceTicks(max, 4, allIntegers(series.flatMap((s) => s.values)));
  const top = ticks[ticks.length - 1] || 1;
  const tick = formatTick ?? formatV;
  const labelW = Math.min(110, Math.max(...series.map((s) => s.label.length * 6.4 + 10), 40));
  const left = Math.min(72, Math.max(36, ...ticks.map((t) => tick(t).length * 7 + 10)));
  const pad = { l: left, r: labelW, t: 14, b: 26 };
  const W = Math.max(0, width);
  const x0 = pad.l, x1 = W - pad.r;
  const sx = (i: number) => (n <= 1 ? (x0 + x1) / 2 : linear(0, n - 1, x0, x1)(i));
  const sy = linear(0, top, height - pad.b, pad.t);
  const hi = index != null && index < n ? index : null;
  const step = Math.max(1, Math.round((n - 1) / Math.max(1, Math.min(n - 1, Math.floor(W / 110)))));

  // Étiquettes au bout des lignes, écartées pour ne pas se chevaucher.
  const ends = (() => {
    const raw = series.map((s) => {
      let i = s.values.length - 1;
      while (i >= 0 && s.values[i] == null) i -= 1;
      return { s, y: sy(i >= 0 ? s.values[i] ?? 0 : 0) };
    }).sort((a, b) => a.y - b.y);
    for (let i = 1; i < raw.length; i += 1) if (raw[i].y - raw[i - 1].y < 13) raw[i].y = raw[i - 1].y + 13;
    return raw;
  })();

  return (
    <div ref={ref} className="relative select-none" style={{ height }}
      onPointerMove={(e) => { const r = ref.current?.getBoundingClientRect(); setIndex(nearestIndex(e.clientX - (r?.left ?? 0), n, x0, x1)); }}
      onPointerLeave={() => setIndex(null)}>
      {W > 0 && (
        <svg width={W} height={height} role="img" aria-label={series.map((s) => `${s.label} ${(() => { let i = s.values.length - 1; while (i >= 0 && s.values[i] == null) i -= 1; return i >= 0 ? formatV(s.values[i] ?? 0) : '—'; })()}`).join(', ')} style={{ display: 'block' }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x0} x2={x1} y1={sy(t)} y2={sy(t)} stroke="var(--a-grid)" strokeWidth={1} />
              <text x={x0 - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="a-viz-tick">{tick(t)}</text>
            </g>
          ))}
          {xs.map((x, i) => (i % step === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < step / 2) ? (
            <text key={x} x={sx(i)} y={height - 6} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'} className="a-viz-tick">{formatX(x)}</text>
          ) : null)}
          {series.map((s) => {
            const st = STROKE[s.role ?? 'ink'];
            const d = monotonePath(s.values.map((v, i) => (v == null ? null : [sx(i), sy(v)])));
            return (
              <g key={s.key}>
                <path d={d} fill="none" stroke={st.c} strokeWidth={st.w} strokeDasharray={st.dash} strokeLinejoin="round" strokeLinecap="round" />
                {n === 1 && s.values[0] != null && <circle cx={sx(0)} cy={sy(s.values[0] ?? 0)} r={3.5} fill={st.c} />}
              </g>
            );
          })}
          {ends.map(({ s, y }) => (
            <text key={s.key} x={x1 + 8} y={y} dy="0.32em" className="a-viz-tick" style={{ fill: s.role === 'main' ? 'var(--a-text)' : undefined, fontWeight: s.role === 'main' ? 600 : undefined }}>{s.label}</text>
          ))}
          {hi != null && <line x1={sx(hi)} x2={sx(hi)} y1={pad.t - 4} y2={height - pad.b} stroke="var(--a-text-3)" strokeWidth={1} pointerEvents="none" />}
        </svg>
      )}
      {hi != null && W > 0 && (
        <HoverTip x={sx(hi)} width={W} title={weekly && weekOf ? weekOf(xs[hi]) : formatX(xs[hi])}
          rows={series.map((s) => ({ label: s.label, value: s.values[hi] == null ? '—' : formatV(s.values[hi] ?? 0), color: STROKE[s.role ?? 'ink'].c, strong: s.role === 'main' }))} />
      )}
    </div>
  );
}

