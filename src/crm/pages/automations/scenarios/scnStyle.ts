/**
 * Ce que les écrans Scénarios partagent hors composants : icône et couleur
 * d'une étape, hauteur mesurée de l'éditeur (jamais `100vh` : règle de
 * l'Email Studio).
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { IconName } from '@/crm/ui/Icon';

/** Hauteur disponible sous ce qui précède l'élément (`calc(100dvh - …)`). */
export function useMeasuredHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      let offset = 0;
      for (let n: HTMLElement | null = ref.current; n; n = n.offsetParent as HTMLElement | null) offset += n.offsetTop;
      setTop((prev) => (Math.abs(prev - offset) > 0.5 ? offset : prev));
    };
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure); };
  }, []);
  return { ref, height: top > 0 ? `calc(100dvh - ${Math.round(top)}px)` : '100dvh' };
}

export const NODE_ICON: Record<string, IconName> = {
  wait: 'clock', branch: 'filter', split: 'sliders', email: 'mail', sms: 'message', tag: 'tag',
  notify: 'bell', instagram_dm: 'instagram', end: 'check',
};

/** Couleur d'accent d'une étape (fond clair, encre). */
export const NODE_TINT: Record<string, { bg: string; fg: string }> = {
  wait: { bg: 'var(--sand-100)', fg: 'var(--sand-700)' },
  branch: { bg: 'var(--amber-50)', fg: 'var(--amber-700)' },
  split: { bg: 'var(--amber-50)', fg: 'var(--amber-700)' },
  email: { bg: 'var(--red-50)', fg: 'var(--red-700)' },
  sms: { bg: 'var(--red-50)', fg: 'var(--red-700)' },
  tag: { bg: 'var(--sand-100)', fg: 'var(--sand-700)' },
  notify: { bg: 'var(--sand-100)', fg: 'var(--sand-700)' },
  instagram_dm: { bg: 'var(--sand-100)', fg: 'var(--sand-500)' },
  end: { bg: 'var(--green-50)', fg: 'var(--green-700)' },
};
