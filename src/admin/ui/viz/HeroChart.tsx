/**
 * Le graphique du héros : la série en rouge, la période précédente en pointillé
 * gris, une courbe adoucie qui passe par chaque point (monotone, aucun pic
 * inventé), un réticule qui suit le pointeur, le pic annoté, une plage qu'on
 * glisse pour lire un morceau de la période. Une seule échelle. La légende vit
 * au-dessus du tracé, jamais sur la courbe.
 *
 * `bucket="week"` : un petit comptage quotidien (des 0 et des 1) ne se trace pas
 * en dents de scie ; il se lit en barres par semaine.
 */
import { useMemo, useRef, useState } from 'react';
import { HoverTip } from './Tip';
import { allIntegers, linear, monotonePath, nearestIndex, niceTicks, shouldWeekly, toWeeks, useWidth } from './core';
import { useHoverIndex } from './Sync';

export interface HeroPoint { x: string; v: number | null; prev?: number | null }

export function HeroChart({
  data: daily, formatX, formatV, formatTick, height = 220, selection, onSelect, labels, annotate = true, bucket = 'auto', weekOf,
}: {
  data: HeroPoint[];
  /** Étiquette d'axe et d'info-bulle d'un point. */
  formatX: (x: string) => string;
  /** Valeur complète (info-bulle, annotation). */
  formatV: (v: number) => string;
  /** Valeur courte de l'axe vertical. */
  formatTick?: (v: number) => string;
  height?: number;
  selection?: [number, number] | null;
  /** Plage glissée (indices inclus) ; `null` = retirée. Pas en barres par semaine. */
  onSelect?: (r: [number, number] | null) => void;
  labels: { cur: string; prev?: string; peak: string };
  annotate?: boolean;
  /** `auto` (défaut) : par semaine quand la série jour par jour ne dirait rien (`shouldWeekly`). */
  bucket?: 'day' | 'week' | 'auto';
  /** Titre de l'info-bulle d'une semaine (« semaine du 3 nov. »). */
  weekOf?: (x: string) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { index, setIndex } = useHoverIndex();
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const dragging = useRef(false);

  const weekly = bucket === 'week' || (bucket === 'auto' && shouldWeekly(daily.map((d) => d.v)));
  const data = useMemo<HeroPoint[]>(() => (weekly ? toWeeks(daily) : daily), [daily, weekly]);
  const select = weekly ? undefined : onSelect;
  const n = data.length;
  const hasPrev = data.some((d) => d.prev != null);
  const showPrevLegend = hasPrev && !!labels.prev && data.some((d) => (d.prev ?? 0) > 0);
  const max = useMemo(() => Math.max(0, ...data.map((d) => Math.max(d.v ?? 0, d.prev ?? 0))), [data]);
  const integer = useMemo(() => allIntegers(data.flatMap((d) => [d.v, d.prev])), [data]);
  const ticks = niceTicks(max, 4, integer);
  const top = ticks[ticks.length - 1] || 1;
  const tick = formatTick ?? formatV;
  const left = Math.min(72, Math.max(36, ...ticks.map((t) => tick(t).length * 7 + 10)));
  const pad = { l: left, r: 12, t: 26, b: 26 };
  const W = Math.max(0, width);
  const x0 = pad.l, x1 = W - pad.r;
  const slot = n > 0 ? (x1 - x0) / n : 0;
  const sx = (i: number) => (weekly ? x0 + slot * (i + 0.5) : n <= 1 ? (x0 + x1) / 2 : linear(0, n - 1, x0, x1)(i));
  const sy = linear(0, top, height - pad.b, pad.t);

  const cur = weekly ? '' : monotonePath(data.map((d, i) => (d.v == null ? null : [sx(i), sy(d.v)])));
  const prev = weekly || !hasPrev ? '' : monotonePath(data.map((d, i) => (d.prev == null ? null : [sx(i), sy(d.prev)])));
  const peak = useMemo(() => {
    let best = -1;
    data.forEach((d, i) => { if (d.v != null && d.v > 0 && (best < 0 || d.v > (data[best].v ?? 0))) best = i; });
    return best;
  }, [data]);
  const xTicks = useMemo(() => {
    if (n === 0) return [] as number[];
    const want = Math.max(2, Math.min(n, Math.floor(W / 110)));
    const step = Math.max(1, Math.round((n - 1) / (want - 1)));
    const out: number[] = [];
    for (let i = 0; i < n; i += step) out.push(i);
    if (out[out.length - 1] !== n - 1 && n - 1 - out[out.length - 1] > step / 2) out.push(n - 1);
    return out;
  }, [n, W]);

  const idxAt = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    const x = clientX - (r?.left ?? 0);
    if (weekly) return Math.max(0, Math.min(n - 1, Math.floor((x - x0) / Math.max(1, slot))));
    return nearestIndex(x, n, x0, x1);
  };
  const sel = drag ?? selection ?? null;
  const hi = index != null && index < n ? index : null;
  const titleOf = (x: string) => (weekly && weekOf ? weekOf(x) : formatX(x));
  const summary = n === 0 ? labels.cur : `${labels.cur} : ${formatX(data[0].x)} → ${formatX(data[n - 1].x)}${peak >= 0 ? `, ${labels.peak} ${formatV(data[peak].v ?? 0)} (${titleOf(data[peak].x)})` : ''}`;

  return (
    <div ref={ref} className="relative select-none" style={{ height }}
      onPointerLeave={() => { setIndex(null); }}
      onPointerMove={(e) => {
        const i = idxAt(e.clientX);
        setIndex(i);
        if (dragging.current && drag) setDrag([drag[0], i]);
      }}
      onPointerDown={(e) => {
        if (!select || n < 3) return;
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        const i = idxAt(e.clientX);
        setDrag([i, i]);
      }}
      onPointerUp={() => {
        if (!dragging.current) return;
        dragging.current = false;
        if (drag && select) {
          const a = Math.min(drag[0], drag[1]), b = Math.max(drag[0], drag[1]);
          select(b - a >= 1 ? [a, b] : null);
        }
        setDrag(null);
      }}>
      {/* Légende au-dessus du tracé (étiquetage direct, jamais sur la courbe). */}
      <div aria-hidden className="a-viz-tick absolute right-3 top-0 flex items-center gap-4" style={{ fill: 'none' }}>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-[2px] w-3.5 rounded" style={{ background: 'var(--a-chart-1)' }} />{labels.cur}</span>
        {showPrevLegend && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3.5 border-t-[1.5px] border-dashed" style={{ borderColor: 'var(--a-prev)' }} />{labels.prev}</span>}
      </div>
      {W > 0 && (
        <svg width={W} height={height} role="img" aria-label={summary} style={{ cursor: select && n >= 3 ? 'crosshair' : 'default', display: 'block' }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x0} x2={x1} y1={sy(t)} y2={sy(t)} stroke="var(--a-grid)" strokeWidth={1} />
              <text x={x0 - 8} y={sy(t)} dy="0.32em" textAnchor="end" className="a-viz-tick">{tick(t)}</text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} x={sx(i)} y={height - 6} textAnchor={!weekly && i === 0 && n > 1 ? 'start' : !weekly && i === n - 1 && n > 1 ? 'end' : 'middle'} className="a-viz-tick">{formatX(data[i].x)}</text>
          ))}
          {sel && !weekly && (
            <rect x={Math.min(sx(sel[0]), sx(sel[1]))} width={Math.max(2, Math.abs(sx(sel[1]) - sx(sel[0])))} y={pad.t - 6} height={height - pad.b - pad.t + 6}
              fill="var(--a-accent-soft)" opacity={0.7} />
          )}
          {weekly ? data.map((d, i) => {
            const bw = Math.max(3, Math.min(36, slot * 0.56));
            const base = sy(0);
            return (
              <g key={d.x}>
                {d.prev != null && d.prev > 0 && <rect x={sx(i) - bw / 2 - 3} y={sy(d.prev)} width={bw + 6} height={base - sy(d.prev)} rx={2} fill="none" stroke="var(--a-prev)" strokeDasharray="3 3" />}
                {d.v != null && <rect x={sx(i) - bw / 2} y={d.v > 0 ? sy(d.v) : base - 1} width={bw} height={d.v > 0 ? base - sy(d.v) : 1} rx={2}
                  fill={hi === i || (hi == null && i === n - 1) ? 'var(--a-chart-1)' : 'color-mix(in srgb, var(--a-chart-1) 55%, transparent)'} />}
              </g>
            );
          }) : (
            <>
              {prev && <path d={prev} fill="none" stroke="var(--a-prev)" strokeWidth={1.5} strokeDasharray="4 4" />}
              {cur && <path d={cur} fill="none" stroke="var(--a-chart-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
              {n === 1 && data[0].v != null && <circle cx={sx(0)} cy={sy(data[0].v)} r={4} fill="var(--a-chart-1)" />}
            </>
          )}
          {annotate && peak >= 0 && n > 2 && hi == null && (
            <g>
              {!weekly && <circle cx={sx(peak)} cy={sy(data[peak].v ?? 0)} r={3.5} fill="var(--a-panel)" stroke="var(--a-chart-1)" strokeWidth={2} />}
              <text x={Math.min(x1 - 4, Math.max(x0 + 4, sx(peak)))} y={sy(data[peak].v ?? 0) - 8}
                textAnchor={sx(peak) > x1 - 80 ? 'end' : sx(peak) < x0 + 80 ? 'start' : 'middle'} className="a-viz-note">
                {labels.peak} · {formatV(data[peak].v ?? 0)}
              </text>
            </g>
          )}
          {hi != null && !weekly && (
            <g pointerEvents="none">
              <line x1={sx(hi)} x2={sx(hi)} y1={pad.t - 6} y2={height - pad.b} stroke="var(--a-text-3)" strokeWidth={1} />
              {data[hi].prev != null && <circle cx={sx(hi)} cy={sy(data[hi].prev ?? 0)} r={3} fill="var(--a-prev)" />}
              {data[hi].v != null && <circle cx={sx(hi)} cy={sy(data[hi].v ?? 0)} r={4} fill="var(--a-chart-1)" stroke="var(--a-panel)" strokeWidth={2} />}
            </g>
          )}
        </svg>
      )}
      {hi != null && W > 0 && (
        <HoverTip x={sx(hi)} width={W} title={titleOf(data[hi].x)}
          rows={[
            { label: labels.cur, value: data[hi].v == null ? '—' : formatV(data[hi].v ?? 0), color: 'var(--a-chart-1)', strong: true },
            ...(hasPrev && labels.prev ? [{ label: labels.prev, value: data[hi].prev == null ? '—' : formatV(data[hi].prev ?? 0), color: 'var(--a-prev)' }] : []),
          ]} />
      )}
    </div>
  );
}
