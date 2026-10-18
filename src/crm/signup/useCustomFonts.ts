/**
 * Les polices Google d'un design sur mesure (page d'inscription) : chargées
 * une fois par famille, dans le document (le Shadow DOM des sections les
 * trouve par leur nom).
 */
import { useEffect } from 'react';
import { customFontFamilies, googleFontHref } from './custom';
import type { CustomTheme } from './custom';

/**
 * Charge les polices Google d'un design (titres, texte, extras), une fois par
 * famille. Une graisse que la famille n'a pas fait échouer la feuille : on la
 * recharge alors sans graisse (régulier), plutôt que de tomber sur la police
 * du système.
 */
export function useCustomFonts(theme: CustomTheme | null | undefined): void {
  // Une clé texte : l'effet ne rejoue que quand les familles changent.
  const key = theme ? JSON.stringify(customFontFamilies(theme)) : '';
  useEffect(() => {
    if (!key) return;
    for (const { family, weights } of JSON.parse(key) as { family: string; weights: number[] }[]) {
      const id = `yc-font-${family.replace(/\W+/g, '-').toLowerCase()}`;
      if (document.getElementById(id)) continue;
      const l = document.createElement('link');
      l.id = id;
      l.rel = 'stylesheet';
      l.href = googleFontHref(family, weights);
      l.onerror = () => { l.onerror = null; l.href = googleFontHref(family); };
      document.head.appendChild(l);
    }
  }, [key]);
}
