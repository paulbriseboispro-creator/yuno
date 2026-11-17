/**
 * Les chiffres secondaires (v3), sans boîtes :
 *   - Spark      : une mini-courbe en SVG (la taille d'un mot, Tufte) ;
 *   - StatStrip  : une bande de stats séparées par des filets ;
 *   - SmallMultiples : plusieurs mini-graphiques sur LE MÊME axe du temps,
 *     survol synchronisé (posé dans un HoverSync), la valeur du jour survolé
 *     remplace le total.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DeltaBadge } from '../Kpi';
import { linePath, nearestIndex } from './core';
import { useHoverIndex } from './Sync';

export function Spark({ data, kind = 'line', height = 32, highlight, color = 'var(--a-chart-1)', baseline = true }: {
  data: number[];
  kind?: 'line' | 'bar';
  height?: number;
  highlight?: number | null;
  color?: string;
  baseline?: boolean;
}) {
  const n = data.length;
  const max = Math.max(0, ...data);
  const W = 100;
  if (n === 0) return <div style={{ height }} aria-hidden />;
  const y = (v: number) => (max <= 0 ? height - 1 : height - 2 - (v / max) * (height - 4));
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden style={{ display: 'block', overflow: 'visible' }}>
      {baseline && <line x1={0} x2={W} y1={height - 0.5} y2={height - 0.5} stroke="var(--a-grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      {kind === 'bar' ? data.map((v, i) => {
        const bw = Math.max(0.6, (W / n) * 0.62);
        const cx = n === 1 ? W / 2 : ((i + 0.5) / n) * W;
        const h = max <= 0 ? 0 : Math.max(v > 0 ? 1.5 : 0, (v / max) * (height - 3));
        return <rect key={i} x={cx - bw / 2} y={height - h} width={bw} height={h} rx={0.6}
          fill={highlight === i ? 'var(--a-chart-1)' : `color-mix(in srgb, ${color} ${highlight == null ? 55 : 30}%, transparent)`} />;
      }) : (
        <>
          <path d={linePath(data.map((v, i) => [x(i), y(v)]))} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {n === 1 && <circle cx={x(0)} cy={y(data[0])} r={2} fill={color} />}
          {highlight != null && highlight < n && (
            <line x1={x(highlight)} x2={x(highlight)} y1={0} y2={height} stroke="var(--a-text-3)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          )}
        </>
      )}
    </svg>
  );
}

export interface Stat {
  key: string;
  label: ReactNode;
  value: ReactNode;
  current?: number | null;
  previous?: number | null;
  invert?: boolean;
  spark?: number[];
  sparkKind?: 'line' | 'bar';
  to?: string;
  hint?: string;
  loading?: boolean;
}

/** Une case de bande : libellé mono, valeur 20 px, écart, mini-courbe, lien facultatif. */
export function StatCell({ label, value, hint, to, loading, current, previous, invert, spark, sparkKind }: Omit<Stat, 'key'>) {
  const body = (
    <div className="flex h-full flex-col gap-1.5 px-4 py-3">
      <span className="a-kicker truncate" title={hint}>{label}</span>
      {loading ? <div className="a-skel h-6 w-20" /> : <span className="a-stat-value">{value}</span>}
      {(previous !== undefined || spark) && !loading && (
        <div className="flex items-center gap-3">
          {previous !== undefined && <DeltaBadge current={current} previous={previous} invert={invert} />}
          {spark && <div className="min-w-0 flex-1"><Spark data={spark} kind={sparkKind} height={18} baseline={false} /></div>}
        </div>
      )}
    </div>
  );
  return (
    <div className="a-strip-cell min-w-0">
      {to ? <Link to={to} className="a-focus block h-full no-underline hover:bg-[var(--a-hover)]">{body}</Link> : body}
    </div>
  );
}

/** Une bande de chiffres sans boîtes : filets verticaux entre les cases. */
export function StatStrip({ items }: { items: Stat[] }) {
  return (
    <div className="a-strip grid grid-cols-2 border-y sm:grid-cols-3" data-n={items.length}>
      {items.map(({ key, ...s }) => <StatCell key={key} {...s} />)}
    </div>
  );
}

/** La même bande, écrite en enfants (`<StatRow><StatCell …/></StatRow>`). */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap border-y [&>*]:min-w-[8.5rem] [&>*]:flex-1 [&>*+*]:border-l">{children}</div>;
}

export interface Multiple {
  key: string;
  label: string;
  /** Total ou valeur de la période, déjà mise en forme. */
  total: string;
  series: number[];
  /** Mise en forme d'un point (survol). */
  format: (v: number) => string;
  current?: number | null;
  previous?: number | null;
  invert?: boolean;
  kind?: 'line' | 'bar';
  to?: string;
  /** Une phrase quand la série est entièrement nulle. */
  emptyText?: string;
}

/**
 * Plusieurs mini-graphiques alignés sur le même axe (`xLabels`). Le survol de
 * l'un montre le même jour sur tous, et la valeur de ce jour à la place du total.
 */
export function SmallMultiples({ items, xLabels, columns = 3, height = 44 }: { items: Multiple[]; xLabels: string[]; columns?: 2 | 3 | 6; height?: number }) {
  const { index, setIndex } = useHoverIndex();
  const n = xLabels.length;
  const cols = columns === 6 ? 'sm:grid-cols-3 xl:grid-cols-6' : columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3';
  return (
    <div className="flex flex-col gap-1">
      <div className={`a-multiples grid grid-cols-2 ${cols}`}>
        {items.map((m) => {
          const empty = m.series.length > 0 && m.series.every((v) => !v);
          const shown = index != null && index < m.series.length ? m.format(m.series[index]) : m.total;
          const head = (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="a-kicker truncate">{m.label}</span>
              <div className="flex items-baseline gap-2">
                <span className="a-stat-value">{shown}</span>
                {index == null && m.previous !== undefined && <DeltaBadge current={m.current} previous={m.previous} invert={m.invert} />}
              </div>
            </div>
          );
          return (
            <div key={m.key} className="a-multiple flex min-w-0 flex-col gap-2 px-4 py-3">
              {m.to ? <Link to={m.to} className="a-focus no-underline">{head}</Link> : head}
              <div className="relative" style={{ height }}
                onPointerMove={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setIndex(nearestIndex(e.clientX - r.left, n, 0, r.width));
                }}
                onPointerLeave={() => setIndex(null)}>
                {empty && m.emptyText
                  ? <div className="a-t3 flex h-full items-end text-[12px]">{m.emptyText}</div>
                  : <Spark data={m.series} kind={m.kind} height={height} highlight={index} color="var(--a-text-2)" />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="a-mono a-t3 flex justify-between px-4 text-[11px]">
        <span>{xLabels[0] ?? ''}</span>
        <span>{index != null ? xLabels[index] : ''}</span>
        <span>{xLabels[n - 1] ?? ''}</span>
      </div>
    </div>
  );
}
