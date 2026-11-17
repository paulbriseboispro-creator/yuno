/**
 * Les formes qui suivent la question (v3). Chacune étiquetée directement,
 * sans légende à décoder, sans boîte autour :
 *   StackedShare  composition d'un total (barre à 100 %)
 *   Waterfall     passage d'un total à un autre (cascade)
 *   RankBars      classement (barres horizontales triées)
 *   BulletBar     une valeur contre un repère et des zones (Few)
 *   UptimeBars    santé d'un service, un trait par jour (Statuspage)
 *   FunnelSteps   étapes, la perte écrite entre deux étapes, la plus grosse marquée
 *   CohortGrid    triangle de cohortes teinté
 *   CalendarHeat  activité par jour, semaines en colonnes
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Tone } from '../tone';
import { biggestDrop, intensity, tintOf } from './core';
import { useTip } from './Tip';

// Le rouge (chart-1) n'est que l'attention : une composition prend les autres teintes.
const SERIES = ['var(--a-chart-2)', 'var(--a-chart-3)', 'var(--a-chart-4)', 'var(--a-chart-5)', 'var(--a-text-3)'];

// ── Composition ──────────────────────────────────────────────────────────────
export interface Part {
  key: string;
  label: string;
  value: number;
  display: string;
  /** Un sens plutôt qu'une série : fort (encre), doux, effacé, alerte. Sans ton : les couleurs de séries. */
  tone?: 'strong' | 'soft' | 'muted' | 'alert';
}

const PART_TONE = { strong: 'var(--a-text)', soft: 'var(--a-text-3)', muted: 'var(--a-prev)', alert: 'var(--a-neg-soft)' } as const;

/** Une barre à 100 %, chaque part écrite sous la barre (étiquetage direct, pas de légende à décoder). */
export function StackedShare({ parts, emptyText, fmtShare, legend = 'list' }: {
  parts: Part[];
  emptyText: ReactNode;
  /** Part en pourcentage à droite de chaque ligne ; rendre '' sous le seuil d'échantillon. */
  fmtShare?: (share: number) => string;
  /** `list` : une part par ligne ; `inline` : les parts côte à côte sous la barre. */
  legend?: 'list' | 'inline';
}) {
  const tip = useTip();
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (total <= 0) return <p className="a-t3 text-[13px]">{emptyText}</p>;
  const color = (p: Part, i: number) => (p.tone ? PART_TONE[p.tone] : SERIES[i % SERIES.length]);
  return (
    <div className="flex flex-col gap-3">
      <div ref={tip.ref} className="relative flex h-3 w-full gap-[2px] rounded-[3px]" role="img" aria-label={parts.map((p) => `${p.label} ${p.display}`).join(', ')}>
        {parts.map((p, i) => (p.value > 0 ? (
          <div key={p.key} className="first:rounded-l-[3px] last:rounded-r-[3px]" {...tip.on(p.label, [{ label: fmtShare?.(p.value / total) ?? '', value: p.display, color: color(p, i), strong: true }])}
            style={{ flexGrow: p.value, flexBasis: 0, background: color(p, i), minWidth: 3 }} />
        ) : null))}
        {tip.node}
      </div>
      <ul className={legend === 'inline' ? 'flex flex-wrap gap-x-6 gap-y-1' : 'flex flex-col gap-1.5'}>
        {parts.map((p, i) => (
          <li key={p.key} className={legend === 'inline' ? 'flex items-baseline gap-2 text-[12.5px]' : 'flex items-center gap-2 text-[13px]'}>
            <span aria-hidden className="h-2 w-2 flex-none self-center rounded-[2px]" style={{ background: color(p, i), opacity: p.value > 0 ? 1 : 0.3 }} />
            <span className={`a-t2 ${legend === 'list' ? 'min-w-0 flex-1 truncate' : ''}`}>{p.label}</span>
            <span className="a-num a-t1 font-medium">{p.display}</span>
            {fmtShare && legend === 'list' && <span className="a-mono a-t3 w-12 text-right text-[11px]">{fmtShare(p.value / total)}</span>}
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

/** Les totaux peuvent passer sous zéro (une marge négative) : l'axe zéro est alors tracé. */
export function Waterfall({ steps }: { steps: Step[] }) {
  let run = 0;
  const bars = steps.map((s) => {
    if (s.total) { run = s.value; return { s, from: 0, to: s.value }; }
    if (s.unknown) return { s, from: run, to: run };
    const from = run; run += s.value; return { s, from, to: run };
  });
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)));
  const hi = Math.max(0, ...bars.map((b) => Math.max(b.from, b.to)));
  const span = Math.max(1e-9, hi - lo);
  const pos = (v: number) => ((v - lo) / span) * 100;
  return (
    <ul className="flex flex-col gap-2" aria-label={steps.map((x) => `${x.label} ${x.unknown ?? x.display}`).join(', ')}>
      {bars.map(({ s, from, to }) => (
        <li key={s.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-[13px] sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto]">
          <span className={`truncate ${s.total ? 'a-t1 font-medium' : 'a-t2'}`}>{s.label}</span>
          {s.unknown ? (
            <span className="a-t3 col-span-2 text-right text-[11.5px]">{s.unknown}</span>
          ) : (
            <>
              <div className="relative h-4" aria-hidden>
                {lo < 0 && <div className="absolute inset-y-[-3px] w-px" style={{ left: `${pos(0)}%`, background: 'var(--a-text-3)' }} />}
                <div className="absolute inset-y-0 rounded-[2px]"
                  style={{ left: `${pos(Math.min(from, to))}%`, width: `max(2px, ${(Math.abs(to - from) / span) * 100}%)`,
                    background: s.total ? (to < 0 ? 'var(--a-neg-soft)' : 'var(--a-chart-1)') : s.value < 0 ? 'var(--a-prev)' : 'color-mix(in srgb, var(--a-chart-1) 45%, transparent)' }} />
              </div>
              <span className={`a-num text-right ${s.total ? 'a-t1 font-semibold' : 'a-t2'}`}>{s.display}</span>
            </>
          )}
        </li>
      ))}
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
                <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: i === 0 ? 'var(--a-text-2)' : 'color-mix(in srgb, var(--a-text) 26%, transparent)' }} />
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

export function UptimeBars({ days, label, summary, stateLabel }: {
  days: Array<{ d: string; state: Uptime; note?: string }>;
  label: ReactNode;
  summary?: ReactNode;
  /** Le mot d'un état dans l'info-bulle (« en panne »). */
  stateLabel?: (s: Uptime) => string;
}) {
  const tip = useTip();
  const color: Record<Uptime, string> = { ok: 'var(--a-pos)', warn: 'var(--a-warn)', down: 'var(--a-neg-soft)', none: 'var(--a-grid)' };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-[13px]"><span className="a-t1 flex-1">{label}</span>{summary && <span className="a-mono a-t3 text-[11px]">{summary}</span>}</div>
      <div ref={tip.ref} className="relative flex h-7 gap-[2px]" role="img" aria-label={`${typeof summary === 'string' ? summary : ''}`}>
        {days.map((x) => <div key={x.d} className="flex-1 rounded-[2px] hover:opacity-70" {...tip.on(x.d, [{ label: x.note ?? '', value: stateLabel?.(x.state) ?? x.state, color: color[x.state], strong: true }])} style={{ background: color[x.state] }} />)}
        {tip.node}
      </div>
    </div>
  );
}

// ── Entonnoir ────────────────────────────────────────────────────────────────
export interface FunnelStepV2 {
  key: string;
  label: string;
  value: number;
  display: string;
  /** D'où vient ce chiffre, en une ligne (source de la mesure). */
  source?: string;
}

/**
 * Étapes en barres horizontales sur UNE échelle commune, la perte ÉCRITE entre
 * deux étapes (en personnes), la plus coûteuse marquée. Une première étape plus
 * de 5 fois plus grande que la suivante (des visites face à des comptes) n'est
 * pas dessinée : elle s'écrit sur sa propre ligne, et l'échelle part de la
 * deuxième.
 */
export function FunnelSteps({ steps, lostText, lossLabel, fmtShare, worstLabel, offScaleLabel }: {
  steps: FunnelStepV2[];
  /** La perte avant l'étape `i`, en phrase (« 12 n'ont pas créé de compte »). */
  lostText?: (i: number, lost: number) => string;
  /** Repli : « −12 · 30 % » à partir du nombre et de la part. */
  lossLabel?: (lost: string, share: string) => string;
  fmtShare?: (r: number) => string;
  worstLabel?: string;
  /** Mot à côté d'une première étape trop grande pour l'échelle (« hors échelle »). */
  offScaleLabel?: string;
}) {
  const offScale = steps.length > 2 && (steps[1]?.value ?? 0) > 0 && steps[0].value > steps[1].value * 5;
  const drawn = offScale ? steps.slice(1) : steps;
  const top = Math.max(1, ...drawn.map((s) => s.value));
  const worst = biggestDrop(steps.map((s) => s.value));
  const lossOf = (i: number, lost: number, prev: number) =>
    lostText ? lostText(i, lost) : lossLabel ? lossLabel(String(lost), fmtShare && prev > 0 ? fmtShare(lost / prev) : '') : `−${lost}`;
  const summary = steps.map((s) => `${s.label} ${s.display}`).join(' → ');
  return (
    <div className="flex flex-col" role="img" aria-label={summary}>
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const lost = prev != null ? Math.max(0, prev - s.value) : 0;
        const isWorst = worst === i && lost > 0;
        const head = offScale && i === 0;
        return (
          <div key={s.key} className="flex flex-col">
            {prev != null && (
              <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-3 py-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                <span />
                <span className="text-[12px] leading-snug" style={{ color: isWorst ? 'var(--a-accent-text)' : 'var(--a-text-3)' }}>
                  {lost > 0 ? <>{isWorst && worstLabel && <b className="a-mono mr-1.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]">{worstLabel}</b>}↓ {lossOf(i, lost, prev)}</> : '↓'}
                </span>
              </div>
            )}
            <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
              <span className="min-w-0">
                <span className="a-t1 block truncate text-[13px] font-medium">{s.label}</span>
                {s.source && <span className="a-t3 block truncate text-[11.5px]">{s.source}</span>}
              </span>
              {head ? (
                <span className="a-mono a-t3 text-[11px]">{offScaleLabel ?? ''}</span>
              ) : (
                <span className="relative h-5 rounded-[3px]" style={{ background: 'var(--a-grid)' }} aria-hidden>
                  <span className="absolute inset-y-0 left-0 rounded-[3px]" style={{
                    width: s.value > 0 ? `max(3px, ${(s.value / top) * 100}%)` : 0,
                    background: i === steps.length - 1 ? 'var(--a-chart-1)' : 'color-mix(in srgb, var(--a-text) 38%, transparent)',
                  }} />
                </span>
              )}
              <span className="a-num a-t1 min-w-[3rem] text-right text-[15px] font-semibold">{s.display}</span>
            </div>
          </div>
        );
      })}
    </div>
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
/** Teinte d'une case : 25 à 85 % d'encre selon la part du maximum ; zéro reste la grille. */
function heatInk(v: number, max: number): string {
  if (v <= 0 || max <= 0) return 'var(--a-grid)';
  return `color-mix(in srgb, var(--a-text) ${Math.round(25 + 60 * Math.min(1, v / max))}%, transparent)`;
}

export function CalendarHeat({ days, fmt, weekdays, month }: {
  /** Jours consécutifs (AAAA-MM-JJ) et leur valeur. */
  days: Array<{ d: string; v: number }>;
  fmt: (d: string, v: number) => string;
  /** Initiales lundi → dimanche. */
  weekdays: string[];
  /** Nom court d'un mois pour le repère au-dessus des colonnes (« nov. »). */
  month?: (d: string) => string;
}) {
  const tip = useTip();
  const max = Math.max(0, ...days.map((x) => x.v));
  const first = days[0] ? (new Date(`${days[0].d}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;
  const cells: Array<{ d: string; v: number } | null> = [...Array(first).fill(null), ...days];
  const weeks: Array<typeof cells> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const active = days.filter((x) => x.v > 0).length;
  return (
    <div ref={tip.ref} className="relative flex gap-2" role="img" aria-label={`${active} / ${days.length}`}>
      <div className="a-mono a-t3 flex flex-col gap-[3px] pt-[16px] text-[10px]">{weekdays.map((w, i) => <span key={i} className="h-3 leading-3">{i % 2 === 0 ? w : ''}</span>)}</div>
      <div className="flex gap-[3px] overflow-x-auto">
        {weeks.map((w, i) => {
          const firstDay = w.find((c) => c)?.d;
          const prevFirst = i > 0 ? weeks[i - 1].find((c) => c)?.d : undefined;
          const newMonth = month && firstDay && (!prevFirst || firstDay.slice(0, 7) !== prevFirst.slice(0, 7));
          return (
            <div key={i} className="flex flex-col gap-[3px]">
              <span className="a-mono a-t3 h-[13px] whitespace-nowrap text-[10px] leading-[13px]">{newMonth && firstDay ? month(firstDay) : ''}</span>
              {Array.from({ length: 7 }, (_, j) => w[j]).map((c, j) => (
                <span key={j} className="h-3 w-3 rounded-[2px]" {...(c ? tip.on('', [{ label: '', value: fmt(c.d, c.v), strong: true }]) : {})}
                  style={{ background: c ? heatInk(c.v, max) : 'transparent', outline: c && c.v > 0 && c.v === max ? '1.5px solid var(--a-chart-1)' : undefined, outlineOffset: 1 }} />
              ))}
            </div>
          );
        })}
      </div>
      {tip.node}
    </div>
  );
}
