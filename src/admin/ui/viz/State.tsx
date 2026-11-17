/**
 * Les pages d'état (v3) :
 *   Verdict  le héros d'une page d'état : un point de la couleur de l'état,
 *            une phrase de verdict, la suite en une ligne ;
 *   Steps    une frise d'étapes (fait / à faire), reliées par un filet.
 */
import type { ReactNode } from 'react';
import { TONE, type Tone } from '../tone';

/** Le héros d'une page d'état : une phrase de verdict, précédée d'un point de la couleur de l'état. */
export function Verdict({ tone, kicker, headline, sub, actions }: { tone: Tone; kicker: ReactNode; headline: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 pb-2">
      <span className="a-kicker">{kicker}</span>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-[14px] h-3 w-3 flex-none rounded-full" style={{ background: TONE[tone].dot }} />
        <h2 className="a-t1 text-[28px] font-semibold leading-[1.18] tracking-[-0.03em] md:text-[32px]" style={{ textWrap: 'balance', maxWidth: '36ch' }}>{headline}</h2>
      </div>
      {sub && <p className="a-hero-sentence max-w-[68ch]">{sub}</p>}
      {actions && <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>}
    </section>
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

