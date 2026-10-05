/**
 * Deux produits, deux adresses (décision de Paul, 2026-10-04) :
 *   • yunoapp.eu      → Yuno Billetterie (app client, Consoles de la Suite) ;
 *   • crm.yunoapp.eu  → Yuno CRM (connexion `/login`, Console `/crm`, Admin CRM).
 *
 * crm.yunoapp.eu est servi par le Worker de la LANDING (repo Yuno-landing) : il
 * garde ses pages (`/`, `/fr`, `/es`, `/start`) et relaie à l'app les chemins
 * ci-dessous (`appPathOnCrmHost` dans son src/i18n/hosts.ts — même liste, à
 * tenir en miroir). Le même bundle tourne donc sur les deux origines, et cette
 * porte décide à chaque navigation si la page demandée vit ici ou chez l'autre
 * produit.
 *
 * Deux origines = deux localStorage = deux sessions. Le passage d'un site à
 * l'autre en crée une NEUVE (src/lib/productHandoff.ts), jamais une copie.
 */

export const CRM_HOST = 'crm.yunoapp.eu';
export const CRM_ORIGIN = `https://${CRM_HOST}`;
export const TICKETING_ORIGIN = 'https://yunoapp.eu';

/** Hôtes de production de la Billetterie : les seuls qui renvoient le CRM ailleurs. */
const TICKETING_HOSTS = new Set(['yunoapp.eu', 'www.yunoapp.eu']);

/**
 * Chemins de Yuno CRM : sur crm.yunoapp.eu seulement. `/open/crm` est l'ajout
 * du CRM à un compte Billetterie (OpenProduct), `/crm-admin` et `/admin/crm`
 * l'Admin CRM du super admin, `/j` les Pages d'inscription publiques des fans
 * (`/j/<slug>`, confirmation `/j/<slug>/ok`).
 */
export const CRM_PATH_PREFIXES = ['/crm', '/crm-admin', '/admin/crm', '/login', '/open/crm', '/j'] as const;

/**
 * Chemins communs aux deux produits : connexion et passage de session
 * (`/auth/handoff`), suite d'inscription, invitation d'équipe, 2FA, compte
 * suspendu. Ils restent sur le domaine où on les ouvre.
 */
export const SHARED_PATH_PREFIXES = [
  '/auth',
  '/get-started',
  '/accept-org-member',
  '/mfa-setup',
  '/mfa-disable-confirm',
  '/account-suspended',
] as const;

function cleanPath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

function under(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

export function isCrmPath(pathname: string): boolean {
  return under(cleanPath(pathname), CRM_PATH_PREFIXES);
}

export function isSharedProductPath(pathname: string): boolean {
  return under(cleanPath(pathname), SHARED_PATH_PREFIXES);
}

/** crm.yunoapp.eu ; `crm.localhost` se comporte pareil sous `vite dev`. */
export function isCrmHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === CRM_HOST || h === 'crm.localhost';
}

/** Vrai quand la page courante est servie par crm.yunoapp.eu. */
export function onCrmHost(): boolean {
  try {
    return isCrmHostname(window.location.hostname);
  } catch {
    return false;
  }
}

export interface HostLocation {
  hostname: string;
  port: string;
  protocol: string;
  pathname: string;
  search: string;
  hash: string;
}

export type HostDecision =
  /** La page vit ici. */
  | { kind: 'stay' }
  /** Même domaine, autre chemin (remplace l'entrée d'historique). */
  | { kind: 'local'; to: string }
  /** Page de l'autre produit : `origin` + `path` (chemin + requête + ancre). */
  | { kind: 'cross'; origin: string; path: string };

/** La Billetterie vue depuis le CRM : yunoapp.eu en prod, localhost en dev. */
function ticketingOriginFrom(loc: HostLocation): string {
  if (loc.hostname.toLowerCase() === 'crm.localhost') {
    return `${loc.protocol}//localhost${loc.port ? `:${loc.port}` : ''}`;
  }
  return TICKETING_ORIGIN;
}

/**
 * Où doit vivre la page demandée. `exempt` (aperçu démo, accès assisté) laisse
 * tout sur place : ces sessions sont attachées à leur onglet et ne passent pas
 * d'un domaine à l'autre (l'edge refuse de leur créer une session neuve).
 * localhost, les aperçus Cloudflare et l'app native ne sont jamais renvoyés.
 */
export function productHostDecision(loc: HostLocation, opts: { exempt?: boolean } = {}): HostDecision {
  if (opts.exempt) return { kind: 'stay' };
  const path = cleanPath(loc.pathname);
  const host = loc.hostname.toLowerCase();

  if (isCrmHostname(host)) {
    // En prod, « / » est la landing CRM et n'arrive jamais ici ; sous vite dev, si.
    if (path === '/') return { kind: 'local', to: `/crm${loc.search}` };
    // La connexion du CRM a son écran : `/auth` (liens hérités, sortie de
    // session, 401) y mène avec sa requête (redirect=…).
    if (path === '/auth') return { kind: 'local', to: `/login${loc.search}${loc.hash}` };
    if (isCrmPath(path) || isSharedProductPath(path)) return { kind: 'stay' };
    return { kind: 'cross', origin: ticketingOriginFrom(loc), path: `${loc.pathname}${loc.search}${loc.hash}` };
  }

  if (TICKETING_HOSTS.has(host) && isCrmPath(path)) {
    return { kind: 'cross', origin: CRM_ORIGIN, path: `${loc.pathname}${loc.search}${loc.hash}` };
  }
  return { kind: 'stay' };
}

/** Page de connexion du domaine courant (CRM : `/login`, Billetterie : `/auth`). */
export function loginPathHere(redirect?: string): string {
  const base = onCrmHost() ? '/login' : '/auth';
  return redirect ? `${base}?redirect=${encodeURIComponent(redirect)}` : base;
}
