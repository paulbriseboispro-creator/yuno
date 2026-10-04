/**
 * Mouvements de la page Tarifs : un nombre qui glisse vers sa cible, une
 * section qui se déclenche à son entrée dans l'écran. « Réduire les
 * animations » rend tout immédiat.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { prefersReducedMotion } from '@/crm/ui/motion';

/** Un nombre qui rejoint sa cible en `dur` ms (ease-out quartique). */
export function useTween(target: number, dur = 800): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || prefersReducedMotion() || document.hidden) { from.current = target; setV(target); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - p, 4);
      const x = start + (target - start) * e;
      from.current = x;
      setV(x);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return v;
}

/** Vrai une fois l'élément entré dans l'écran (une seule fois). */
export function useSeen<T extends Element>(threshold = 0.12): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { threshold, rootMargin: '0px 0px -6% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen];
}
