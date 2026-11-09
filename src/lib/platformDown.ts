/**
 * Interrupteur d'URGENCE : quand le backend (Supabase) ne répond plus du tout,
 * la maintenance ne peut pas se lire dans `app_settings` — la base est
 * injoignable. Cette constante, compilée dans le bundle, affiche l'écran
 * statique `ServiceDown` à TOUS les visiteurs, sur toutes les routes.
 *
 * Mise en service : 2026-11-09, projet Supabase restreint (HTTP 402,
 * `exceed_storage_size_quota`, Fair Use Policy) jusqu'à levée de la restriction.
 *
 * Pour rouvrir : repasser à `false`, redéployer.
 */
export const PLATFORM_DOWN = true;
