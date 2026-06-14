import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'yuno-chunk-reload-attempted';

/**
 * Drop-in replacement for React.lazy() that automatically recovers from
 * chunk load failures (broken Vite HMR cache, stale production build, network hiccup).
 *
 * On first failure → sets a sessionStorage flag and reloads the page, which
 * clears the ES module registry. On second failure (after reload) → throws so
 * the nearest ErrorBoundary can display a fallback instead of looping forever.
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
        window.location.reload();
        return new Promise<never>(() => {});
      }
      throw err;
    }
  });
}
