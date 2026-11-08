/**
 * Yuno CRM en mode « analyse seule » (pause de Yuno, décision de Paul du
 * 2026-11-08). Porte unique de la Console : à false, tout ce qui ENVOIE ou
 * prépare un envoi (e-mails, SMS, automatisations, scénarios, plans de soirée,
 * « Qui cibler », pages d'inscription, Instagram, Yunits, imports de fichiers,
 * parcours client, « Ce qui fait venir ») disparaît du menu et ses adresses
 * renvoient à l'accueil. Rien n'est supprimé du code.
 *
 * Miroir serveur : `platform_pause.marketing_paused` (migration 20261208100000),
 * qui refuse de toute façon tout envoi. Relancer = passer ceci à true ET
 * remettre marketing_paused à false.
 */
export const CRM_MARKETING_LIVE = false;

const MARKETING_PREFIXES = [
  '/crm/emails', '/crm/sms', '/crm/automations', '/crm/plans', '/crm/review',
  '/crm/signup-pages', '/crm/instagram', '/crm/yunits', '/crm/imports', '/crm/journey',
];

/** Une adresse de la Console qui mène à un envoi (ou à sa préparation). */
export function isMarketingPath(to: string): boolean {
  const p = to.split(/[?#]/)[0].replace(/\/+$/, '');
  if (/^\/crm\/nights\/[^/]+\/plan$/.test(p)) return true;
  return MARKETING_PREFIXES.some((x) => p === x || p.startsWith(x + '/'));
}

/** Pendant la pause : une adresse marketing ne s'affiche pas (lien, bouton, résultat). */
export function marketingHidden(to: string): boolean {
  return !CRM_MARKETING_LIVE && isMarketingPath(to);
}
