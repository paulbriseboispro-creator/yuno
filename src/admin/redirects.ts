/**
 * Les anciennes adresses des deux admins (Suite `/admin/...` et Admin CRM
 * `/admin/crm/...`) et leur nouvelle place. Favoris, liens des pages pas
 * encore réécrites, liens des alertes déjà émises (adminNotifLink) : tout
 * passe par ici.
 *
 * Module pur (testé, src/admin/__tests__/redirects.test.ts). Une règle par
 * ancienne adresse ; la requête (`?tab=…`) et l'ancre (`#coorg`) suivent.
 */

type Rule = readonly [RegExp, string];

// Ordre = priorité : le plus précis d'abord.
const RULES: readonly Rule[] = [
  // ── Admin CRM ──
  [/^\/admin\/crm\/login$/, '/admin/login'],
  [/^\/admin\/crm\/clients\/(.+)$/, '/admin/pros/crm/$1'],
  [/^\/admin\/crm\/clients$/, '/admin/pros/crm'],
  [/^\/admin\/crm\/sales$/, '/admin/pros/sales'],
  [/^\/admin\/crm\/invite$/, '/admin/pros/invite'],
  [/^\/admin\/crm\/demo$/, '/admin/pros/crm-demo'],
  [/^\/admin\/crm\/support$/, '/admin/pros/crm-support'],
  [/^\/admin\/crm\/acquisition$/, '/admin/pilot/crm-acquisition'],
  [/^\/admin\/crm\/product$/, '/admin/pilot/crm-product'],
  [/^\/admin\/crm\/money$/, '/admin/money/crm'],
  [/^\/admin\/crm\/platform\/plan\/(.+)$/, '/admin/system/connectors/plan/$1'],
  [/^\/admin\/crm\/platform$/, '/admin/system/connectors'],
  [/^\/admin\/crm\/legal$/, '/admin/legal'],
  [/^\/admin\/crm\/settings$/, '/admin/system/pricing'],
  [/^\/admin\/crm$/, '/admin/pilot/crm'],
  // Écran « bientôt » de l'Admin CRM (toute autre adresse sous /admin/crm).
  [/^\/admin\/crm\/.+$/, '/admin'],

  // ── Admin de la Suite : Pilotage ──
  [/^\/admin\/(growth|traffic)$/, '/admin/pilot/growth'],
  [/^\/admin\/signups$/, '/admin/pilot/signups'],
  [/^\/admin\/product$/, '/admin/pilot/product'],
  [/^\/admin\/ai$/, '/admin/pilot/ai'],
  // ── Argent ──
  [/^\/admin\/(revenue|analytics|accounting)$/, '/admin/money'],
  [/^\/admin\/orders$/, '/admin/money/orders'],
  [/^\/admin\/subscriptions$/, '/admin/money/subscriptions'],
  // ── Clients ──
  [/^\/admin\/(customers|segmentation)$/, '/admin/clients'],
  [/^\/admin\/events$/, '/admin/clients/events'],
  [/^\/admin\/(?:people|directory\/user)\/(.+)$/, '/admin/clients/people/$1'],
  [/^\/admin\/(people|directory)$/, '/admin/clients/people'],
  // ── Pros ──
  [/^\/admin\/(?:venues|directory\/venue)\/(.+)$/, '/admin/pros/venues/$1'],
  [/^\/admin\/venues$/, '/admin/pros/venues'],
  [/^\/admin\/organizers$/, '/admin/pros/organizers'],
  [/^\/admin\/(agencies|affiliates)$/, '/admin/pros/agencies'],
  [/^\/admin\/demo-access$/, '/admin/pros/demo'],
  [/^\/admin\/support$/, '/admin/pros/support'],
  // ── Communication ──
  [/^\/admin\/marketing(\/.*)?$/, '/admin/comms$1'],
  [/^\/admin\/emails$/, '/admin/comms'],
  [/^\/admin\/push$/, '/admin/comms/push'],
  [/^\/admin\/notifications$/, '/admin/comms/engine'],
  [/^\/admin\/links$/, '/admin/comms/links'],
  [/^\/admin\/waitlist$/, '/admin/comms/links?tab=waitlist'],
  // ── Aujourd'hui ──
  [/^\/admin\/alerts$/, '/admin/today/alerts'],
  [/^\/admin\/feedback$/, '/admin/today/feedback'],
  // ── Légal ──
  [/^\/admin\/audit$/, '/admin/legal/audit'],
  // ── Système ──
  [/^\/admin\/system\/crm\/plan\/(.+)$/, '/admin/system/connectors/plan/$1'],
  [/^\/admin\/system\/crm$/, '/admin/system/connectors'],
  [/^\/admin\/system\/settings$/, '/admin/system/pricing'],
  [/^\/admin\/drinks$/, '/admin/system/drinks'],
];

function clean(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/** Réunit la requête de la cible (`?tab=waitlist`) et celle d'origine ; l'origine gagne. */
function mergeSearch(targetSearch: string, search: string): string {
  const out = new URLSearchParams(targetSearch);
  new URLSearchParams(search).forEach((v, k) => out.set(k, v));
  const s = out.toString();
  return s ? `?${s}` : '';
}

/**
 * Nouvelle adresse d'une ancienne, requête et ancre comprises ; `null` quand
 * l'adresse n'est pas une ancienne adresse connue (elle est déjà bonne, ou inconnue).
 */
export function legacyAdminTarget(pathname: string, search = '', hash = ''): string | null {
  const p = clean(pathname);
  for (const [re, to] of RULES) {
    const m = re.exec(p);
    if (!m) continue;
    const replaced = p.replace(re, to);
    const q = replaced.indexOf('?');
    const path = q === -1 ? replaced : replaced.slice(0, q);
    const targetSearch = q === -1 ? '' : replaced.slice(q);
    return `${path}${mergeSearch(targetSearch, search)}${hash}`;
  }
  return null;
}

/**
 * Pour un lien déjà construit (`/admin/venues/x?tab=y#z`) : sa forme actuelle.
 * Un lien qui n'est pas une ancienne adresse revient tel quel.
 */
export function currentAdminHref(href: string): string {
  if (!href.startsWith('/admin')) return href;
  const hashAt = href.indexOf('#');
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  const noHash = hashAt === -1 ? href : href.slice(0, hashAt);
  const qAt = noHash.indexOf('?');
  const path = qAt === -1 ? noHash : noHash.slice(0, qAt);
  const search = qAt === -1 ? '' : noHash.slice(qAt);
  return legacyAdminTarget(path, search, hash) ?? href;
}

/**
 * Destination après la connexion (`?next=`) : une adresse de l'admin
 * seulement, jamais la connexion elle-même ni une adresse protocole-relative.
 */
export function safeAdminNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/admin') || raw.includes('//') || raw.includes('\\')) return '/admin';
  const path = raw.split(/[?#]/)[0].replace(/\/+$/, '');
  if (path === '/admin/login' || path === '/admin/crm/login') return '/admin';
  return raw;
}
