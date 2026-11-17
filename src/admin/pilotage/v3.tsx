/**
 * Formes v3 composées localement pour Pilotage et Argent, en attendant leur
 * remontée au kit (src/admin/ui) :
 *   FlowFunnel   entonnoir horizontal : la perte ÉCRITE entre deux étapes, la
 *                plus grosse marquée, la provenance de chaque étape dite ;
 *   LinesChart   plusieurs séries sur la même échelle, étiquetées au bout de
 *                leur ligne (pas de légende), réticule et info-bulle ;
 *   ColumnBars   barres verticales datées, valeur écrite au-dessus ;
 *   Chips        filtres en puces (un choix), avec leur nombre ;
 *   Folded       un repli sans boîte (filet + chevron) ;
 *   Pill         un statut en pastille (point + mot).
 * Variables --a-* seulement, aucune couleur écrite à la main.
 */
import { useMemo, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { HoverTip, useHoverIndex, useWidth, niceTicks } from '@/admin/ui';
import { linear, linePath, nearestIndex } from '@/admin/ui/viz/core';
import { TONE, type Tone } from '@/admin/ui/tone';
import { biggestDrop } from './rules';

// ── Entonnoir ────────────────────────────────────────────────────────────────
export interface FlowStep {
  key: string;
  label: string;
  value: number;
  display: string;
  /** D'où vient ce chiffre, en une ligne (source de la mesure). */
  source?: string;
}

export function FlowFunnel({ steps, lostText, worstLabel, offScaleLabel }: {
  steps: FlowStep[];
  /** La perte avant l'étape `i`, en phrase (« 12 n'ont pas créé de compte »). */
  lostText: (i: number, lost: number) => string;
  worstLabel: string;
  /** Mot sous la première barre quand elle écrase les autres (« hors échelle »). */
  offScaleLabel?: string;
}) {
  // Une première étape plus de 5 fois plus grande que la suivante écraserait
  // les autres barres : elle sort de l'échelle (barre pleine, coupée), les
  // nombres restent exacts.
  const offScale = steps.length > 2 && (steps[1]?.value ?? 0) > 0 && steps[0].value > steps[1].value * 5;
  const top = Math.max(1, ...steps.slice(offScale ? 1 : 0).map((s) => s.value));
  const worst = biggestDrop(steps.map((s) => s.value));
  return (
    <ol className="grid grid-cols-2 gap-y-6 sm:grid-cols-3 xl:[grid-template-columns:repeat(var(--n),minmax(0,1fr))]" style={{ ['--n' as string]: Math.max(1, steps.length) }}>
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const lost = prev != null ? Math.max(0, prev - s.value) : 0;
        const isWorst = worst === i;
        const cut = offScale && i === 0;
        return (
          <li key={s.key} className="flex min-w-0 flex-col gap-2 border-l px-4 first:border-l-0 first:pl-0">
            <span className="a-kicker truncate" title={s.label}>{s.label}</span>
            <span className="a-stat-value">{s.display}</span>
            <div className="relative flex h-16 items-end border-b" aria-hidden>
              <div className="w-full rounded-t-[2px]" style={{
                height: s.value > 0 ? `${cut ? 100 : Math.max(3, (s.value / top) * 100)}%` : 0,
                background: i === steps.length - 1 ? 'var(--a-chart-1)' : 'color-mix(in srgb, var(--a-text) 26%, transparent)',
              }} />
              {cut && <div className="absolute inset-x-0 top-[38%] h-[5px]" style={{ background: 'var(--a-bg)', transform: 'skewY(-6deg)' }} />}
            </div>
            {cut && offScaleLabel && <span className="a-mono a-t3 -mt-1 text-[10.5px]">{offScaleLabel}</span>}
            <span className="min-h-[2.4em] text-[12px] leading-snug" style={{ color: isWorst ? 'var(--a-accent-text)' : 'var(--a-text-2)' }}>
              {prev != null && lost > 0 ? (
                <>{isWorst && <span className="a-mono mr-1 block text-[10.5px] font-semibold uppercase tracking-[0.04em]">{worstLabel}</span>}{lostText(i, lost)}</>
              ) : prev != null ? '—' : ''}
            </span>
            {s.source && <span className="a-t3 text-[11.5px] leading-snug">{s.source}</span>}
          </li>
        );
      })}
    </ol>
  );
}

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

export function LinesChart({ xs, series, formatX, formatV, formatTick, height = 220 }: {
  xs: string[];
  series: LineSeries[];
  formatX: (x: string) => string;
  formatV: (v: number) => string;
  formatTick?: (v: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { index, setIndex } = useHoverIndex();
  const n = xs.length;
  const max = useMemo(() => Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0))), [series]);
  const ticks = niceTicks(max, 4);
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
        <svg width={W} height={height} role="img" aria-label={series.map((s) => s.label).join(', ')} style={{ display: 'block' }}>
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
            const d = linePath(s.values.map((v, i) => (v == null ? null : [sx(i), sy(v)])));
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
        <HoverTip x={sx(hi)} width={W} title={formatX(xs[hi])}
          rows={series.map((s) => ({ label: s.label, value: s.values[hi] == null ? '—' : formatV(s.values[hi] ?? 0), color: STROKE[s.role ?? 'ink'].c, strong: s.role === 'main' }))} />
      )}
    </div>
  );
}

// ── Barres datées ────────────────────────────────────────────────────────────
export function ColumnBars({ items, height = 120, emptyText }: {
  items: Array<{ key: string; x: string; value: number; display: string }>;
  height?: number;
  emptyText: string;
}) {
  const max = Math.max(0, ...items.map((i) => i.value));
  if (items.length === 0 || max <= 0) return <p className="a-t2 text-[13px]">{emptyText}</p>;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {items.map((it, i) => (
          <div key={it.key} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${it.x} · ${it.display}`}>
            {it.value > 0 && <span className="a-mono a-t2 mb-0.5 truncate text-center text-[10px]">{it.display}</span>}
            <div className="rounded-[2px]" style={{
              height: it.value > 0 ? `${Math.max(3, (it.value / max) * 78)}%` : 1,
              background: it.value <= 0 ? 'var(--a-grid)' : i === items.length - 1 ? 'var(--a-chart-1)' : 'color-mix(in srgb, var(--a-text) 30%, transparent)',
            }} />
          </div>
        ))}
      </div>
      <div className="a-mono a-t3 flex justify-between text-[11px]"><span>{items[0]?.x}</span><span>{items[items.length - 1]?.x}</span></div>
    </div>
  );
}

// ── Puces de filtre ──────────────────────────────────────────────────────────
export function Chips<V extends string>({ value, options, onChange, label }: {
  value: V;
  options: Array<{ value: V; label: ReactNode; count?: number | null }>;
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
            className="a-focus inline-flex h-7 items-center gap-1.5 rounded-full border px-3 font-[inherit] text-[12.5px]"
            style={{ cursor: 'pointer', background: on ? 'var(--a-text)' : 'transparent', color: on ? 'var(--a-bg)' : 'var(--a-text-2)', borderColor: on ? 'var(--a-text)' : 'var(--a-border)' }}>
            {o.label}
            {o.count != null && <span className="a-mono text-[11px]" style={{ opacity: 0.7 }}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Repli sans boîte ─────────────────────────────────────────────────────────
export function Folded({ title, hint, children, defaultOpen = false }: { title: ReactNode; hint?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group flex flex-col" open={defaultOpen}>
      <summary className="a-focus flex cursor-pointer list-none items-baseline gap-2 border-b pb-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="a-t3 h-3.5 w-3.5 flex-none self-center transition-transform group-open:rotate-90" />
        <span className="a-t1 text-[14px] font-semibold">{title}</span>
        {hint && <span className="a-mono a-t3 ml-auto text-[11px]">{hint}</span>}
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}

// ── Pastille de statut ───────────────────────────────────────────────────────
export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]" style={{ color: tone === 'neutral' ? 'var(--a-text-2)' : TONE[tone].dot }}>
      <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full" style={{ background: TONE[tone].dot }} />
      <span style={{ color: 'var(--a-text-2)' }}>{children}</span>
    </span>
  );
}

// ── Lignes denses ───────────────────────────────────────────────────────────
/** Lignes denses à colonnes mono (tableau sans boîte). */
export function DenseRows({ rows, head, empty }: { rows: Array<{ key: string; main: ReactNode; cells: string[]; flag?: ReactNode }>; head: string[]; empty: string }) {
  if (rows.length === 0) return <p className="a-t2 text-[13px]">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead><tr><th />{head.map((h) => <th key={h} className="a-kicker pb-2 text-right font-normal">{h}</th>)}<th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="py-1.5 pr-3">{r.main}</td>
              {r.cells.map((c, i) => <td key={i} className="a-mono a-t1 py-1.5 pl-4 text-right text-[12px]">{c}</td>)}
              <td className="py-1.5 pl-4 text-right">{r.flag}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Cascade signée ──────────────────────────────────────────────────────────
/**
 * Comme la cascade du kit, mais les totaux peuvent passer sous zéro (une marge
 * négative) : un axe zéro, les barres partent de part et d'autre.
 */
export function SignedWaterfall({ steps }: { steps: Array<{ key: string; label: string; value: number; display: string; total?: boolean }> }) {
  let run = 0;
  const bars = steps.map((st) => {
    if (st.total) { run = st.value; return { st, from: 0, to: st.value }; }
    const from = run; run += st.value; return { st, from, to: run };
  });
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)));
  const hi = Math.max(0, ...bars.map((b) => Math.max(b.from, b.to)));
  const span = Math.max(1e-9, hi - lo);
  const pos = (v: number) => ((v - lo) / span) * 100;
  return (
    <ul className="flex flex-col gap-2">
      {bars.map(({ st, from, to }) => (
        <li key={st.key} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
          <span className={`truncate ${st.total ? 'a-t1 font-medium' : 'a-t2'}`}>{st.label}</span>
          <div className="relative h-4">
            {lo < 0 && <div className="absolute inset-y-[-3px] w-px" style={{ left: `${pos(0)}%`, background: 'var(--a-text-3)' }} />}
            <div className="absolute inset-y-0 rounded-[2px]" title={`${st.label} · ${st.display}`}
              style={{ left: `${pos(Math.min(from, to))}%`, width: `max(2px, ${Math.abs(to - from) / span * 100}%)`,
                background: st.total ? (to < 0 ? 'var(--a-neg-soft)' : 'var(--a-chart-1)') : st.value < 0 ? 'var(--a-prev)' : 'color-mix(in srgb, var(--a-chart-1) 45%, transparent)' }} />
          </div>
          <span className={`a-num text-right ${st.total ? 'a-t1 font-semibold' : 'a-t2'}`}>{st.display}</span>
        </li>
      ))}
    </ul>
  );
}
