/**
 * « Cette personne utilise Yuno CRM » : un repère technique posé par la
 * Console CRM sur le domaine parent (`yunoapp.eu`), donc lisible depuis
 * yunoapp.eu ET crm.yunoapp.eu (2026-10-19).
 *
 * Pourquoi : les deux produits ont deux origines, donc deux sessions. Quand une
 * IA (Claude, ChatGPT…) demande l'accès, le serveur OAuth du MCP envoie la
 * personne sur yunoapp.eu/connect-ai ; un client CRM n'y a pas de session et
 * tombait sur la connexion de la Billetterie. Avec ce repère, la fenêtre
 * d'autorisation passe sur crm.yunoapp.eu, où il est déjà connecté (DA du CRM).
 * Le Worker lit le même repère pour qu'une adresse `/mcp` ouverte dans un
 * navigateur mène au guide de la Console CRM (worker/mcp/protocol.ts).
 *
 * Aucune donnée personnelle : la seule valeur possible est `crm`. Cookie
 * strictement nécessaire (politique cookies, liste des cookies).
 */
export const PRODUCT_HINT_COOKIE = 'yuno_product';
const ONE_YEAR = 365 * 24 * 3600;

/** Le cookie à poser depuis cet hôte, ou null hors des domaines de production. */
export function productHintCookie(hostname: string): string | null {
  const h = hostname.toLowerCase();
  if (h !== 'yunoapp.eu' && !h.endsWith('.yunoapp.eu')) return null;
  return `${PRODUCT_HINT_COOKIE}=crm; Domain=yunoapp.eu; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax; Secure`;
}

/** Vrai si l'en-tête ou `document.cookie` porte le repère CRM. */
export function hasCrmProductHint(cookie: string | null | undefined): boolean {
  return (cookie ?? '').split(';').some((part) => part.trim() === `${PRODUCT_HINT_COOKIE}=crm`);
}

/** Console CRM : retenir le produit (sans effet hors de yunoapp.eu). */
export function rememberCrmProduct(): void {
  try {
    const c = productHintCookie(window.location.hostname);
    if (c && !hasCrmProductHint(document.cookie)) document.cookie = c;
  } catch {
    /* cookies bloqués : la personne se connectera simplement sur place */
  }
}

export function crmProductHinted(): boolean {
  try {
    return hasCrmProductHint(document.cookie);
  } catch {
    return false;
  }
}
