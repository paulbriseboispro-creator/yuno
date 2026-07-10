import { Capacitor } from '@capacitor/core';

/**
 * Façade plateforme — point d'entrée unique pour détecter l'app native
 * (Capacitor iOS) et gérer les sorties vers le navigateur système.
 * L'app native est B2C uniquement : les surfaces pro restent sur le web.
 */

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * App « Yuno Pro » (staff + promoteurs) : même bundle web que l'app B2C, mais
 * la coquille native pro (pro/capacitor.config.ts) ajoute 'YunoPro' au
 * User-Agent — détection SYNCHRONE dès l'init des modules, sans double build.
 */
export function isProApp(): boolean {
  try {
    return Capacitor.isNativePlatform() && navigator.userAgent.includes('YunoPro');
  } catch {
    return false;
  }
}

/** Préfixes de routes réservées aux comptes pro/staff (gatées en natif). */
const PRO_PATH_PREFIXES = [
  '/owner',
  '/admin',
  '/organizer-app',
  '/agency-app',
  '/affiliate',
  '/manager',
  '/barman',
  '/bouncer',
  '/cloakroom',
  '/vip-host',
  '/promoter',
];

// Le dashboard DJ partage /dj avec les pages publiques /dj/:slug — on ne gate
// que les paths exacts du dashboard, jamais les profils publics.
const DJ_DASHBOARD_PATHS = new Set([
  '/dj', '/dj/planning', '/dj/analytics', '/dj/audience', '/dj/payments',
  '/dj/bookings', '/dj/notifications', '/dj/team', '/dj/help', '/dj/profile',
  '/dj/onboarding',
]);

export function isProPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (DJ_DASHBOARD_PATHS.has(clean)) return true;
  return PRO_PATH_PREFIXES.some(
    (prefix) => clean === prefix || clean.startsWith(prefix + '/'),
  );
}

/**
 * Convertit une URL Yuno en path interne navigable par le Router.
 * Accepte les paths relatifs ('/my-orders') et les URLs absolues du domaine
 * ('https://yunoapp.eu/...'). Hors domaine Yuno → null (lien externe).
 */
export function toAppPath(url: string | undefined | null): string | null {
  if (!url) return null;
  if (url.startsWith('/')) return url;
  try {
    const u = new URL(url);
    if (/(^|\.)yunoapp\.eu$/.test(u.hostname) || u.hostname === 'localhost') {
      return u.pathname + u.search + u.hash;
    }
  } catch {
    // URL invalide : ignorer.
  }
  return null;
}

/**
 * Ouvre une URL hors du bundle local : navigateur in-app (SFSafariViewController)
 * en natif, nouvel onglet sur le web. Fire-and-forget.
 */
export function openExternal(url: string): void {
  if (isNative()) {
    import('@capacitor/browser')
      .then(({ Browser }) => Browser.open({ url }))
      .catch(() => { window.open(url, '_blank'); });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/** Marqueur d'un checkout Stripe en cours dans SafariVC (natif uniquement). */
export const PENDING_CHECKOUT_KEY = 'yuno-pending-checkout';

/**
 * Lance un checkout Stripe hébergé. Web : redirection pleine page (comportement
 * historique). Natif : SFSafariViewController + marqueur de checkout en cours —
 * le retour se fait par deep link yuno:// depuis la page verify (?native=1),
 * avec le toast de NativeBridge en filet si l'utilisateur ferme à la main.
 */
export function launchCheckout(url: string): void {
  if (isNative()) {
    try { sessionStorage.setItem(PENDING_CHECKOUT_KEY, String(Date.now())); } catch { /* privé */ }
    import('@capacitor/browser')
      .then(({ Browser }) => Browser.open({ url }))
      .catch(() => { window.location.href = url; });
  } else {
    window.location.href = url;
  }
}
