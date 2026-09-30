/**
 * Montants des dashboards pro (Console Club, Console Organisateur) : porte
 * unique d'affichage. RÈGLE : un montant en euros s'affiche TOUJOURS avec deux
 * chiffres après la virgule (« 12,00 € », « €12.00 »), jamais arrondi à l'euro,
 * jamais en notation compacte (« 3,1 k€ ») — un pro compare des centimes.
 *
 * Le hook `useMoney` vit dans `src/hooks/useMoney.ts` (ce fichier reste pur,
 * testable). Ne sert PAS aux pourcentages, aux compteurs ni aux champs de
 * saisie. Les axes de graphique peuvent rester compacts (`formatMoneyAxis`).
 */

export function localeFor(language: string | undefined): string {
  return language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
}

const cache = new Map<string, Intl.NumberFormat>();
function formatter(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    cache.set(key, f);
  }
  return f;
}

/** « 12,00 € » (fr / es) · « €12.00 » (en). Valeur absente ou non finie → « — ». */
export function formatMoney(value: number | string | null | undefined, locale = 'fr-FR', currency = 'EUR'): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  // −0 s'afficherait « -0,00 € » : un zéro n'a pas de signe.
  return formatter(locale, currency).format(Math.abs(n) < 0.005 ? 0 : n);
}

/** Montant signé pour une déduction : « −0,27 € » (jamais « −0,00 € »). */
export function formatMoneyNegative(value: number, locale = 'fr-FR'): string {
  return value > 0.004 ? `−${formatMoney(value, locale)}` : formatMoney(0, locale);
}

/** Graduation d'un axe : compacte, c'est le seul endroit où elle est permise. */
export function formatMoneyAxis(value: number, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'EUR', notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: Math.abs(value) >= 10000 ? 1 : 0,
  }).format(value);
}

/**
 * Comme `formatMoney`, pour un helper de module sans accès à la langue du
 * contexte : lit `<html lang>` (posé par LanguageContext) à chaque appel.
 */
export function formatMoneyAuto(value: number | string | null | undefined): string {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : '';
  return formatMoney(value, localeFor(lang.slice(0, 2)));
}
