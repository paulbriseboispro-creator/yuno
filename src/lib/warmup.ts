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

/**
 * `scope` :
 * - 'app' (défaut, natif/PWA pendant le splash) : toutes les surfaces majeures.
 * - 'web' (Explorer web, une fois le feed peint) : seulement le chemin d'achat
 *   et la bottom nav — la navigation garde l'écran courant tant que le chunk
 *   n'est pas là (v7_startTransition), donc chaque chunk non préchauffé se
 *   paie en latence perçue AU TAP. Idle + séquentiel : jamais en concurrence
 *   avec les affiches du feed.
 */
export function warmupApp(scope: 'app' | 'web' = 'app'): void {
  if (started) return;
  started = true;

  const idle = (cb: () => void) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) ric(cb, { timeout: 2500 });
    else setTimeout(cb, 300);
  };

  idle(() => {
    const surfaces: Array<() => Promise<unknown>> = scope === 'web' ? [
      () => import('@/pages/EventDetails'),
      () => import('@/pages/VenuePage'),
      () => import('@/pages/TicketSelection'),
      () => import('@/pages/AllEventsPage'),
      () => import('@/pages/Favorites'),
      () => import('@/pages/MyOrders'),
      () => import('@/pages/Profile'),
    ] : [
      // 1. Onglets de la bottom nav — un tap depuis l'Explorer, toujours.
      () => import('@/pages/Favorites'),
      () => import('@/pages/MyOrders'),
      () => import('@/pages/Profile'),
      () => import('@/pages/ClubMap'),
      // 2. Piliers (billets / VIP / boissons) — accès direct depuis l'Explorer.
      () => import('@/pages/EventTicketsLanding'),
      () => import('@/pages/VipTablesLanding'),
      () => import('@/pages/OrderDrinksLanding'),
      // 3. Parcours d'achat et fiches.
      () => import('@/pages/VenuePage'),
      () => import('@/pages/EventDetails'),
      () => import('@/pages/TicketSelection'),
      () => import('@/pages/TicketCheckout'),
      () => import('@/pages/AllEventsPage'),
      () => import('@/pages/AllClubsPage'),
      () => import('@/pages/AllDJsPage'),
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
