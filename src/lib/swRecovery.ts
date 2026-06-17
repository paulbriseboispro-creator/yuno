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
