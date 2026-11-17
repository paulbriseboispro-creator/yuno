/**
 * Formes v3 composées localement pour les rubriques Pros et Clients (à remonter
 * au kit `src/admin/ui` si elles servent ailleurs) :
 *   - SegmentBar   : une barre découpée en segments cliquables, largeur =
 *                    nombre (cycle de vie des pros, statuts) ; le segment choisi
 *                    porte le filet d'accent, un zéro n'est pas dessiné ;
 *   - PairBars     : deux petites barres côte à côte, période précédente en gris
 *                    et période en encre, quand la donnée n'a pas de série ;
 *   - Meter        : une petite barre de 0 à 100 (santé d'un compte) ;
 *   - Spine        : la frise d'un compte ou d'une personne, groupée par mois,
 *                    du plus récent au plus ancien, un point coloré par famille ;
 *   - Facts        : un rail de faits libellé / valeur, sans boîte ;
 *   - useListKeys  : j / k / flèches / entrée dans une liste dense.
 * Couleurs : variables `--a-*` seulement ; le rouge n'est que la sélection.
 */
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate } from '@/lib/adminFormat';
import { useAdminT } from '@/admin/ui';
import { isTyping } from '../shell/keys';

// ── Barre segmentée ──────────────────────────────────────────────────────────
export interface Segment { key: string; label: string; value: number; color: string; hint?: string }

export function SegmentBar({ segments, selected, onSelect, ariaLabel, fmt }: {
  segments: Segment[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  ariaLabel: string;
  fmt: (n: number) => string;
}) {
  const shown = segments.filter((s) => s.value > 0);
  const zero = segments.filter((s) => s.value <= 0);
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={ariaLabel}>
      <div className="flex h-9 w-full gap-[2px]">
        {shown.map((s) => {
          const on = selected === s.key;
          return (
            <button key={s.key} type="button" aria-pressed={on} title={s.hint ? `${s.label} · ${s.hint}` : s.label}
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
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => {
          const on = selected === s.key;
          return (
            <button key={s.key} type="button" disabled={s.value <= 0} onClick={() => onSelect(on ? null : s.key)} title={s.hint}
              className="a-focus inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-[12px]"
              style={{ cursor: s.value > 0 ? 'pointer' : 'default', opacity: s.value > 0 ? 1 : 0.45 }}>
              <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: s.color, boxShadow: on ? '0 0 0 1.5px var(--a-accent)' : undefined }} />
              <span className={on ? 'a-t1 font-medium' : 'a-t2'}>{s.label}</span>
              <span className="a-mono a-t3 text-[11px]">{fmt(s.value)}</span>
            </button>
          );
        })}
        {zero.length === segments.length && <span className="a-t3 text-[12px]">—</span>}
      </div>
    </div>
  );
}

/** Teinte d'encre neutre pour un rang d'étape (0..n-1), de 10 à 30 %. */
export function stepInk(i: number, n: number): string {
  const k = n <= 1 ? 1 : i / (n - 1);
  return `color-mix(in srgb, var(--a-text) ${Math.round(10 + k * 20)}%, transparent)`;
}

// ── Deux barres ──────────────────────────────────────────────────────────────
export function PairBars({ prev, cur, title, width = 36, height = 16 }: { prev: number; cur: number; title?: string; width?: number; height?: number }) {
  const max = Math.max(prev, cur, 0);
  const h = (v: number) => (max <= 0 ? 0 : Math.max(v > 0 ? 2 : 0, (v / max) * height));
  const bw = Math.floor(width / 2) - 2;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} style={{ display: 'block', flex: 'none' }}>
      <title>{title}</title>
      <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke="var(--a-grid)" />
      <rect x={1} y={height - h(prev)} width={bw} height={h(prev)} rx={1} fill="var(--a-prev)" />
      <rect x={bw + 4} y={height - h(cur)} width={bw} height={h(cur)} rx={1} fill="var(--a-text-2)" />
    </svg>
  );
}

// ── Jauge 0 à 100 ────────────────────────────────────────────────────────────
export function Meter({ value, width = 48, title }: { value: number | null | undefined; width?: number; title?: string }) {
  if (value == null) return <span className="a-t3 text-[12px]">—</span>;
  const v = Math.max(0, Math.min(100, value));
  const color = v < 40 ? 'var(--a-warn)' : 'var(--a-text-2)';
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span className="relative h-1.5 rounded-full" style={{ width, background: 'var(--a-grid)' }}>
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v}%`, background: color }} />
      </span>
      <span className="a-mono a-t2 text-[11px]">{Math.round(v)}</span>
    </span>
  );
}

// ── Frise ────────────────────────────────────────────────────────────────────
export interface SpineItem {
  id: string;
  /** ISO 8601 ; un élément sans date valide est écarté. */
  at: string;
  /** Famille : décide du point et de l'étiquette mono. */
  family: string;
  title: ReactNode;
  body?: ReactNode;
  /** Valeur à droite (montant, nombre). */
  value?: ReactNode;
  /** Un élément qui compte (première vente, accès ouvert) : point plus fort. */
  strong?: boolean;
}

/** La frise : groupée par mois, plus récent en haut ; `familyLabel` donne le mot mono. */
export function Spine({ items, familyLabel, familyColor, empty, limit, onMore }: {
  items: SpineItem[];
  familyLabel: (f: string) => string;
  familyColor?: (f: string) => string;
  empty: ReactNode;
  limit?: number;
  onMore?: () => void;
}) {
  const { lang } = useAdminT();
  const valid = items.filter((x) => x.at && !Number.isNaN(new Date(x.at).getTime()))
    .sort((a, b) => b.at.localeCompare(a.at));
  if (valid.length === 0) return <p className="a-t3 text-[13px]">{empty}</p>;
  const shown = limit ? valid.slice(0, limit) : valid;
  const month = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' });
  const dayFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });
  const groups: Array<{ m: string; label: string; rows: SpineItem[] }> = [];
  for (const it of shown) {
    const m = it.at.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.m === m) last.rows.push(it);
    else groups.push({ m, label: month.format(new Date(`${m}-15T12:00:00Z`)), rows: [it] });
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.m} className="flex flex-col">
          <h3 className="a-kicker mb-1.5">{g.label}</h3>
          <ol className="flex flex-col">
            {g.rows.map((it, i) => (
              <li key={it.id} className="grid grid-cols-[3.75rem_0.75rem_minmax(0,1fr)_auto] items-start gap-x-3 py-1.5">
                <time className="a-mono a-t3 whitespace-nowrap pt-[1px] text-[11px]" dateTime={it.at} title={fmtDate(it.at, lang, 'datetime')}>{dayFmt.format(new Date(it.at))}</time>
                <span className="relative flex h-full justify-center">
                  <span className="mt-[5px] h-2 w-2 flex-none rounded-full"
                    style={{ background: familyColor?.(it.family) ?? 'var(--a-text-3)', boxShadow: it.strong ? '0 0 0 3px color-mix(in srgb, var(--a-text) 10%, transparent)' : undefined }} />
                  {i < g.rows.length - 1 && <span aria-hidden className="absolute bottom-[-8px] top-[15px] w-px" style={{ background: 'var(--a-border)' }} />}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className={`text-[13px] ${it.strong ? 'a-t1 font-medium' : 'a-t1'}`}>{it.title}</span>
                    <span className="a-mono a-t3 text-[10.5px] uppercase tracking-[0.04em]">{familyLabel(it.family)}</span>
                  </div>
                  {it.body && <div className="a-t2 mt-0.5 text-[12.5px] leading-relaxed">{it.body}</div>}
                </div>
                {it.value != null ? <span className="a-num a-t2 text-right text-[12.5px]">{it.value}</span> : <span />}
              </li>
            ))}
          </ol>
        </section>
      ))}
      {limit && valid.length > limit && onMore && (
        <button type="button" className="a-btn a-btn--sm self-start" onClick={onMore}>+ {valid.length - limit}</button>
      )}
    </div>
  );
}

// ── Rail de faits ────────────────────────────────────────────────────────────
export interface Fact { label: ReactNode; value: ReactNode; mono?: boolean }

export function Facts({ title, items }: { title?: ReactNode; items: Fact[] }) {
  const shown = items.filter((x) => x.value != null && x.value !== '' && x.value !== false);
  if (shown.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      {title && <h3 className="a-kicker mb-1">{title}</h3>}
      <dl className="flex flex-col">
        {shown.map((f, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-baseline gap-3 py-1">
            <dt className="a-t3 truncate text-[12px]">{f.label}</dt>
            <dd className={`a-t1 min-w-0 break-words text-[13px] ${f.mono ? 'a-mono text-[12px]' : ''}`}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ── Clavier d'une liste ──────────────────────────────────────────────────────
/** j / k / flèches choisissent une ligne, entrée l'ouvre. Rien quand on écrit. */
export function useListKeys<T>(rows: T[], idOf: (r: T) => string, selected: string | null, setSelected: (id: string) => void, open: (r: T) => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || rows.length === 0) return;
      const i = rows.findIndex((r) => idOf(r) === selected);
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setSelected(idOf(rows[Math.min(rows.length - 1, i + 1)])); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setSelected(idOf(rows[Math.max(0, i - 1)])); }
      else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); open(rows[i]); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [rows, idOf, selected, setSelected, open]);
  // La ligne choisie reste visible.
  useEffect(() => {
    if (!selected) return;
    const el = document.querySelector(`[data-row-id="${CSS.escape(selected)}"]`);
    if (el && 'scrollIntoView' in el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [selected]);
}

/** Une puce de filtre : choisie = encre forte et filet d'accent. */
export function Chip({ on, onClick, children, count }: { on: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className="a-focus inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]"
      style={{
        cursor: 'pointer', background: on ? 'var(--a-accent-soft)' : 'transparent',
        borderColor: on ? 'var(--a-accent)' : 'var(--a-border)', color: on ? 'var(--a-accent-text)' : 'var(--a-text-2)',
      }}>
      {children}
      {count != null && <span className="a-mono text-[11px] opacity-70">{count}</span>}
    </button>
  );
}

// ── Sans boîtes : remplaçants de Card / KpiRow / Kpi pour les sections secondaires ──
/** Un bloc titré par un filet (pas de bordure autour). Mêmes props que Card. */
export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; padded?: boolean; footer?: ReactNode }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 ${className ?? ''}`}>
      {(title || actions) && (
        <div className="flex items-center gap-3 border-b pb-2">
          {title && <h3 className="a-t1 text-[13.5px] font-semibold">{title}</h3>}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Une bande de chiffres à filets verticaux (remplace KpiRow). */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap border-y [&>*]:min-w-[8.5rem] [&>*]:flex-1 [&>*+*]:border-l">{children}</div>;
}

/** Un chiffre de bande : libellé mono, valeur 20 px, lien facultatif (remplace Kpi). */
export function Stat({ label, value, hint, to, loading }: { label: ReactNode; value: ReactNode; hint?: string; to?: string; loading?: boolean; current?: number | null; previous?: number | null; invert?: boolean; spark?: number[] }) {
  const body = (
    <div className="flex h-full flex-col gap-1 px-4 py-3">
      <span className="a-kicker truncate" title={hint}>{label}</span>
      {loading ? <span className="a-skel h-6 w-16" /> : <span className="a-stat-value">{value}</span>}
    </div>
  );
  return <div>{to ? <Link to={to} className="a-focus block h-full no-underline hover:bg-[var(--a-hover)]">{body}</Link> : body}</div>;
}
