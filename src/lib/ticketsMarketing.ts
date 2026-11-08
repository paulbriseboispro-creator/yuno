/**
 * Yuno Tickets en mode MVP (pause de Yuno, décision de Paul du 2026-11-08) :
 * vendre des billets et des guest lists, rien d'autre. À false, les Consoles
 * Club, Organisateur et Manager retirent de leurs menus tout ce qui envoie ou
 * pousse (e-mails, SMS, push, publicités Meta, intégrations), les programmes
 * promoteurs / agences, les DJ, la rareté (FOMO), la fidélité et l'import de
 * fichiers ; leurs adresses renvoient à l'accueil. Rien n'est supprimé du code.
 *
 * Miroir serveur : `platform_pause.marketing_paused` (migration 20261208100000),
 * qui refuse de toute façon tout envoi marketing. Relancer = passer ceci à true
 * ET remettre marketing_paused à false. Le CRM a sa propre porte
 * (`src/crm/lib/marketing.ts`).
 */
export const TICKETS_MARKETING_LIVE = false;

const CONSOLE_BASES = ['/owner', '/organizer-app', '/manager'];

const MARKETING_SEGMENTS = [
  'campaigns', 'sms-campaigns', 'sms', 'push', 'ads', 'integrations',
  'promoters', 'agencies', 'djs', 'book-dj', 'scarcity', 'loyalty',
  'clients/imports',
];

/** Une adresse de Console qui mène à un envoi, à la pub, aux promoteurs ou aux DJ. */
export function isTicketsMarketingPath(path: string | undefined): boolean {
  if (!path) return false;
  const p = path.split('#')[0];
  for (const base of CONSOLE_BASES) {
    if (!p.startsWith(base + '/')) continue;
    const rest = p.slice(base.length + 1);
    return MARKETING_SEGMENTS.some((s) => rest === s || rest.startsWith(s + '/') || rest.startsWith(s + '?'));
  }
  return false;
}

/** Pendant la pause : cette adresse ne s'affiche pas et n'ouvre rien. */
export function ticketsMarketingHidden(path: string | undefined): boolean {
  return !TICKETS_MARKETING_LIVE && isTicketsMarketingPath(path);
}

type NavLike = { path?: string; subItems?: NavLike[] };
type GroupLike<I extends NavLike> = { items: I[] };

/** Retire des menus les entrées marketing ; un groupe vidé disparaît. */
export function pruneTicketsMarketingNav<I extends NavLike, G extends GroupLike<I>>(groups: G[]): G[] {
  if (TICKETS_MARKETING_LIVE) return groups;
  return groups
    .map((g) => ({
      ...g,
      items: g.items
        .filter((i) => !isTicketsMarketingPath(i.path))
        .map((i) => (i.subItems ? { ...i, subItems: i.subItems.filter((s) => !isTicketsMarketingPath(s.path)) } : i)),
    }))
    .filter((g) => g.items.length > 0);
}
