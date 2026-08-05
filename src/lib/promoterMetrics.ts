/**
 * Taux de conversion promoteur — DÉFINITION UNIQUE, partagée par toutes les
 * surfaces (promoteur, owner, agence, co-event). Avant, chaque écran calculait
 * son propre nombre : le tableau du promoteur faisait « toutes les conversions /
 * clics », celui de l'owner « billets / clics » → deux taux différents pour le
 * MÊME promoteur sur la MÊME soirée.
 *
 * Numérateur = ventes PAYANTES réelles attribuées (billets + tables). Volontairement
 * exclus :
 *   - la guest list (gratuite) — c'est un « nombre d'invités amenés », pas la
 *     conversion d'un clic en achat ;
 *   - les overrides (part reversée au chef d'équipe) — un dédoublement d'une
 *     conversion déjà comptée ;
 *   - les conversions remboursées ('cancelled').
 *
 * Plafonné à 100 % : une vente peut arriver sans clic tracé (code partagé
 * hors-ligne, code déjà en storage, inscription guest list qui contourne la page
 * event), et le taux dépassait alors 100 % — ce qui se lit comme un bug.
 */
export function promoterConversionRate(paidConversions: number, clicks: number): number {
  if (!clicks || clicks <= 0) return 0;
  return Math.min(100, (paidConversions / clicks) * 100);
}
