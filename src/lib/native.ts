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

/**
 * Espace DJ (le dashboard), par opposition aux profils publics `/dj/:slug`.
 *
 * Sert deux gardes de sens opposé, d'où le prédicat exporté plutôt qu'un
 * préfixe recopié de chaque côté :
 *   • NativeProGate (app B2C) : ces paths partent sur le web ;
 *   • ProAppGate (app Pro) : ce sont les SEULS paths `/dj` admis — un profil
 *     public est une surface B2C, elle n'a rien à faire dans l'app Pro.
 */
export function isDJAppPath(pathname: string): boolean {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return DJ_DASHBOARD_PATHS.has(clean);
}

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
 * Origine PUBLIQUE de tout lien qui SORT du téléphone : feuille de partage,
 * QR code scanné à la porte, lien posé dans un email, fichier .ics.
 *
 * Jamais `window.location.origin` : dans la WebView Capacitor il vaut
 * `capacitor://localhost`, un schéma que personne d'autre que l'app ne sait
 * ouvrir. Un lien partagé depuis l'app arrivait donc mort chez le destinataire.
 */
export const PUBLIC_BASE_URL = (
  (import.meta.env.VITE_APP_BASE_URL as string | undefined) || 'https://yunoapp.eu'
).replace(/\/+$/, '');

/**
 * Rend une URL publiquement ouvrable. Inverse de `toAppPath`.
 *
 *  - sans argument     → l'URL courante, réécrite sur le domaine public ;
 *  - path (`/event/1`) → préfixé du domaine public ;
 *  - URL de la WebView (`capacitor://localhost/...`) → même chemin sur le domaine ;
 *  - toute autre URL absolue → rendue telle quelle (un lien externe reste externe,
 *    et le dev web garde son propre origin).
 */
export function publicUrl(pathOrUrl?: string | null): string {
  const raw = pathOrUrl ?? (typeof window !== 'undefined' ? window.location.href : '');
  if (!raw) return PUBLIC_BASE_URL;
  if (raw.startsWith('/')) return PUBLIC_BASE_URL + raw;
  try {
    const u = new URL(raw);
    // `capacitor:`/`ionic:` sont toujours des origines de WebView. `localhost`
    // en http n'est réécrit qu'en natif : sur le web c'est le serveur de dev.
    const isWebViewOrigin =
      u.protocol === 'capacitor:' ||
      u.protocol === 'ionic:' ||
      (isNative() && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
    return isWebViewOrigin ? PUBLIC_BASE_URL + u.pathname + u.search + u.hash : raw;
  } catch {
    return `${PUBLIC_BASE_URL}/${raw.replace(/^\/+/, '')}`;
  }
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

/**
 * Schéma d'URL de l'app « Yuno Pro ». Compilé dans le binaire
 * (pro/ios/App/App/Info.plist → CFBundleURLTypes), donc joignable depuis
 * Safari, depuis l'app client, et depuis n'importe quel email — sans rien
 * redéployer côté natif.
 *
 * Pourquoi il existe : le fichier d'association de domaines
 * (public/.well-known/apple-app-site-association) ne déclare que l'app CLIENT,
 * et l'app Pro n'a pas encore l'entitlement Associated Domains. Un Universal
 * Link https://yunoapp.eu/... ouvre donc TOUJOURS l'app client — y compris une
 * invitation de videur, qui n'a rien à y faire. Tant que l'app Pro n'est pas
 * rebâtie avec l'entitlement, ce schéma est le seul passage direct.
 */
export function proAppUrl(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `yunopro://open?path=${encodeURIComponent(clean)}`;
}

/**
 * Bascule vers l'app Yuno Pro sur un path donné (NativeBridge écoute
 * `appUrlOpen` et navigue). Sans effet visible si l'app n'est pas installée :
 * iOS ne rend aucune erreur exploitable sur un schéma inconnu, d'où l'appel
 * toujours posé derrière un geste explicite — jamais une redirection
 * automatique, qui laisserait une page morte à qui n'a pas l'app.
 */
export function openProApp(path: string): void {
  window.location.href = proAppUrl(path);
}

/**
 * Vrai quand proposer « Ouvrir dans Yuno Pro » a un sens : sur un téléphone,
 * hors de l'app Pro elle-même. Couvre les deux cas vécus — le lien ouvert dans
 * Safari mobile, et le lien capté par l'app CLIENT via Universal Link.
 */
export function canHandOffToProApp(): boolean {
  if (isProApp()) return false;
  if (isNative()) return true;
  try {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}
