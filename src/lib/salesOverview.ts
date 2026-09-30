/**
 * Ventes › Vue d'ensemble et piliers — mise en forme des chiffres de
 * `get_sales_overview` (migration `20260925130000`). Aucun montant n'est
 * recalculé ici : la RPC porte les formules (fees.ts), ce module ne fait que
 * choisir les quatre chiffres d'un pilier, leurs ratios (`metrics.ts`) et la
 * série du graphique. Testé dans `__tests__/salesOverview.test.ts`.
 */
import { basket, fillPct, spendPerHead, attendancePct, type MetricId } from './metrics';

export type SalesPeriod = 'last' | 'last4' | 'month' | 'year' | 'all';
export const SALES_PERIODS: readonly SalesPeriod[] = ['last', 'last4', 'month', 'year', 'all'];

export type SalesPillar = 'all' | 'tickets' | 'tables' | 'bar' | 'guestList';

export interface SalesTotals {
  nights: number;
  revenue?: number; rev_tickets?: number; rev_tables?: number; rev_bar?: number; stripe?: number;
  entries: number; ticket_entries: number; customers: number;
  tickets: number; ticket_orders: number; ticket_cap: number; tickets_with_cap: number;
  tables: number; table_guests: number; tables_arrived: number;
  bar_orders: number;
  gl_registered: number; gl_entered: number;
  /**
   * Dénominateurs justes (migration 20260925187000) : dépense par tête sur les
   * soirées dont on voit l'argent ET où la porte a scanné ; présence sur les
   * soirées où la porte a scanné ; prix moyens sur les soirées dont on voit
   * l'argent. Absents d'une ligne de soirée : la soirée est son propre dénominateur.
   */
  money_nights?: number;
  spend_revenue?: number; spend_entries?: number;
  presence_entries?: number; presence_expected?: number;
  gl_presence_registered?: number; gl_presence_entered?: number;
  tables_presence_booked?: number; tables_presence_arrived?: number;
  money_tickets?: number; money_tables?: number; money_bar_orders?: number;
}

export interface SalesNight {
  id: string; title: string; start_at: string; poster: string | null;
  revenue: number | null; rev_tickets: number | null; rev_tables: number | null; rev_bar: number | null;
  entries: number; customers: number;
  tickets: number; ticket_cap: number | null; tables: number; table_guests: number; tables_arrived: number;
  bar_orders: number; gl_registered: number; gl_entered: number;
}

export interface SalesOverview {
  ok: boolean;
  reason?: string;
  money: boolean;
  has_bar: boolean;
  period: SalesPeriod;
  generated_at: string;
  current: SalesTotals;
  previous: SalesTotals | null;
  nights: SalesNight[];
  rounds: { name: string; sold: number; amount: number | null }[];
  packs: { name: string; booked: number; guests: number; amount: number | null }[];
  products: { name: string; qty: number; amount: number | null }[];
  bar_service_min: number | null;
  holders: { name: string; kind: string; registered: number; entered: number }[];
  upcoming: { nights: number; amount: number | null } | null;
  /** « À retenir » (`get_sales_takeaways`, migration 20260925170000) : 0 à 3 constats. */
  takeaways?: SalesTakeaway[];
}

/** Un constat calculé serveur, avec son seuil ; texte `so.tk.<key>`, `pillar` = la preuve. */
export interface SalesTakeaway {
  key: 'gl_no_show' | 'presence_low' | 'spend_up' | 'spend_down' | 'mix_shift' | 'day_of' | string;
  tone: 'good' | 'bad' | 'info';
  pillar: SalesPillar;
  params: Record<string, string | number | null>;
}

export type KpiFormat = 'eur' | 'n' | 'pct' | 'min';

/** Clé d'une valeur lisible sur une soirée ET sur une période. */
export type SalesMetricKey =
  | 'revenue' | 'rev_tickets' | 'rev_tables' | 'rev_bar'
  | 'entries' | 'customers' | 'spendPerHead'
  | 'tickets' | 'ticketPrice' | 'fill'
  | 'tables' | 'table_guests' | 'tableSpend' | 'tablePresence'
  | 'bar_orders' | 'barBasket' | 'barService'
  | 'gl_registered' | 'gl_entered' | 'glPresence' | 'glPerNight';

export interface SalesKpi {
  key: SalesMetricKey;
  /** Chiffre du dictionnaire, pour le libellé `m.*` et l'ⓘ `gl.*` — sinon libellé propre `so.k.*`. */
  metric?: MetricId;
  labelKey: string;
  hintKey: string;
  format: KpiFormat;
  value: number | null;
  previous: number | null;
  /** Vrai quand « moins » est la bonne nouvelle (temps de service). */
  lowerIsBetter?: boolean;
  money?: boolean;
}

type Row = Partial<SalesTotals> & Partial<SalesNight>;

/** Valeur d'une clé sur une période OU une soirée (mêmes champs). */
export function metricValue(row: Row | null | undefined, key: SalesMetricKey, serviceMin?: number | null): number | null {
  if (!row) return null;
  const v = (k: keyof Row) => {
    const x = row[k];
    return typeof x === 'number' ? x : null;
  };
  // Aucune soirée dont on voit l'argent (le club n'a fait qu'accueillir) : le
  // CA n'est pas « 0 € », il n'est pas à nous.
  const noMoney = row.money_nights === 0;
  // Dénominateur de période s'il existe, sinon le champ brut (ligne de soirée).
  const den = (k: keyof Row, fallback: keyof Row) => (typeof row[k] === 'number' ? (row[k] as number) : v(fallback));
  switch (key) {
    case 'revenue': case 'rev_tickets': case 'rev_tables': case 'rev_bar':
      return noMoney ? null : v(key);
    case 'entries': case 'customers': case 'tickets': case 'tables': case 'table_guests':
    case 'bar_orders': case 'gl_registered': case 'gl_entered':
      return v(key);
    case 'spendPerHead': {
      if (noMoney) return null;
      const r = den('spend_revenue', 'revenue'); const e = den('spend_entries', 'entries');
      return r === null || e === null ? null : spendPerHead(r, e);
    }
    case 'ticketPrice': {
      if (noMoney) return null;
      const r = v('rev_tickets'); const n = den('money_tickets', 'tickets');
      return r === null || n === null ? null : basket(r, n);
    }
    case 'fill': {
      // Période : billets des soirées qui ont une capacité / somme des capacités.
      if (typeof row.tickets_with_cap === 'number') return fillPct(row.tickets_with_cap, row.ticket_cap ?? 0);
      return fillPct(v('tickets') ?? 0, row.ticket_cap ?? 0);
    }
    case 'tableSpend': {
      if (noMoney) return null;
      const r = v('rev_tables'); const n = den('money_tables', 'tables');
      return r === null || n === null ? null : basket(r, n);
    }
    case 'tablePresence':
      return attendancePct(den('tables_presence_arrived', 'tables_arrived') ?? 0, den('tables_presence_booked', 'tables') ?? 0);
    case 'barBasket': {
      if (noMoney) return null;
      const r = v('rev_bar'); const n = den('money_bar_orders', 'bar_orders');
      return r === null || n === null ? null : basket(r, n);
    }
    case 'barService': return serviceMin ?? null;
    case 'glPresence':
      return attendancePct(den('gl_presence_entered', 'gl_entered') ?? 0, den('gl_presence_registered', 'gl_registered') ?? 0);
    case 'glPerNight': {
      const n = v('nights');
      return n ? (v('gl_registered') ?? 0) / n : null;
    }
  }
}

const K = (key: SalesMetricKey, format: KpiFormat, labelKey: string, hintKey: string, extra: Partial<SalesKpi> = {}) =>
  ({ key, format, labelKey, hintKey, ...extra });

const PILLAR_KPIS: Record<SalesPillar, ReturnType<typeof K>[]> = {
  all: [
    K('revenue', 'eur', 'm.revenue', 'gl.revenue', { metric: 'revenue', money: true }),
    K('entries', 'n', 'm.entries', 'gl.entries', { metric: 'entries' }),
    K('spendPerHead', 'eur', 'm.spendPerHead', 'gl.spendPerHead', { metric: 'spendPerHead', money: true }),
    K('customers', 'n', 'm.customers', 'gl.customers', { metric: 'customers' }),
  ],
  tickets: [
    K('tickets', 'n', 'm.tickets', 'gl.tickets', { metric: 'tickets' }),
    K('rev_tickets', 'eur', 'so.k.revTickets', 'gl.revenue', { money: true }),
    K('ticketPrice', 'eur', 'so.k.ticketPrice', 'so.h.ticketPrice', { money: true }),
    K('fill', 'pct', 'm.fill', 'gl.fill', { metric: 'fill' }),
  ],
  tables: [
    K('tables', 'n', 'm.tables', 'gl.tables', { metric: 'tables' }),
    K('rev_tables', 'eur', 'so.k.revTables', 'gl.revenue', { money: true }),
    K('tableSpend', 'eur', 'so.k.tableSpend', 'so.h.tableSpend', { money: true }),
    K('tablePresence', 'pct', 'so.k.tablePresence', 'so.h.tablePresence'),
  ],
  bar: [
    K('rev_bar', 'eur', 'so.k.revBar', 'gl.revenue', { money: true }),
    K('bar_orders', 'n', 'so.k.barOrders', 'so.h.barOrders'),
    K('barBasket', 'eur', 'so.k.barBasket', 'gl.basket', { money: true }),
    K('barService', 'min', 'so.k.barService', 'so.h.barService', { lowerIsBetter: true }),
  ],
  guestList: [
    K('gl_registered', 'n', 'm.guestList', 'gl.guestList', { metric: 'guestList' }),
    K('gl_entered', 'n', 'm.entries', 'so.h.glEntered'),
    K('glPresence', 'pct', 'm.attendance', 'so.h.glPresence'),
    K('glPerNight', 'n', 'so.k.glPerNight', 'so.h.glPerNight'),
  ],
};

/** Remplaçants des tuiles d'argent pour qui ne voit pas le CA (éditeur d'équipe). */
const NO_MONEY_FALLBACK: Record<SalesPillar, ReturnType<typeof K>[]> = {
  all: [K('tickets', 'n', 'm.tickets', 'gl.tickets'), K('tables', 'n', 'm.tables', 'gl.tables')],
  tickets: [K('ticket_entries' as SalesMetricKey, 'n', 'm.entries', 'gl.entries')],
  tables: [K('table_guests' as SalesMetricKey, 'n', 'so.k.tableGuests', 'so.h.tableGuests')],
  bar: [],
  guestList: [],
};

/** Les quatre chiffres d'un pilier (moins s'il manque l'argent et pas de remplaçant). */
export function pillarKpis(data: SalesOverview, pillar: SalesPillar): SalesKpi[] {
  let defs = PILLAR_KPIS[pillar];
  if (!data.money) {
    const kept = defs.filter((d) => !d.money);
    const extra = NO_MONEY_FALLBACK[pillar].filter((f) => !kept.some((k) => k.key === f.key));
    defs = [...kept, ...extra].slice(0, 4);
  }
  return defs.map((d) => {
    const raw = (row: Row | null) => {
      if (!row) return null;
      if ((d.key as string) === 'ticket_entries' || (d.key as string) === 'table_guests') {
        const x = (row as Record<string, unknown>)[d.key];
        return typeof x === 'number' ? x : null;
      }
      return metricValue(row, d.key, d.key === 'barService' && row === data.current ? data.bar_service_min : null);
    };
    return {
      ...d,
      value: raw(data.current),
      // Pas de comparaison pour le temps de service (la RPC ne le rend que sur la période).
      previous: d.key === 'barService' ? null : raw(data.previous),
    } as SalesKpi;
  });
}

/** Piliers présents dans la portée : l'organisateur n'a pas de bar. */
export function pillarsFor(data: Pick<SalesOverview, 'has_bar'>): SalesPillar[] {
  return data.has_bar ? ['all', 'tickets', 'tables', 'bar', 'guestList'] : ['all', 'tickets', 'tables', 'guestList'];
}

/** A-t-on quoi que ce soit à montrer pour ce pilier sur la période ? */
export function pillarHasActivity(t: SalesTotals | null | undefined, pillar: SalesPillar): boolean {
  if (!t) return false;
  switch (pillar) {
    case 'all': return (t.revenue ?? 0) > 0 || t.entries > 0 || t.customers > 0 || t.tickets > 0 || t.gl_registered > 0 || t.tables > 0;
    case 'tickets': return t.tickets > 0;
    case 'tables': return t.tables > 0;
    case 'bar': return t.bar_orders > 0;
    case 'guestList': return t.gl_registered > 0;
  }
}

/** `null` = pas de valeur (pas de capacité, pas de scan, argent non visible) : pas de barre, jamais un faux 0. */
export interface ChartPoint { key: string; label: string; ts: number; values: Record<string, number | null>; id?: string }

/** « 2026-09 » dans le fuseau de Paris : une soirée à 00 h 30 appartient à son mois local, pas UTC. */
function parisMonth(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).format(new Date(iso)).slice(0, 7);
}

/**
 * Série du graphique : une barre par soirée, de la plus ancienne à la plus
 * récente. Au-delà de 31 soirées (« Cette année », « Tout ») on regroupe par
 * mois pour que chaque barre reste lisible.
 */
export function chartSeries(
  nights: SalesNight[],
  keys: SalesMetricKey[],
  opts: { maxBars?: number } = {},
): { unit: 'night' | 'month'; points: ChartPoint[] } {
  const max = opts.maxBars ?? 31;
  const asc = [...nights].sort((a, b) => a.start_at.localeCompare(b.start_at));
  if (asc.length <= max) {
    return {
      unit: 'night',
      points: asc.map((n) => ({
        key: n.id,
        id: n.id,
        label: n.title,
        ts: Date.parse(n.start_at),
        values: Object.fromEntries(keys.map((k) => [k, metricValue(n, k)])),
      })),
    };
  }
  const byMonth = new Map<string, SalesNight[]>();
  for (const n of asc) {
    const m = parisMonth(n.start_at);
    byMonth.set(m, [...(byMonth.get(m) ?? []), n]);
  }
  return {
    unit: 'month',
    points: [...byMonth.entries()].map(([m, ns]) => {
      // Somme des composantes, puis ratio : jamais une moyenne de ratios.
      const sum = (f: keyof SalesNight) => ns.reduce((s, n) => s + (typeof n[f] === 'number' ? (n[f] as number) : 0), 0);
      const sumIf = (keep: (n: SalesNight) => boolean, val: (n: SalesNight) => number) =>
        ns.reduce((s, n) => s + (keep(n) ? val(n) : 0), 0);
      const agg: Partial<SalesNight> & Partial<SalesTotals> = {
        revenue: sum('revenue'), rev_tickets: sum('rev_tickets'), rev_tables: sum('rev_tables'), rev_bar: sum('rev_bar'),
        entries: sum('entries'), customers: sum('customers'), tickets: sum('tickets'), ticket_cap: sum('ticket_cap'),
        // Remplissage = billets des SEULES soirées qui ont une capacité / leurs capacités.
        tickets_with_cap: ns.reduce((s, n) => s + ((n.ticket_cap ?? 0) > 0 ? n.tickets : 0), 0),
        // Mêmes dénominateurs que la période (voir SalesTotals).
        money_nights: ns.filter((n) => n.revenue !== null).length,
        spend_revenue: sumIf((n) => n.revenue !== null && n.entries > 0, (n) => n.revenue ?? 0),
        spend_entries: sumIf((n) => n.revenue !== null && n.entries > 0, (n) => n.entries),
        gl_presence_registered: sumIf((n) => n.gl_entered > 0, (n) => n.gl_registered),
        gl_presence_entered: sumIf((n) => n.gl_entered > 0, (n) => n.gl_entered),
        tables_presence_booked: sumIf((n) => n.tables_arrived > 0, (n) => n.tables),
        tables_presence_arrived: sumIf((n) => n.tables_arrived > 0, (n) => n.tables_arrived),
        money_tickets: sumIf((n) => n.revenue !== null, (n) => n.tickets),
        money_tables: sumIf((n) => n.revenue !== null, (n) => n.tables),
        money_bar_orders: sumIf((n) => n.revenue !== null, (n) => n.bar_orders),
        tables: sum('tables'), table_guests: sum('table_guests'), tables_arrived: sum('tables_arrived'),
        bar_orders: sum('bar_orders'), gl_registered: sum('gl_registered'), gl_entered: sum('gl_entered'),
      };
      return {
        key: m,
        label: m,
        ts: Date.parse(`${m}-01T12:00:00Z`),
        values: Object.fromEntries(keys.map((k) => [k, metricValue(agg, k)])),
      };
    }),
  };
}

/** La meilleure soirée de la période pour un chiffre (null sous deux soirées). */
export function bestNight(nights: SalesNight[], key: SalesMetricKey): SalesNight | null {
  if (nights.length < 2) return null;
  let best: SalesNight | null = null;
  let bestV = 0;
  for (const n of nights) {
    const v = metricValue(n, key) ?? 0;
    if (v > bestV) { best = n; bestV = v; }
  }
  return best;
}

/** Écart d'une soirée avec la précédente de la liste (triée du plus récent au plus ancien). */
export function nightDeltas(nights: SalesNight[], key: SalesMetricKey): Map<string, number | null> {
  const out = new Map<string, number | null>();
  nights.forEach((n, i) => {
    const prev = nights[i + 1];
    const cur = metricValue(n, key);
    const p = prev ? metricValue(prev, key) : null;
    out.set(n.id, cur !== null && p !== null && p > 0 ? ((cur - p) / p) * 100 : null);
  });
  return out;
}
