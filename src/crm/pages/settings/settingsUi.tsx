/**
 * Pièces de l'écran Réglages : la carte de section (qui monte en se
 * défloutant quand elle entre à l'écran), son en-tête, le sélecteur en
 * pastilles, l'interrupteur vert et le compteur qui glisse vers sa valeur.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Hv } from '@/crm/ui/Hv';
import { Icon } from '@/crm/ui/Icon';
import { EASE, SPRING, prefersReducedMotion } from '@/crm/ui/motion';

export type SecId = 'a' | 'b' | 'c' | 'd' | 'e';

/** Tracés du design pour les icônes de section absentes de la bibliothèque. */
export const SEC_ICON: Record<SecId, string> = {
  a: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01',
  b: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  c: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  d: 'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3',
  e: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36z',
};

/** Style d'apparition d'une section (montée de 26 px, flou de 8 px). */
export function secReveal(delay: number | undefined): CSSProperties {
  const on = delay !== undefined;
  const d = `${delay ?? 0}ms`;
  return {
    opacity: on ? 1 : 0,
    transform: on ? 'none' : 'translateY(26px)',
    filter: on ? 'blur(0px)' : 'blur(8px)',
    transition: `opacity 700ms ${EASE} ${d},transform 800ms ${EASE} ${d},filter 700ms ${EASE} ${d}`,
  };
}

export function SecCard({ id, delay, gap = 26, children, plain }: { id: SecId; delay: number | undefined; gap?: number; children: ReactNode; plain?: boolean }) {
  return (
    <section
      id={`sec-${id}`}
      data-sec={id}
      style={{
        scrollMarginTop: 110, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap, minWidth: 0,
        ...(plain ? {} : { borderRadius: 28, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--sand-200),var(--shadow-sm)', padding: 'clamp(20px,2.4vw,32px)' }),
        ...secReveal(delay),
      }}
    >
      {children}
    </section>
  );
}

export function SecHead({ id, title, sub, right, mb = 0 }: { id: SecId; title: string; sub: string; right?: ReactNode; mb?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: mb }}>
      <span style={{ flex: 'none', width: 44, height: 44, borderRadius: 14, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center' }}>
        <Icon d={SEC_ICON[id]} size={21} stroke={2} />
      </span>
      {/* Le badge passe sous le titre quand la place manque, jamais à côté d'une colonne écrasée. */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap-reverse', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px 16px' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.02em', textWrap: 'balance' }}>{title}</h2>
          <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--sand-500)', textWrap: 'pretty' }}>{sub}</span>
        </div>
        {right}
      </div>
    </div>
  );
}

/** Pastilles « radio » : fond sable, l'option choisie en blanc. */
export function Seg<T extends string | number | null>({
  options, value, onChange, disabled, h = 36, px = 14, fs = 14, wrap, label,
}: { options: { v: T; l: string }[]; value: T; onChange: (v: T) => void; disabled?: boolean; h?: number; px?: number; fs?: number; wrap?: boolean; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', flexWrap: wrap ? 'wrap' : 'nowrap', padding: 4, gap: 2, borderRadius: 99, background: 'var(--sand-100)', maxWidth: '100%', opacity: disabled ? 0.6 : 1 }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Hv
            key={String(o.v)}
            as="button"
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.v)}
            style={{
              flex: 'none', height: h, padding: `0 ${px}px`, border: 0, borderRadius: 99, background: on ? '#fff' : 'transparent',
              color: on ? 'var(--ink)' : 'var(--sand-600)', boxShadow: on ? 'var(--shadow-xs),0 0 0 1px var(--sand-200)' : 'none',
              fontSize: fs, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
              transition: 'background 200ms,color 200ms,box-shadow 200ms',
            }}
            hover={disabled || on ? {} : { color: 'var(--ink)' }}
            active={disabled ? {} : { transform: 'scale(.97)' }}
          >
            {o.l}
          </Hv>
        );
      })}
    </div>
  );
}

/** Interrupteur vert 48 × 28 du design (pages, inscriptions). */
export function GreenSwitch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{ flex: 'none', position: 'relative', width: 48, height: 28, padding: 0, border: 0, borderRadius: 99, background: on ? 'var(--green-500)' : 'var(--sand-300)', cursor: disabled ? 'not-allowed' : 'pointer', transition: 'background 200ms' }}
    >
      <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 22, height: 22, borderRadius: 99, background: '#fff', boxShadow: '0 1px 3px rgba(28,21,23,.25)', transition: `left 220ms ${SPRING}` }} />
    </button>
  );
}

/**
 * Valeur affichée qui glisse vers `target` en 650 ms (ease-out cubique),
 * à partir de 0 la première fois que `start` passe à vrai.
 */
export function useTween(target: number | null, start: boolean, delay = 0): number {
  const [v, setV] = useState(0);
  const cur = useRef(0);
  const raf = useRef(0);
  const begun = useRef(false);
  useEffect(() => {
    if (!start || target === null) return;
    if (prefersReducedMotion()) { cur.current = target; setV(target); return; }
    const from = cur.current;
    const wait = begun.current ? 0 : delay;
    begun.current = true;
    const t0 = performance.now() + wait;
    cancelAnimationFrame(raf.current);
    const step = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / 650));
      const x = from + (target - from) * (1 - Math.pow(1 - p, 3));
      cur.current = x;
      setV(x);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, start, delay]);
  return v;
}

/** Note grise avec cadenas (rôle qui ne permet pas de modifier). */
export function LockNote({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.45, color: 'var(--sand-500)', ...style }}>
      <Icon name="lock" size={14} stroke={2.2} style={{ marginTop: 2 }} />{children}
    </span>
  );
}

/** Champ texte du design (50 px, bordure qui rougit au focus). */
export const fieldCss = (bad: boolean): CSSProperties => ({
  height: 50, boxSizing: 'border-box', padding: '0 16px', borderRadius: 12, border: `1px solid ${bad ? 'var(--red-400)' : 'var(--sand-200)'}`,
  background: '#fff', fontSize: 16, fontWeight: 500, color: 'var(--ink)', outline: 'none', width: '100%', minWidth: 0,
});
