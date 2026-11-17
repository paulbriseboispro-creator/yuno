/**
 * Les petites formes en barres du kit (v3), une version de chacune :
 *   Columns      barres verticales datées ou étiquetées, une seule échelle ;
 *   PairBars     deux barres (période d'avant en gris, période en encre) ;
 *   MiniBar      une barre comparable d'une ligne à l'autre (même max) ;
 *   TinyBars     une série en mini-barres dans une ligne de tableau ;
 *   CapacityBar  la part utilisée d'une capacité, le ton suit le seuil ;
 *   Level        un niveau sur N crans ;
 *   Complete     une complétude (3 / 5) ;
 *   DeadlineBar  un délai qui se remplit, Countdown le compte à rebours ;
 *   SegmentBar   une barre découpée en segments cliquables (filtre).
 * Chaque barre a son info-bulle dessinée et son résumé texte (`aria-label`).
 * Variables `--a-*` seulement ; un zéro ne fait pas une forme vide.
 */
import type { ReactNode } from 'react';
import type { Tone } from '../tone';
import { TONE_FILL } from './core';
import { useTip } from './Tip';

const INK_SOFT = 'color-mix(in srgb, var(--a-text) 26%, transparent)';

// ── Colonnes ─────────────────────────────────────────────────────────────────
export interface Column { key: string; x: string; value: number; display: string }

export function Columns({ items, height = 110, emptyText, highlight = 'last', values = false, label }: {
  items: Column[];
  height?: number;
  emptyText: ReactNode;
  /** La barre en rouge : la dernière (la période en cours) ou la plus haute. */
  highlight?: 'last' | 'max' | 'none';
  /** Écrire la valeur au-dessus de chaque barre (peu de barres). */
  values?: boolean;
  /** Ce que mesurent les barres (lecteur d'écran). */
  label?: string;
}) {
  const tip = useTip();
  const max = Math.max(0, ...items.map((i) => i.value));
  if (items.length === 0 || max <= 0) return <p className="a-t3 text-[13px]">{emptyText}</p>;
  const hot = highlight === 'last' ? items.length - 1 : highlight === 'max' ? items.findIndex((i) => i.value === max) : -1;
  const summary = `${label ? `${label} : ` : ''}${items.map((i) => `${i.x} ${i.display}`).join(', ')}`;
  const few = items.length <= 14;
  return (
    <div ref={tip.ref} className="relative flex flex-col gap-1" role="img" aria-label={summary}>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {items.map((it, i) => (
          <div key={it.key} className="flex h-full min-w-0 flex-1 flex-col justify-end" {...tip.on(it.x, [{ label: label ?? '', value: it.display, strong: true }])}>
            {values && it.value > 0 && <span className="a-mono a-t2 mb-0.5 truncate text-center text-[10px]">{it.display}</span>}
            <div className="rounded-t-[2px]" style={{
              height: it.value > 0 ? `${Math.max(3, (it.value / max) * (values ? 80 : 100))}%` : 1,
              background: it.value <= 0 ? 'var(--a-grid)' : i === hot ? 'var(--a-chart-1)' : INK_SOFT,
            }} />
          </div>
        ))}
      </div>
      {few ? (
        <div className="a-mono a-t3 flex gap-[3px] text-[10px]" aria-hidden>
          {items.map((it) => <span key={it.key} className="min-w-0 flex-1 truncate text-center">{it.x}</span>)}
        </div>
      ) : (
        <div className="a-mono a-t3 flex justify-between text-[11px]" aria-hidden><span>{items[0]?.x}</span><span>{items[items.length - 1]?.x}</span></div>
      )}
      {tip.node}
    </div>
  );
}

// ── Deux barres ──────────────────────────────────────────────────────────────
export function PairBars({ prev, cur, title, width = 36, height = 16 }: { prev: number; cur: number; title?: string; width?: number; height?: number }) {
  const max = Math.max(prev, cur, 0);
  const h = (v: number) => (max <= 0 ? 0 : Math.max(v > 0 ? 2 : 0, (v / max) * height));
  const bw = Math.floor(width / 2) - 2;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ display: 'block', flex: 'none' }}>
      <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke="var(--a-grid)" />
      <rect x={1} y={height - h(prev)} width={bw} height={h(prev)} rx={1} fill="var(--a-prev)" />
      <rect x={bw + 4} y={height - h(cur)} width={bw} height={h(cur)} rx={1} fill="var(--a-text-2)" />
    </svg>
  );
}

// ── Barre comparable ─────────────────────────────────────────────────────────
/** `max` est le même pour toute la colonne ; `null` = donnée absente (un tiret). */
export function MiniBar({ value, max, display, tone = 'neutral', width = 88, label }: {
  value: number | null | undefined; max: number; display?: ReactNode; tone?: Tone; width?: number; label?: string;
}) {
  if (value == null) return <span className="a-t3 a-mono text-[11px]">—</span>;
  const pct = max > 0 ? Math.max(value > 0 ? 3 : 0, (value / max) * 100) : 0;
  return (
    <span className="inline-flex items-center gap-2" role={label ? 'img' : undefined} aria-label={label}>
      <span className="inline-block h-[6px] overflow-hidden rounded-full" style={{ width, background: 'var(--a-grid)' }}>
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: TONE_FILL[tone] }} />
      </span>
      <span className="a-num a-t1 min-w-[2rem] text-right text-[12.5px]">{display ?? value}</span>
    </span>
  );
}

// ── Mini-barres ──────────────────────────────────────────────────────────────
export function TinyBars({ data, labels, max, tone = 'neutral', height = 18, label, format = String }: {
  data: number[]; labels?: string[]; max?: number; tone?: Tone; height?: number; label?: string; format?: (v: number) => string;
}) {
  const tip = useTip<HTMLSpanElement>();
  const m = max ?? Math.max(0, ...data);
  if (data.length === 0) return <span className="a-t3 a-mono text-[11px]">—</span>;
  return (
    <span ref={tip.ref} className="relative inline-flex items-end gap-[2px]" style={{ height }} role="img" aria-label={label}>
      {data.map((v, i) => (
        <span key={i} className="w-[4px] rounded-[1px]" {...tip.on(labels?.[i] ?? '', [{ label: label ?? '', value: format(v), strong: true }])}
          style={{ height: m > 0 ? Math.max(v > 0 ? 3 : 1, (v / m) * height) : 1, background: v > 0 ? TONE_FILL[tone] : 'var(--a-grid)' }} />
      ))}
      {tip.node}
    </span>
  );
}

// ── Capacité ─────────────────────────────────────────────────────────────────
/** Part utilisée d'une capacité. Le ton suit le seuil, jamais une couleur choisie. */
export function CapacityBar({ used, cap, warnAt = 0.7, negAt = 0.9, className, label }: {
  used: number; cap: number; warnAt?: number; negAt?: number; className?: string; label?: string;
}) {
  const r = cap > 0 ? used / cap : 0;
  const color = r >= negAt ? 'var(--a-neg)' : r >= warnAt ? 'var(--a-warn)' : 'var(--a-pos)';
  return (
    <div className={`a-subtle h-1.5 w-full overflow-hidden rounded-full ${className ?? ''}`} role="meter" aria-label={label}
      aria-valuemin={0} aria-valuemax={cap} aria-valuenow={used}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, r * 100))}%`, background: color }} />
    </div>
  );
}

// ── Niveau ───────────────────────────────────────────────────────────────────
/** Un niveau sur N crans, le courant plein : « 3 sur 5 » se lit sans chiffre. */
export function Level({ level, max = 5, label }: { level: number; max?: number; label?: string }) {
  return (
    <div className="flex items-center gap-[3px]" role="img" aria-label={label ?? `${level}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className="h-[10px] w-[14px] rounded-[2px]" style={{ background: i < level ? 'var(--a-text)' : 'var(--a-grid)', opacity: i < level ? 0.35 + 0.65 * ((i + 1) / Math.max(1, level)) : 1 }} />
      ))}
    </div>
  );
}

// ── Complétude ───────────────────────────────────────────────────────────────
export function Complete({ done, total }: { done: number; total: number }) {
  const full = total > 0 && done >= total;
  return (
    <span className="inline-flex items-center gap-2" role="img" aria-label={`${done}/${total}`}>
      <span className="inline-flex gap-[2px]" aria-hidden>
        {Array.from({ length: Math.max(1, total) }, (_, i) => (
          <span key={i} className="h-[8px] w-[8px] rounded-[2px]" style={{ background: i < done ? (full ? 'var(--a-pos)' : 'var(--a-text-2)') : 'var(--a-grid)' }} />
        ))}
      </span>
      <span className="a-mono a-t2 text-[11px]" aria-hidden>{done}/{total}</span>
    </span>
  );
}

// ── Délais ───────────────────────────────────────────────────────────────────
/** Un délai qui se remplit : plus il est plein, plus l'échéance est proche. */
export function DeadlineBar({ share, tone, label, right, mark }: {
  share: number; tone: Tone; label?: ReactNode; right?: ReactNode;
  /** Un repère (0..1) : l'échéance d'avant prolongation. */
  mark?: number;
}) {
  const pct = Math.max(0, Math.min(1, share)) * 100;
  const fill = tone === 'neutral' ? 'var(--a-text-3)' : TONE_FILL[tone];
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="relative h-[6px] w-full rounded-full" style={{ background: 'var(--a-grid)' }} role="img"
        aria-label={`${typeof label === 'string' ? `${label} : ` : ''}${Math.round(pct)} %`}>
        <div className="h-full overflow-hidden rounded-full"><div className="h-full rounded-full" style={{ width: `${Math.max(pct > 0 ? 3 : 0, pct)}%`, background: fill }} /></div>
        {mark != null && mark > 0 && mark < 1 && <span aria-hidden className="absolute -inset-y-[3px] w-[2px]" style={{ left: `${mark * 100}%`, background: 'var(--a-text-2)' }} />}
      </div>
      {(label || right) && (
        <div className="flex items-baseline gap-2 text-[12px]">
          {label && <span className="a-t2 min-w-0 truncate">{label}</span>}
          {right && <span className="a-mono a-t3 ml-auto text-[11px]">{right}</span>}
        </div>
      )}
    </div>
  );
}

/** Le compte à rebours en pièce maîtresse : « 41 h 12 », en grand, et la barre qui s'épuise. */
export function Countdown({ hours, total, tone, label, done }: { hours: number; total: number; tone: Tone; label: ReactNode; done?: ReactNode }) {
  const over = hours <= 0;
  const h = Math.floor(Math.abs(hours));
  const m = Math.floor((Math.abs(hours) - h) * 60);
  const used = total > 0 ? Math.max(0, Math.min(1, 1 - hours / total)) : 1;
  return (
    <div className="flex flex-col gap-3">
      <span className="a-kicker">{label}</span>
      {done ? <span className="a-t1 text-[28px] font-semibold tracking-[-0.03em]">{done}</span> : (
        <span className="a-t1 a-num text-[44px] font-semibold leading-none tracking-[-0.03em] md:text-[56px]" style={{ color: over ? 'var(--a-neg)' : undefined }}>
          {over ? '−' : ''}{h}<span className="a-t3 text-[22px] font-medium"> h </span>{String(m).padStart(2, '0')}<span className="a-t3 text-[22px] font-medium"> min</span>
        </span>
      )}
      {!done && <DeadlineBar share={used} tone={tone} />}
    </div>
  );
}

// ── Barre segmentée cliquable ────────────────────────────────────────────────
export interface Segment { key: string; label: string; value: number; color: string; hint?: string }

/** Largeur = nombre ; cliquer un segment filtre ; un zéro n'est pas dessiné mais reste dans la légende. */
export function SegmentBar({ segments, selected, onSelect, ariaLabel, fmt }: {
  segments: Segment[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  ariaLabel: string;
  fmt: (n: number) => string;
}) {
  const tip = useTip();
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={ariaLabel}>
      <div ref={tip.ref} className="relative flex h-9 w-full gap-[2px]">
        {shown.map((s) => {
          const on = selected === s.key;
          return (
            <button key={s.key} type="button" aria-pressed={on} aria-label={`${s.label} ${fmt(s.value)}`}
              {...tip.on(s.label, [{ label: s.hint ?? '', value: fmt(s.value), color: s.color, strong: true }])}
              onClick={() => onSelect(on ? null : s.key)}
              className="a-focus relative min-w-[28px] overflow-hidden rounded-[3px] border-0 p-0 text-left"
              style={{
                flexGrow: s.value, flexBasis: 0, cursor: 'pointer', background: s.color,
                boxShadow: on ? 'inset 0 0 0 2px var(--a-accent)' : undefined,
                opacity: selected && !on ? 0.45 : 1, transition: 'opacity 120ms',
              }}>
              <span className="a-mono absolute bottom-1 left-1.5 text-[11px] font-medium" style={{ color: 'var(--a-text)' }}>{fmt(s.value)}</span>
            </button>
          );
        })}
        {shown.length === 0 && <div className="h-full w-full rounded-[3px]" style={{ background: 'var(--a-grid)' }} />}
        {tip.node}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => {
          const on = selected === s.key;
          return (
            <button key={s.key} type="button" disabled={s.value <= 0} onClick={() => onSelect(on ? null : s.key)}
              className="a-focus inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-[12px]"
              style={{ cursor: s.value > 0 ? 'pointer' : 'default', opacity: s.value > 0 ? 1 : 0.45 }}>
              <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: s.color, boxShadow: on ? '0 0 0 1.5px var(--a-accent)' : undefined }} />
              <span className={on ? 'a-t1 font-medium' : 'a-t2'}>{s.label}</span>
              <span className="a-mono a-t3 text-[11px]">{fmt(s.value)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
