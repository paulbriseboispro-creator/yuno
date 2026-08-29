import { lazy, type ComponentType } from 'react';
import { purgeServiceWorkersAndReload } from './swRecovery';

const RELOAD_KEY = 'yuno-chunk-reload-attempted';

/**
 * Extrait l'URL du chunk fautif du message d'erreur du navigateur.
 * Chrome : « Failed to fetch dynamically imported module: https://…/assets/X.js »
 * Firefox : « error loading dynamically imported module: https://…/assets/X.js »
 * Safari ne donne aucune URL — on retombe alors sur la purge + rechargement.
 */
function chunkUrlFromError(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const m = msg.match(/https?:\/\/[^\s'")]+\.(?:js|mjs|css)(?:\?[^\s'")]*)?/i);
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    return u.origin === window.location.origin ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Purge les copies empoisonnées d'une URL de chunk avant de la redemander.
 *
 * Le poison : tant que Workers Assets répondait 200 + index.html pour un
 * `/assets/*` absent, `_headers` estampillait cette réponse HTML en
 * `immutable, max-age=31536000`. Le navigateur garde donc du HTML servi comme
 * JavaScript pendant un an sous cette URL exacte — un rechargement ne le voit
 * même pas passer, et purger le service worker n'y touche pas non plus : c'est
 * le cache HTTP disque. `cache: 'reload'` est le seul moyen de le réécrire.
 */
async function repairChunk(url: string): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys.map(async (k) => {
          try {
            const c = await caches.open(k);
            await c.delete(url);
          } catch { /* best effort */ }
        }),
      );
    }
  } catch { /* best effort */ }
  try {
    await fetch(url, { cache: 'reload' });
  } catch { /* best effort */ }
}

/**
 * Drop-in replacement for React.lazy() that automatically recovers from
 * chunk load failures (broken Vite HMR cache, stale production build, network hiccup).
 *
 * Trois paliers, du moins au plus brutal :
 *
 * 1. Ré-import de la MÊME URL avec un paramètre anti-cache. Ça contourne d'un
 *    coup le cache HTTP disque, le Cache Storage du service worker et le cache
 *    edge — les trois endroits où une réponse empoisonnée (du HTML mémorisé
 *    sous une URL de chunk, cf. `repairChunk`) peut survivre à un rechargement.
 *    Le chemin le plus fréquent, et le seul qui répare sans recharger la page :
 *    les imports relatifs du chunk se résolvent sans le paramètre, donc les
 *    dépendances partagées restent partagées, sans double instance.
 * 2. Sinon, premier échec : on pose un drapeau sessionStorage, on purge le
 *    service worker + le Cache Storage et on recharge. La purge est essentielle :
 *    un échec de chunk sur un build déployé signifie presque toujours qu'un SW
 *    périmé sert un index qui pointe des chunks absents du serveur. Un simple
 *    rechargement serait ré-intercepté par ce SW et échouerait à l'identique.
 * 3. Deuxième échec (après rechargement) : on relance l'erreur pour que
 *    l'ErrorBoundary le plus proche affiche un repli au lieu de boucler.
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
      const url = chunkUrlFromError(err);
      if (url) {
        await repairChunk(url);
        try {
          const bust = `${url}${url.includes('?') ? '&' : '?'}cb=${Date.now()}`;
          const mod = (await import(/* @vite-ignore */ bust)) as { default: T };
          if (mod?.default) {
            sessionStorage.removeItem(RELOAD_KEY);
            return mod;
          }
        } catch { /* on passe au palier suivant */ }
      }

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
