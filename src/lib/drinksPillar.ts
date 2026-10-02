/**
 * Pilier « Commande de boissons » (skip the bar queue) — MIS EN PAUSE le
 * 2026-10-01, décision stratégique de Paul.
 *
 * Yuno se présente désormais sur DEUX piliers : billets d'événements et
 * tables VIP. Tout le système boissons (carte du bar, commande au QR,
 * click & collect, menu VIP à table, upsells de consos, crédits boissons,
 * écran barman, analyses du bar, catalogue admin) reste dans le code et dans
 * la base — c'est un projet en développement, pas une fonctionnalité
 * supprimée — mais il n'est plus montré à personne : ni au client, ni dans la
 * Console, ni dans l'app Pro, ni dans la démo.
 *
 * Tant que `DRINKS_PILLAR_LIVE` est à `false` :
 *   - les routes boissons de `App.tsx` redirigent (`drinksRoute`) ;
 *   - les entrées de navigation, onglets, cartes et sections boissons des
 *     pages partagées (Commandes, Analytics, formulaire de soirée, fiche
 *     soirée publique, confirmation d'achat, fidélité…) ne se rendent pas ;
 *   - le discours public (landing, /links, piliers à l'inscription) parle de
 *     deux piliers.
 *
 * Pour travailler sur le projet en local : `VITE_DRINKS_PILLAR_LIVE=1` dans
 * `.env.local`. Un build de production (Cloudflare, Xcode Cloud) n'a pas
 * cette variable : le pilier y reste éteint. Le jour où on le relance, poser
 * la variable dans les builds OU remplacer la lecture par `true`, puis relire
 * `docs/DRINKS_PILLAR_PAUSED.md` (inventaire des surfaces gatées).
 */
export const DRINKS_PILLAR_LIVE: boolean = import.meta.env.VITE_DRINKS_PILLAR_LIVE === '1';

/** Les types de récompense fidélité encore proposés : la boisson offerte dort avec le pilier. */
export function loyaltyRewardTypeVisible(type: string): boolean {
  return DRINKS_PILLAR_LIVE || type !== 'free_drink';
}
