/**
 * Mouvement de la Console CRM (guidelines/motion du design system) :
 * entrée 700-800 ms ease-out, montée de 22 px, cascade de ~70-90 ms ;
 * compteurs et courbes qui se dessinent en ~1,3-1,5 s. Tout se coupe quand
 * l'appareil demande moins d'animations.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

export const EASE = 'cubic-bezier(.22,1,.36,1)';
export const SPRING = 'cubic-bezier(.34,1.56,.64,1)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Vrai deux images après le montage : déclenche l'entrée des blocs. */
export function useIntro(enabled = true): boolean {
  const [on, setOn] = useState(() => !enabled || prefersReducedMotion());
  useEffect(() => {
    if (on) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setOn(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [on]);
  return on;
}

/**
 * Style d'entrée d'un bloc (opacité + montée), décalé de `delay` ms. Les
 * transitions de survol du prototype (translate, ombre, bordure) sont
 * ajoutées pour ne pas être écrasées.
 */
export function reveal(intro: boolean, delay: number, extra = ''): CSSProperties {
  return {
    opacity: intro ? 1 : 0,
    transform: intro ? 'none' : 'translateY(22px)',
    transition: `opacity 700ms ${EASE} ${delay}ms,transform 800ms ${EASE} ${delay}ms,translate 240ms ${EASE},box-shadow 240ms,border-color 200ms${extra ? ',' + extra : ''}`,
  };
}

/**
 * Progression 0 → 1 (ease-out cubique) sur `dur` ms après `delay` ms.
 * Relancée quand `key` change (nouvelle période, nouvelles données).
 */
export function useProgress(dur: number, delay: number, key: unknown = 0, enabled = true): number {
  const [p, setP] = useState(() => (!enabled || prefersReducedMotion() ? 1 : 0));
  const raf = useRef(0);
  useEffect(() => {
    if (!enabled || prefersReducedMotion()) { setP(1); return; }
    setP(0);
    const t0 = performance.now() + delay;
    const step = (now: number) => {
      const x = Math.max(0, Math.min(1, (now - t0) / dur));
      setP(1 - Math.pow(1 - x, 3));
      if (x < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [dur, delay, key, enabled]);
  return p;
}

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** `inset()` qui découvre un tracé de gauche à droite (courbes, barres). */
export function wipe(x: number): string {
  return `inset(-10% ${((1 - x) * 100).toFixed(1)}% -10% 0)`;
}
