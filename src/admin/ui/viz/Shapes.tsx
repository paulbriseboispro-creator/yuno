/**
 * Les formes qui suivent la question (v3). Chacune étiquetée directement,
 * sans légende à décoder, sans boîte autour :
 *   StackedShare  composition d'un total (barre à 100 %)
 *   Waterfall     passage d'un total à un autre (cascade)
 *   RankBars      classement (barres horizontales triées)
 *   BulletBar     une valeur contre un repère et des zones (Few)
 *   UptimeBars    santé d'un service, un trait par jour (Statuspage)
 *   FunnelSteps   étapes, la perte écrite entre deux étapes
 *   CohortGrid    triangle de cohortes teinté
 *   CalendarHeat  activité par jour, semaines en colonnes
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { intensity, tintOf } from './core';

const SERIES = ['var(--a-chart-1)', 'var(--a-chart-2)', 'var(--a-chart-3)', 'var(--a-chart-4)', 'var(--a-chart-5)'];

// ── Composition ──────────────────────────────────────────────────────────────
export interface Part { key: string; label: string; value: number; display: string }

export function StackedShare({ parts, emptyText, fmtShare }: { parts: Part[]; emptyText: string; fmtShare: (share: number) => string }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (total <= 0) return <p className="a-t3 text-[13px]">{emptyText}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[3px]" role="img" aria-label={parts.map((p) => `${p.label} ${p.display}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p, i) => (
          <div key={p.key} title={`${p.label} · ${p.display}`} style={{ flexGrow: p.value, flexBasis: 0, background: SERIES[i % SERIES.length], minWidth: 3 }} />
        ))}
      </div>
      <ul className="flex flex-col gap-1.5">
        {parts.map((p, i) => (
          <li key={p.key} className="flex items-center gap-2 text-[13px]">
            <span aria-hidden className="h-2 w-2 flex-none rounded-[2px]" style={{ background: SERIES[i % SERIES.length], opacity: p.value > 0 ? 1 : 0.3 }} />
            <span className="a-t2 min-w-0 flex-1 truncate">{p.label}</span>
            <span className="a-num a-t1 font-medium">{p.display}</span>
            <span className="a-mono a-t3 w-12 text-right text-[11px]">{fmtShare(total > 0 ? p.value / total : 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Cascade ──────────────────────────────────────────────────────────────────
export interface Step {
  key: string;
  label: string;
  /** Valeur signée : positive ajoute, négative retire. `total` = barre posée sur zéro. */
  value: number;
  display: string;
  total?: boolean;
  /** Une étape inconnue (donnée absente) : dite, pas dessinée. */
  unknown?: string;
}

export function Waterfall({ steps }: { steps: Step[] }) {
  let run = 0;
  const bars = steps.map((s) => {
    if (s.total) { run = s.value; return { s, from: 0, to: s.value }; }
    if (s.unknown) return { s, from: run, to: run };
    const from = run; run += s.value; return { s, from, to: run };
  });
  const max = Math.max(1, ...bars.map((b) => Math.max(b.from, b.to)));
  return (
    <ul className="flex flex-col gap-2">
      {bars.map(({ s, from, to }) => {
        const a = Math.min(from, to) / max * 100, b = Math.abs(to - from) / max * 100;
        return (
          <li key={s.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
            <span className={`truncate ${s.total ? 'a-t1 font-medium' : 'a-t2'}`}>{s.label}</span>
            <div className="relative h-4">
              {s.unknown ? (
                <span className="a-t3 absolute inset-y-0 flex items-center text-[11.5px]" style={{ left: `${Math.min(80, a)}%` }}>{s.unknown}</span>
              ) : (
                <div className="absolute inset-y-0 rounded-[2px]" title={`${s.label} · ${s.display}`}
                  style={{ left: `${a}%`, width: `max(2px, ${b}%)`, background: s.total ? 'var(--a-chart-1)' : s.value < 0 ? 'var(--a-prev)' : 'color-mix(in srgb, var(--a-chart-1) 45%, transparent)' }} />
              )}
            </div>
            <span className={`a-num text-right ${s.total ? 'a-t1 font-semibold' : 'a-t2'}`}>{s.display}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ── Classement ───────────────────────────────────────────────────────────────
export interface Rank { key: string; label: ReactNode; value: number; display: string; to?: string; sub?: ReactNode }

export function RankBars({ items, max: maxIn, emptyText }: { items: Rank[]; max?: number; emptyText: string }) {
  if (items.length === 0) return <p className="a-t3 text-[13px]">{emptyText}</p>;
  const max = maxIn ?? Math.max(1, ...items.map((r) => r.value));
  return (
    <ol className="flex flex-col">
      {items.map((r, i) => {
        const row = (
          <div className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-1.5">
            <span className="a-mono a-t3 text-[11px]">{i + 1}</span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2"><span className="a-t1 truncate text-[13px]">{r.label}</span>{r.sub && <span className="a-t3 truncate text-[12px]">{r.sub}</span>}</div>
              <div className="mt-1 h-1.5 rounded-full" style={{ background: 'var(--a-grid)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: i === 0 ? 'var(--a-chart-1)' : 'color-mix(in srgb, var(--a-chart-1) 55%, transparent)' }} />
              </div>
            </div>
            <span className="a-num a-t1 text-[13px] font-medium">{r.display}</span>
          </div>
        );
        return <li key={r.key}>{r.to ? <Link to={r.to} className="a-focus block rounded-md no-underline hover:bg-[var(--a-hover)]">{row}</Link> : row}</li>;
      })}
    </ol>
  );
}

// ── Bullet ───────────────────────────────────────────────────────────────────
export function BulletBar({ value, target, zones, max, label, display, targetLabel }: {
  value: number; target?: number; zones?: [number, number]; max: number; label: ReactNode; display: string; targetLabel?: string;
}) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / Math.max(max, 1e-9)) * 100))}%`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-[13px]"><span className="a-t2 flex-1 truncate">{label}</span><span className="a-num a-t1 font-medium">{display}</span></div>
      <div className="relative h-3 rounded-[2px]" style={{ background: 'var(--a-grid)' }}>
        {zones && <>
          <div className="absolute inset-y-0" style={{ left: pct(zones[0]), right: `calc(100% - ${pct(zones[1])})`, background: 'color-mix(in srgb, var(--a-text) 6%, transparent)' }} />
          <div className="absolute inset-y-0" style={{ left: pct(zones[1]), right: 0, background: 'color-mix(in srgb, var(--a-text) 11%, transparent)' }} />
        </>}
        <div className="absolute inset-y-[3px] left-0 rounded-[1px]" style={{ width: pct(value), background: 'var(--a-text)' }} />
        {target != null && <div className="absolute -inset-y-1 w-[2px]" title={targetLabel} style={{ left: pct(target), background: 'var(--a-chart-1)' }} />}
      </div>
    </div>
  );
}

// ── Disponibilité ────────────────────────────────────────────────────────────
export type Uptime = 'ok' | 'warn' | 'down' | 'none';

export function UptimeBars({ days, label, summary }: { days: Array<{ d: string; state: Uptime; note?: string }>; label: ReactNode; summary?: ReactNode }) {
  const color: Record<Uptime, string> = { ok: 'var(--a-pos)', warn: 'var(--a-warn)', down: 'var(--a-neg-soft)', none: 'var(--a-grid)' };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-[13px]"><span className="a-t1 flex-1">{label}</span>{summary && <span className="a-mono a-t3 text-[11px]">{summary}</span>}</div>
      <div className="flex h-7 gap-[2px]">
        {days.map((x) => <div key={x.d} className="flex-1 rounded-[2px] hover:opacity-70" title={`${x.d}${x.note ? ` · ${x.note}` : ''}`} style={{ background: color[x.state] }} />)}
      </div>
    </div>
  );
}

// ── Entonnoir ────────────────────────────────────────────────────────────────
export interface FunnelStepV2 { key: string; label: string; value: number; display: string }

export function FunnelSteps({ steps, fmtShare, lossLabel }: { steps: FunnelStepV2[]; fmtShare: (r: number) => string; lossLabel: (lost: string, share: string) => string }) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="grid gap-px" style={{ gridTemplateColumns: `repeat(${Math.max(1, steps.length)}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const lost = prev != null ? Math.max(0, prev - s.value) : 0;
        return (
          <li key={s.key} className="flex min-w-0 flex-col gap-2 pr-3">
            <span className="a-kicker truncate">{s.label}</span>
            <span className="a-stat-value">{s.display}</span>
            <div className="h-16 rounded-[2px]" style={{ background: 'var(--a-grid)', display: 'flex', alignItems: 'flex-end' }}>
              <div className="w-full rounded-[2px]" style={{ height: `${Math.max(2, (s.value / top) * 100)}%`, background: i === steps.length - 1 ? 'var(--a-chart-1)' : 'color-mix(in srgb, var(--a-chart-1) 50%, transparent)' }} />
            </div>
            <span className="a-mono a-t3 h-4 text-[11px]">{prev != null && prev > 0 ? lossLabel(String(lost), fmtShare(lost / prev)) : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ── Cohortes ─────────────────────────────────────────────────────────────────
export function CohortGrid({ rows, columns, fmt }: {
  rows: Array<{ key: string; label: string; size: string; cells: Array<number | null> }>;
  columns: string[];
  /** Mise en forme d'une case (0..1 → « 42 % »). */
  fmt: (v: number) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="a-cohort w-full border-collapse text-[12px]">
        <thead><tr><th className="a-kicker text-left" /><th className="a-kicker text-right" />{columns.map((c) => <th key={c} className="a-kicker text-center">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="a-t2 whitespace-nowrap pr-3">{r.label}</td>
              <td className="a-mono a-t3 pr-3 text-right">{r.size}</td>
              {r.cells.map((v, i) => (
                <td key={i} className="a-num text-center" style={{ background: v == null ? undefined : tintOf(intensity(v, 1)), color: v == null ? 'var(--a-text-3)' : 'var(--a-text)' }}>
                  {v == null ? '' : fmt(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Calendrier ───────────────────────────────────────────────────────────────
export function CalendarHeat({ days, fmt, weekdays }: {
  /** Jours consécutifs (AAAA-MM-JJ) et leur valeur. */
  days: Array<{ d: string; v: number }>;
  fmt: (d: string, v: number) => string;
  /** Initiales lundi → dimanche. */
  weekdays: string[];
}) {
  const max = Math.max(0, ...days.map((x) => x.v));
  const first = days[0] ? (new Date(`${days[0].d}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const cells: Array<{ d: string; v: number } | null> = [...Array(first).fill(null), ...days];
  const weeks: Array<typeof cells> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <div className="flex gap-2">
      <div className="a-mono a-t3 flex flex-col gap-[3px] text-[10px]">{weekdays.map((w, i) => <span key={i} className="h-3 leading-3">{i % 2 === 0 ? w : ''}</span>)}</div>
      <div className="flex gap-[3px] overflow-x-auto">
        {weeks.map((w, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {Array.from({ length: 7 }, (_, j) => w[j]).map((c, j) => (
              <span key={j} className="h-3 w-3 rounded-[2px]" title={c ? fmt(c.d, c.v) : undefined}
                style={{ background: c ? (c.v > 0 ? tintOf(intensity(c.v, max)) : 'var(--a-grid)') : 'transparent', outline: c && c.v > 0 && c.v === max ? '1px solid var(--a-chart-1)' : undefined }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
