/**
 * Un compte Yuno CRM a SA Console (`/crm`). Quand il ouvre une page de la
 * Suite qui a son équivalent dans la Console CRM, il y est envoyé ; les pages
 * pas encore reconstruites (Publicité, Assistants IA, Accès assisté…) restent
 * servies par la Suite tant que la Console n'a pas la sienne.
 */
type Base = '/owner' | '/organizer-app';

export function crmConsoleTarget(pathname: string, base: Base): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === base || path === `${base}/dashboard`) return '/crm';
  const rest = path.startsWith(`${base}/`) ? path.slice(base.length) : null;
  if (rest === null) return null;
  const night = /^\/crm\/nights\/([^/]+)$/.exec(rest);
  if (night) return `/crm/nights/${night[1]}`;
  if (rest === '/crm/nights') return '/crm/nights';
  if (rest === '/crm/audience') return '/crm/clients';
  if (rest === '/crm/billing') return '/crm/account/billing';
  if (rest === '/campaigns/contacts') return '/crm/clients';
  if (rest === '/campaigns/new') return '/crm/emails/templates';
  if (rest === '/campaigns') return '/crm/emails/campaigns';
  const camp = /^\/campaigns\/([0-9a-f-]{36})\/(report|edit)$/.exec(rest);
  if (camp) return camp[2] === 'report' ? `/crm/emails/results/${camp[1]}` : `/crm/emails/studio/${camp[1]}`;
  if (rest === '/integrations') return '/crm/connectors';
  return null;
}
