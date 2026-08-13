/**
 * Porte unique du libellé de prix d'une soirée.
 *
 * Une soirée qui ne vend QUE des tables n'a pas de billet d'entrée : son prix
 * d'entrée n'existe pas, il ne vaut pas zéro. Or un modèle récurrent affilié
 * enregistre `price_from = 0` dans ce cas, et toutes les surfaces lisaient ce
 * zéro comme « Gratuit » — exactement le contraire de la réalité, sur la
 * soirée la plus chère du catalogue. Le libellé se décide donc ici, et
 * nulle part ailleurs.
 *
 * Trois cas, dans cet ordre :
 *   1. tables uniquement -> « Tables uniquement », jamais un prix ;
 *   2. gratuit revendiqué (`is_free`) -> « Gratuit » ;
 *   3. un prix réel (> 0) -> « À partir de X€ ». Un zéro sans `is_free` veut
 *      dire « prix non renseigné », pas « gratuit » : on n'affiche rien.
 */

export type PricedEvent = {
  minPrice?: number | null;
  tablesOnly?: boolean | null;
};

/** Un prix d'entrée n'a de sens que si la soirée vend des billets d'entrée. */
export function hasEntryPrice(event: PricedEvent): boolean {
  return !event.tablesOnly;
}

/**
 * Libellé court des cartes et listes. Retourne '' quand il n'y a rien d'honnête
 * à afficher — l'appelant garde la main sur la mise en page.
 */
export function eventPriceLabel(
  event: PricedEvent,
  t: (k: string) => string,
  opts?: { withFromPrefix?: boolean },
): string {
  if (event.tablesOnly) return t('explore.tablesOnly');
  if (event.minPrice === 0) return t('explore.free');
  if (event.minPrice != null && event.minPrice > 0) {
    return opts?.withFromPrefix === false
      ? `${event.minPrice}€`
      : `${t('explore.priceFrom')} ${event.minPrice}€`;
  }
  return '';
}

/**
 * Normalise le prix d'une soirée affiliée vers `minPrice`.
 *
 * `is_free` est la seule source de vérité du gratuit. Un `price_from` à zéro
 * n'est pas un prix : c'est un champ jamais rempli (le cas de tous les clubs
 * qui ne vendent que des tables), et le faire passer pour zéro euro rangeait
 * ces soirées dans le filtre « gratuit ».
 */
export function affiliateMinPrice(row: { is_free?: boolean | null; price_from?: number | null }): number | null {
  if (row.is_free) return 0;
  return row.price_from ? row.price_from : null;
}
