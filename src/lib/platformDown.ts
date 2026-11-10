/**
 * Interrupteur d'URGENCE : quand le backend (Supabase) ne répond plus du tout,
 * la maintenance ne peut pas se lire dans `app_settings` — la base est
 * injoignable. Cette constante, compilée dans le bundle, affiche l'écran
 * statique `ServiceDown` à TOUS les visiteurs, sur toutes les routes.
 *
 * Éteint le 2026-11-10 : offre Supabase payante reprise, API rétablie.
 * Historique : 2026-11-10 (matin), projet rétrogradé en offre gratuite en
 * attendant le remboursement ; 2026-11-09, projet restreint (HTTP 402,
 * `exceed_storage_size_quota`, Fair Use Policy).
 *
 * Pour fermer en urgence : repasser à `true`, redéployer.
 */
export const PLATFORM_DOWN = false;
