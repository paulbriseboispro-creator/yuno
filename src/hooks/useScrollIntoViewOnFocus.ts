import { useEffect } from 'react';

/**
 * Clavier iOS : quand un input reçoit le focus dans un formulaire long, le
 * clavier peut recouvrir le champ (le WebView ne scrolle pas toujours seul).
 * Ce hook écoute les focus des champs texte du conteneur et recentre le champ
 * après l'ouverture du clavier (~300 ms d'animation iOS).
 *
 * Usage : appeler le hook dans la page ; il s'attache au document — les pages
 * checkout n'ont qu'un formulaire à la fois.
 */
export function useScrollIntoViewOnFocus(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
      // Laisser le clavier finir son animation avant de recentrer.
      const timer = setTimeout(() => {
        try {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch {
          // scrollIntoView options non supportées : fallback silencieux.
        }
      }, 300);
      // Si le champ perd le focus avant la fin, annuler.
      target.addEventListener('blur', () => clearTimeout(timer), { once: true });
    };

    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [enabled]);
}
