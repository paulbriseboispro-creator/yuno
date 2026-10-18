let purging = false;

/**
 * Nuclear recovery for a returning visitor stuck on a stale precached bundle.
 *
 * A plain `location.reload()` does NOT unstick a client whose old service worker
 * is still controlling the page: the SW re-serves the same outdated index.html
 * and the same outdated JS chunks straight from its precache, so the reload just
 * loops on the same broken build. After the Lovable→Supabase migration this left
 * returning visitors on a build whose checkout fetch rejected with the misleading
 * "Failed to send a request to the Edge Function" — the backend was healthy, the
 * client was serving stale code.
 *
 * This unregisters every service worker and deletes every Cache Storage entry
 * FIRST, so the subsequent reload is no longer SW-controlled and fetches a fresh
 * index + fresh chunks from the network, installing the current (auto-reloading)
 * SW. One bounce and the user is permanently unstuck — even if their old SW had
 * no auto-reload logic. Idempotent: a second call while one is in flight no-ops.
 */
export async function purgeServiceWorkersAndReload(): Promise<void> {
  if (purging) return;
  purging = true;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
    }
  } catch (err) {
    // Reload anyway — a partial purge plus a network fetch still beats looping.
    console.error('[swRecovery] purge failed, reloading anyway:', err);
  } finally {
    window.location.reload();
  }
}

const LOCALE_RELOAD_KEY = 'yuno-locale-reload-attempted';

/**
 * Le dictionnaire de langue est introuvable (404 : l'onglet tourne sur un
 * ancien index servi par le service worker, dont les fichiers ont disparu au
 * déploiement suivant). Sans dictionnaire, LanguageContext ne rend RIEN : écran
 * noir, et sur /l/<code> le clic d'un lien suivi n'est même pas compté.
 * On purge et on recharge UNE fois par onglet (comme lazyWithRetry), jamais
 * hors ligne : là, recharger ne ferait qu'effacer le cache utile.
 *
 * Rend true si un rechargement est parti ; false = aucune récupération possible
 * (déjà tentée, hors ligne, stockage indisponible) : l'appelant doit alors rendre
 * l'app quand même (clés brutes) plutôt que de laisser un écran noir.
 */
export function recoverFromMissingLocaleOnce(): boolean {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    if (sessionStorage.getItem(LOCALE_RELOAD_KEY) === 'true') return false;
    sessionStorage.setItem(LOCALE_RELOAD_KEY, 'true');
  } catch {
    return false;
  }
  void purgeServiceWorkersAndReload();
  return true;
}

/** Le dictionnaire s'est chargé : la prochaine panne aura droit à sa propre récupération. */
export function clearLocaleRecoveryFlag(): void {
  try { sessionStorage.removeItem(LOCALE_RELOAD_KEY); } catch { /* stockage indisponible */ }
}
