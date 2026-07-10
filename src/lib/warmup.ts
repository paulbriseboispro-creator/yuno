/**
 * Warmup app native — lancé pendant le splash animé : précharge les chunks
 * des surfaces majeures pour que la première navigation soit instantanée
 * (zéro spinner de lazy-load), comme une app native.
 *
 * Séquentiel + requestIdleCallback : ne concurrence jamais le chargement de
 * l'Explorer (qui pilote markAppReady → la sortie du splash). Les imports
 * dynamiques pointent sur les mêmes modules que lazyWithRetry (App.tsx) :
 * Vite déduplique, le chunk est déjà en cache au moment du lazy réel.
 */

let started = false;

export function warmupApp(): void {
  if (started) return;
  started = true;

  const idle = (cb: () => void) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) ric(cb, { timeout: 2500 });
    else setTimeout(cb, 300);
  };

  idle(() => {
    const surfaces: Array<() => Promise<unknown>> = [
      () => import('@/pages/VenuePage'),
      () => import('@/pages/EventDetails'),
      () => import('@/pages/TicketSelection'),
      () => import('@/pages/TicketCheckout'),
      () => import('@/pages/Favorites'),
      () => import('@/pages/MyOrders'),
      () => import('@/pages/Profile'),
      () => import('@/pages/AllEventsPage'),
      () => import('@/pages/Cart'),
      () => import('@/pages/YunoAssistantPage'),
    ];
    void (async () => {
      for (const load of surfaces) {
        try {
          await load();
        } catch {
          // Offline / chunk manquant : la navigation fera son lazy-load normal.
        }
      }
    })();
  });
}
