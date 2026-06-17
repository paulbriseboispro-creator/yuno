import { lazy, type ComponentType } from 'react';
import { purgeServiceWorkersAndReload } from './swRecovery';

const RELOAD_KEY = 'yuno-chunk-reload-attempted';

/**
 * Drop-in replacement for React.lazy() that automatically recovers from
 * chunk load failures (broken Vite HMR cache, stale production build, network hiccup).
 *
 * On first failure → sets a sessionStorage flag, then purges the stale service
 * worker + Cache Storage and reloads. The purge is essential: a chunk load
 * failure on a deployed build almost always means a stale SW is serving an old
 * index that references chunks no longer on the server. A plain reload would be
 * re-intercepted by that SW and fail identically; clearing it first forces a
 * fresh network fetch of the current build. On second failure (after reload) →
 * throws so the nearest ErrorBoundary can display a fallback instead of looping.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    try {
      const mod = await importFn();
      sessionStorage.removeItem(RELOAD_KEY);
      return mod;
    } catch (err) {
      const alreadyRetried = sessionStorage.getItem(RELOAD_KEY) === 'true';
      if (!alreadyRetried) {
        sessionStorage.setItem(RELOAD_KEY, 'true');
        await purgeServiceWorkersAndReload();
        return new Promise<never>(() => {});
      }
      throw err;
    }
  });
}
