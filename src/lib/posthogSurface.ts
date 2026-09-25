/**
 * Surface PostHog — d'où vient CHAQUE événement. Porte unique, recalculée à
 * chaque envoi (`before_send`, src/lib/posthog.ts) : une même session web passe
 * de `web_app` à `console` en ouvrant /owner, et la propriété doit suivre.
 *
 *  - `admin`   : super admin (/admin), exclu de tout insight par défaut ;
 *  - `ios_pro` : app native Yuno Pro (eu.yunoapp.pro) ;
 *  - `ios_app` : app native Yuno (eu.yunoapp.app) ;
 *  - `console` : dashboards pro web (/owner, /manager, /organizer-app,
 *                /agency-app… — tout `isProPath`) ;
 *  - `pwa`     : yunoapp.eu installé sur l'écran d'accueil (standalone) ;
 *  - `web_app` : yunoapp.eu dans un navigateur.
 * La landing (`landing`) pose la sienne dans son propre repo.
 */
import { isNative, isProApp, isProPath } from '@/lib/native';
import { isStandaloneDisplay } from '@/lib/appStore';

export type Surface = 'landing' | 'web_app' | 'pwa' | 'ios_app' | 'ios_pro' | 'console' | 'admin';

export function surfaceFor(pathname: string, env: { native: boolean; proApp: boolean; standalone: boolean }): Surface {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/admin' || clean.startsWith('/admin/')) return 'admin';
  if (env.proApp) return 'ios_pro';
  if (env.native) return 'ios_app';
  if (isProPath(clean)) return 'console';
  if (env.standalone) return 'pwa';
  return 'web_app';
}

export function currentSurface(): Surface {
  let pathname = '/';
  try {
    pathname = window.location.pathname;
  } catch {
    // SSR / environnement sans window : surface web par défaut.
  }
  return surfaceFor(pathname, {
    native: isNative(),
    proApp: isProApp(),
    standalone: !isNative() && isStandaloneDisplay(),
  });
}

/**
 * Surface d'ACHAT transmise aux checkouts (corps de la requête, puis
 * métadonnées Stripe) pour que la capture serveur sache où la vente a eu
 * lieu. Seules les surfaces client ont du sens ici.
 */
export function purchaseSurface(): 'web_app' | 'pwa' | 'ios_app' | 'ios_pro' {
  const s = currentSurface();
  return s === 'ios_app' || s === 'ios_pro' || s === 'pwa' ? s : 'web_app';
}
