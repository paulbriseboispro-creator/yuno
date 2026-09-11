/**
 * Attribution email → ce que la campagne a VRAIMENT produit.
 *
 * `get_email_campaign_attribution` ne rendait que `revenue` + `buyers`. Un CA
 * seul ne dit pas ce qui a été réservé : huit billets, une table, ou trente
 * inscriptions en liste invités (qui ne rapportent aucun euro et restaient donc
 * invisibles). La RPC rend maintenant la ventilation par pilier ; ce module est
 * la seule lecture de cette forme, pour que le rapport, l'écran d'envoi et tout
 * futur écran racontent la même chose avec les mêmes mots.
 */

export type AttributionPillars = {
  tickets?: { orders: number; units: number; revenue: number } | null;
  tables?: { orders: number; guests: number; revenue: number } | null;
  guestlist?: { entries: number; people: number } | null;
  drinks?: { orders: number; revenue: number } | null;
};

export type CampaignAttribution = { id: string; revenue: number; buyers: number } & AttributionPillars;

export type PillarKey = 'tickets' | 'tables' | 'guestlist' | 'drinks';

export type PillarLine = {
  key: PillarKey;
  /** Le chiffre qui compte pour ce pilier (billets, tables, inscriptions…). */
  count: number;
  /** « 8 billets » — le chiffre avec son unité, déjà traduit. */
  value: string;
  /** Second plan : « 5 commandes », « 6 convives »… absent s'il n'apprend rien. */
  sub?: string;
  /** Net encaissé, ou null pour la liste invités : une entrée offerte n'est pas 0 €. */
  revenue: number | null;
};

type T = (key: string) => string;

const n0 = (n: number) => Math.max(0, Math.round(Number(n) || 0));

/** « 1 billet » / « 8 billets » — le dictionnaire maison n'a pas de pluriel. */
function unit(t: T, n: number, key: string): string {
  return `${n.toLocaleString()} ${t(`em.attr.u.${key}.${n === 1 ? 'one' : 'other'}`)}`;
}

/** Les lignes à afficher, dans l'ordre des piliers. Un pilier muet sort. */
export function pillarLines(attr: AttributionPillars | null | undefined, t: T): PillarLine[] {
  if (!attr) return [];
  const lines: PillarLine[] = [];

  const tk = attr.tickets;
  if (tk && n0(tk.orders) > 0) {
    const units = n0(tk.units) || n0(tk.orders);
    const orders = n0(tk.orders);
    lines.push({
      key: 'tickets',
      count: units,
      value: unit(t, units, 'tickets'),
      sub: orders !== units ? unit(t, orders, 'orders') : undefined,
      revenue: Number(tk.revenue) || 0,
    });
  }

  const tb = attr.tables;
  if (tb && n0(tb.orders) > 0) {
    const guests = n0(tb.guests);
    lines.push({
      key: 'tables',
      count: n0(tb.orders),
      value: unit(t, n0(tb.orders), 'tables'),
      sub: guests > 0 ? unit(t, guests, 'guests') : undefined,
      revenue: Number(tb.revenue) || 0,
    });
  }

  const gl = attr.guestlist;
  if (gl && n0(gl.entries) > 0) {
    const entries = n0(gl.entries);
    const people = n0(gl.people);
    lines.push({
      key: 'guestlist',
      count: entries,
      value: unit(t, entries, 'entries'),
      sub: people > 0 && people !== entries ? unit(t, people, 'people') : undefined,
      revenue: null,
    });
  }

  const dr = attr.drinks;
  if (dr && n0(dr.orders) > 0) {
    lines.push({
      key: 'drinks',
      count: n0(dr.orders),
      value: unit(t, n0(dr.orders), 'orders'),
      revenue: Number(dr.revenue) || 0,
    });
  }

  return lines;
}

/** Une seule ligne : « 8 billets · 1 table VIP · 12 inscriptions ». */
export function pillarSummary(attr: AttributionPillars | null | undefined, t: T): string {
  if (!attr) return '';
  const parts: string[] = [];
  const tk = attr.tickets;
  if (tk && n0(tk.orders) > 0) parts.push(unit(t, n0(tk.units) || n0(tk.orders), 'tickets'));
  const tb = attr.tables;
  if (tb && n0(tb.orders) > 0) parts.push(unit(t, n0(tb.orders), 'vipTables'));
  const gl = attr.guestlist;
  if (gl && n0(gl.entries) > 0) parts.push(unit(t, n0(gl.entries), 'entries'));
  const dr = attr.drinks;
  if (dr && n0(dr.orders) > 0) parts.push(unit(t, n0(dr.orders), 'barOrders'));
  return parts.join(' · ');
}

/** Vrai dès qu'un pilier a bougé — sert à décider d'afficher la carte. */
export function hasPillarActivity(attr: AttributionPillars | null | undefined): boolean {
  if (!attr) return false;
  return n0(attr.tickets?.orders ?? 0) > 0
    || n0(attr.tables?.orders ?? 0) > 0
    || n0(attr.guestlist?.entries ?? 0) > 0
    || n0(attr.drinks?.orders ?? 0) > 0;
}
