/**
 * Analytics v3 — l'adresse d'un écran (plan `docs/designs/ANALYTICS_REBUILD_PLAN.md`).
 *
 *   ?tab=overview|sales|sources|audience|door|promoters|campaigns|tonight
 *   &event=<uuid>            UNE soirée (sinon : une période)
 *   &period=7d|30d|90d|custom (&from=YYYY-MM-DD&to=YYYY-MM-DD)
 *   &compare=comparable|median5|yoy|previous|none
 *
 * Les anciennes adresses des quatre familles (`?tab=sales&view=…`) sont
 * traduites ici : un lien déjà émis dans une alerte ou un email ouvre
 * toujours une page qui répond.
 */

export type An3Tab = 'overview' | 'sales' | 'sources' | 'audience' | 'door' | 'promoters' | 'campaigns' | 'tonight';
export const AN3_TABS: readonly An3Tab[] = ['overview', 'sales', 'sources', 'audience', 'door', 'promoters', 'campaigns'];

export type An3Period = '7d' | '30d' | '90d' | 'custom';
export const AN3_PERIODS: readonly An3Period[] = ['7d', '30d', '90d'];
export const DEFAULT_AN3_PERIOD: An3Period = '30d';

export type An3Compare = 'comparable' | 'median5' | 'yoy' | 'previous' | 'none';
export const AN3_COMPARES: readonly An3Compare[] = ['comparable', 'median5', 'yoy', 'none'];
export const DEFAULT_AN3_COMPARE: An3Compare = 'comparable';

/** Anciens onglets (quatre familles) → onglet v3. */
const LEGACY: Record<string, An3Tab> = {
  sales: 'overview', global: 'overview', event: 'overview',
  traffic: 'sources', community: 'audience', purchase: 'sales', live: 'tonight',
};
const LEGACY_VIEWS: Record<string, An3Tab> = { partners: 'promoters', purchase: 'sales', page: 'sources' };

export interface An3Route {
  tab: An3Tab;
  eventId: string | null;
  period: An3Period;
  from: string | null;
  to: string | null;
  compare: An3Compare;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseAn3Route(params: URLSearchParams): An3Route {
  const rawTab = params.get('tab');
  const rawView = params.get('view');
  let tab: An3Tab = 'overview';
  if (rawView !== null) {
    // Ancienne adresse (famille + vue) : `sales` était une famille, pas l'onglet Ventes.
    tab = LEGACY_VIEWS[rawView] ?? (rawTab ? LEGACY[rawTab] : undefined) ?? 'overview';
  } else if (rawTab && (AN3_TABS as readonly string[]).includes(rawTab)) tab = rawTab as An3Tab;
  else if (rawTab === 'tonight') tab = 'tonight';
  else if (rawTab && LEGACY[rawTab]) tab = LEGACY[rawTab];
  const ev = params.get('event');
  const eventId = ev && UUID_RE.test(ev) ? ev.toLowerCase() : null;
  const rawPeriod = params.get('period');
  const from = params.get('from'), to = params.get('to');
  const custom = !!from && !!to && DATE_RE.test(from) && DATE_RE.test(to) && from <= to;
  const period: An3Period = custom && rawPeriod === 'custom' ? 'custom'
    : rawPeriod && (AN3_PERIODS as readonly string[]).includes(rawPeriod) ? (rawPeriod as An3Period) : DEFAULT_AN3_PERIOD;
  const rawCompare = params.get('compare');
  const compare: An3Compare = rawCompare && (['comparable', 'median5', 'yoy', 'previous', 'none'] as string[]).includes(rawCompare)
    ? (rawCompare as An3Compare) : DEFAULT_AN3_COMPARE;
  return { tab, eventId, period, from: period === 'custom' ? from : null, to: period === 'custom' ? to : null, compare };
}

/** Vrai quand l'URL porte un ancien onglet ou une valeur invalide : à réécrire en place. */
export function an3NeedsCanonicalUrl(params: URLSearchParams, route: An3Route): boolean {
  if (params.get('tab') !== route.tab) return true;
  if (params.has('view')) return true;
  const p = params.get('period');
  if (route.period !== 'custom' && p !== null && p !== route.period) return true;
  return false;
}

/** Écrit la route dans des paramètres existants (les autres paramètres sont gardés). */
export function writeAn3Route(prev: URLSearchParams, route: Partial<An3Route>): URLSearchParams {
  const p = new URLSearchParams(prev);
  p.delete('view');
  if (route.tab) p.set('tab', route.tab);
  if (route.period !== undefined) {
    p.set('period', route.period);
    if (route.period !== 'custom') { p.delete('from'); p.delete('to'); }
  }
  if (route.from !== undefined && route.from) p.set('from', route.from);
  if (route.to !== undefined && route.to) p.set('to', route.to);
  if (route.eventId !== undefined) { if (route.eventId) p.set('event', route.eventId); else p.delete('event'); }
  if (route.compare !== undefined) { if (route.compare === DEFAULT_AN3_COMPARE) p.delete('compare'); else p.set('compare', route.compare); }
  return p;
}

/** Fenêtre en instants ISO d'une période (fin = maintenant ; « custom » = jours pleins). */
export function an3Window(route: An3Route, now: Date = new Date()): { from: string; to: string } {
  if (route.period === 'custom' && route.from && route.to) {
    return { from: `${route.from}T00:00:00.000Z`, to: `${route.to}T23:59:59.999Z` };
  }
  const days = route.period === '7d' ? 7 : route.period === '90d' ? 90 : 30;
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: now.toISOString() };
}

/** Adresse d'un onglet v3 sous une base (`/owner/analytics`), en gardant soirée et période. */
export function an3Href(base: string, route: Partial<An3Route> & { tab: An3Tab }): string {
  const p = writeAn3Route(new URLSearchParams(), { period: DEFAULT_AN3_PERIOD, ...route });
  return `${base}?${p.toString()}`;
}
