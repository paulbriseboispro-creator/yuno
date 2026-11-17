/**
 * Formes composées localement pour Légal, Communication et Système (v3).
 * Aucune n'existe encore dans `src/admin/ui` : à remonter au kit si une autre
 * rubrique en a besoin. Toutes lisent les variables `--a-*` (jamais un
 * hexadécimal) et se tiennent debout sur des volumes nuls.
 *
 *   Verdict      le héros d'une page d'état : un point, une phrase de verdict ;
 *   DeadlineBar  un délai qui se remplit (reçu → échéance), le ton suit l'urgence ;
 *   Countdown    le compte à rebours en pièce maîtresse (heures, minutes) ;
 *   Scale5       un niveau sur cinq crans ;
 *   MiniBar      une barre comparable d'une ligne à l'autre (même max) ;
 *   Complete     une complétude (3 / 5) en petite barre ;
 *   Steps        une frise d'étapes (fait / à faire) ;
 *   Ledger       un registre de lignes séparées par des filets, sans carte ;
 *   StateMark    pastille + mot d'un état ;
 *   Cutoff       ce qu'on vient d'apprendre quand la donnée manque (une phrase).
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LegalState } from './rules';

export type Tone3 = 'ok' | 'todo' | 'late' | 'none';

const DOT: Record<Tone3, string> = { ok: 'var(--a-pos)', todo: 'var(--a-warn)', late: 'var(--a-neg-soft)', none: 'var(--a-text-3)' };
const FILL: Record<Tone3, string> = { ok: 'var(--a-pos)', todo: 'var(--a-warn)', late: 'var(--a-neg-soft)', none: 'var(--a-text-3)' };

export function toneOfState(s: LegalState): Tone3 { return s; }

/** Le héros d'une page d'état : une phrase de verdict, précédée d'un point de la couleur de l'état. */
export function Verdict({ tone, kicker, headline, sub, actions }: { tone: Tone3; kicker: ReactNode; headline: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 pb-2">
      <span className="a-kicker">{kicker}</span>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-[14px] h-3 w-3 flex-none rounded-full" style={{ background: DOT[tone] }} />
        <h2 className="a-t1 text-[28px] font-semibold leading-[1.18] tracking-[-0.03em] md:text-[32px]" style={{ textWrap: 'balance', maxWidth: '36ch' }}>{headline}</h2>
      </div>
      {sub && <p className="a-hero-sentence max-w-[68ch]">{sub}</p>}
      {actions && <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>}
    </section>
  );
}

export function StateMark({ tone, children }: { tone: Tone3; children: ReactNode }) {
  return (
    <span className="a-t1 inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium">
      <span aria-hidden className="h-[8px] w-[8px] flex-none rounded-full" style={{ background: DOT[tone] }} />
      {children}
    </span>
  );
}

/** Part du délai écoulée, bornée à [0, 1]. Une base de durée nulle ou une date illisible = 0. */
export function elapsedShare(from: number, to: number, now: number): number {
  const span = to - from;
  if (!Number.isFinite(span) || span <= 0) return 0;
  return Math.max(0, Math.min(1, (now - from) / span));
}

/** Un délai qui se remplit : plus il est plein, plus l'échéance est proche. */
export function DeadlineBar({ share, tone, label, right, mark }: { share: number; tone: Tone3; label?: ReactNode; right?: ReactNode; /** Un repère (0..1) : l'échéance d'avant prolongation. */ mark?: number }) {
  const pct = Math.max(0, Math.min(1, share)) * 100;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="relative h-[6px] w-full rounded-full" style={{ background: 'var(--a-grid)' }} role="img" aria-label={typeof label === 'string' ? label : undefined}>
        <div className="h-full overflow-hidden rounded-full"><div className="h-full rounded-full" style={{ width: `${Math.max(pct > 0 ? 3 : 0, pct)}%`, background: FILL[tone] }} /></div>
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
export function Countdown({ hours, total, tone, label, done }: { hours: number; total: number; tone: Tone3; label: ReactNode; done?: ReactNode }) {
  const over = hours <= 0;
  const h = Math.floor(Math.abs(hours));
  const m = Math.floor((Math.abs(hours) - h) * 60);
  const used = total > 0 ? Math.max(0, Math.min(1, 1 - hours / total)) : 1;
  return (
    <div className="flex flex-col gap-3">
      <span className="a-kicker">{label}</span>
      {done ? <span className="a-t1 text-[28px] font-semibold tracking-[-0.03em]">{done}</span> : (
        <span className="a-t1 a-num text-[56px] font-semibold leading-none tracking-[-0.03em]" style={{ color: over ? 'var(--a-neg)' : undefined }}>
          {over ? '−' : ''}{h}<span className="a-t3 text-[24px] font-medium"> h </span>{String(m).padStart(2, '0')}<span className="a-t3 text-[24px] font-medium"> min</span>
        </span>
      )}
      {!done && <DeadlineBar share={used} tone={tone} />}
    </div>
  );
}

/** Un niveau sur N crans, le courant plein : « 3 sur 5 » se lit sans chiffre. */
export function Scale5({ level, max = 5, label }: { level: number; max?: number; label?: string }) {
  return (
    <div className="flex items-center gap-[3px]" role="img" aria-label={label ?? `${level}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className="h-[10px] w-[14px] rounded-[2px]" style={{ background: i < level ? 'var(--a-text)' : 'var(--a-grid)', opacity: i < level ? 0.35 + 0.65 * ((i + 1) / Math.max(1, level)) : 1 }} />
      ))}
    </div>
  );
}

/** Une barre comparable d'une ligne à l'autre : `max` est le même pour toute la colonne. */
export function MiniBar({ value, max, display, tone = 'none', width = 88 }: { value: number | null | undefined; max: number; display?: ReactNode; tone?: Tone3; width?: number }) {
  if (value == null) return <span className="a-t3 a-mono text-[11px]">—</span>;
  const pct = max > 0 ? Math.max(value > 0 ? 3 : 0, (value / max) * 100) : 0;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block h-[6px] overflow-hidden rounded-full" style={{ width, background: 'var(--a-grid)' }}>
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: tone === 'none' ? 'var(--a-text-2)' : FILL[tone] }} />
      </span>
      <span className="a-num a-t1 min-w-[2.5rem] text-right text-[12.5px]">{display ?? value}</span>
    </span>
  );
}

/** Complétude d'un dossier : n sur total, en petite barre. */
export function Complete({ done, total }: { done: number; total: number }) {
  const full = total > 0 && done >= total;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex gap-[2px]" aria-hidden>
        {Array.from({ length: Math.max(1, total) }, (_, i) => (
          <span key={i} className="h-[8px] w-[8px] rounded-[2px]" style={{ background: i < done ? (full ? 'var(--a-pos)' : 'var(--a-text-2)') : 'var(--a-grid)' }} />
        ))}
      </span>
      <span className="a-mono a-t2 text-[11px]">{done}/{total}</span>
    </span>
  );
}

/** Une frise d'étapes : fait (plein) ou à faire (creux), reliées par un filet. */
export function Steps({ items }: { items: Array<{ key: string; label: ReactNode; when?: ReactNode; done: boolean; current?: boolean }> }) {
  return (
    <ol className="grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}>
      {items.map((s, i) => (
        <li key={s.key} className="relative flex min-w-0 flex-col gap-1.5 pr-2 pt-5">
          <span aria-hidden className="absolute left-0 right-0 top-[7px] h-px" style={{ background: i < items.length - 1 && s.done ? 'var(--a-text-2)' : 'var(--a-border-strong)' }} />
          <span aria-hidden className="absolute left-0 top-[2px] h-[11px] w-[11px] rounded-full border"
            style={{ background: s.done ? 'var(--a-text)' : 'var(--a-panel)', borderColor: s.current ? 'var(--a-accent)' : 'var(--a-text-2)', boxShadow: s.current ? '0 0 0 3px var(--a-ring)' : undefined }} />
          <span className="a-t1 text-[12.5px] font-medium leading-tight">{s.label}</span>
          {s.when && <span className="a-mono a-t3 text-[11px]">{s.when}</span>}
        </li>
      ))}
    </ol>
  );
}

/** Un registre : des lignes séparées par des filets, jamais une carte par ligne. */
export function Ledger({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col divide-y border-y ${className ?? ''}`}>{children}</div>;
}

export function LedgerRow({ to, onClick, selected, children, className }: { to?: string; onClick?: () => void; selected?: boolean; children: ReactNode; className?: string }) {
  const cls = `a-focus grid items-center gap-x-4 gap-y-1 px-1 py-3 text-left no-underline ${selected ? 'bg-[var(--a-hover)]' : 'hover:bg-[var(--a-hover)]'} ${className ?? ''}`;
  if (to) return <Link to={to} className={cls}>{children}</Link>;
  if (onClick) return <button type="button" className={`${cls} w-full`} onClick={onClick}>{children}</button>;
  return <div className={cls}>{children}</div>;
}

export function GoTo({ children }: { children: ReactNode }) {
  return <span className="a-t2 inline-flex items-center gap-1 whitespace-nowrap text-[12.5px]">{children}<ArrowUpRight className="h-3.5 w-3.5" /></span>;
}

/** Une phrase quand il n'y a rien à dessiner : jamais une forme vide. */
export function Cutoff({ children }: { children: ReactNode }) {
  return <p className="a-t3 max-w-[68ch] text-[13px] leading-relaxed">{children}</p>;
}

/** L'heure courante, rafraîchie à la minute (échéances qui se vident). */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), everyMs); return () => window.clearInterval(id); }, [everyMs]);
  return now;
}

/** Mini-barres d'une série (échecs récents, envois du jour) : une barre par point, hauteur comparable. */
export function TinyBars({ data, max, tone = 'none', height = 18, label }: { data: number[]; max?: number; tone?: Tone3; height?: number; label?: string }) {
  const m = max ?? Math.max(0, ...data);
  if (data.length === 0) return <span className="a-t3 a-mono text-[11px]">—</span>;
  return (
    <span className="inline-flex items-end gap-[2px]" style={{ height }} role="img" aria-label={label}>
      {data.map((v, i) => (
        <span key={i} className="w-[4px] rounded-[1px]" style={{ height: m > 0 ? Math.max(v > 0 ? 3 : 1, (v / m) * height) : 1, background: v > 0 ? (tone === 'none' ? 'var(--a-text-2)' : FILL[tone]) : 'var(--a-grid)' }} />
      ))}
    </span>
  );
}

/** Un repli sans carte : un titre, un filet, le contenu qui s'ouvre (le clos, l'ancien). */
export function Disclosure({ title, hint, children, defaultOpen = false }: { title: ReactNode; hint?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group border-t pt-3" open={defaultOpen}>
      <summary className="a-focus flex cursor-pointer list-none items-center gap-2 rounded-md py-1 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="a-t3 h-4 w-4 flex-none transition-transform group-open:rotate-90" />
        <span className="a-t1 min-w-0 flex-1 truncate text-[14px] font-semibold">{title}</span>
        {hint && <span className="a-mono a-t3 flex-none text-[11px]">{hint}</span>}
      </summary>
      <div className="flex flex-col gap-4 pt-3">{children}</div>
    </details>
  );
}

/** Une barre à 100 % de parts, sans légende à décoder : chaque part s'écrit sous la barre (étiquetage direct). */
export function ShareBar({ parts, emptyText }: { parts: Array<{ key: string; label: ReactNode; value: number; display: string; tone: 'strong' | 'soft' | 'muted' | 'alert' }>; emptyText: string }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  if (total <= 0) return <Cutoff>{emptyText}</Cutoff>;
  const bg = { strong: 'var(--a-text)', soft: 'var(--a-text-3)', muted: 'var(--a-prev)', alert: 'var(--a-neg-soft)' } as const;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-[14px] w-full gap-[2px] overflow-hidden rounded-[3px]" role="img" aria-label={parts.map((p) => `${typeof p.label === 'string' ? p.label : ''} ${p.display}`).join(', ')}>
        {parts.filter((p) => p.value > 0).map((p) => <div key={p.key} style={{ flexGrow: p.value, flexBasis: 0, background: bg[p.tone], minWidth: 3 }} title={p.display} />)}
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-1">
        {parts.map((p) => (
          <li key={p.key} className="flex items-baseline gap-2 text-[12.5px]">
            <span aria-hidden className="h-2 w-2 flex-none self-center rounded-[2px]" style={{ background: bg[p.tone], opacity: p.value > 0 ? 1 : 0.3 }} />
            <span className="a-t2">{p.label}</span><span className="a-num a-t1 font-medium">{p.display}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
