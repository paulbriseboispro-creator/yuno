/**
 * Comportement d'achat — onglet `?tab=purchase` de la page Analytics (club et
 * organisateur). Tous les chiffres viennent de la RPC `get_purchase_behavior`
 * (migration 20260924150000) : ce module ne fait que typer la réponse, la
 * remettre en forme (matrice jour × heure, pourcentages) et écrire les
 * phrases « À retenir ». Il n'agrège jamais une vente.
 */

export type PbPillar = 'tickets' | 'tables' | 'drinks';
export type PbLeadBucket = 'd30p' | 'd15_30' | 'd8_14' | 'd4_7' | 'd1_3' | 'h24' | 'after_start';

export interface PurchaseBehavior {
  ok: true;
  tz: string;
  hasDrinks: boolean;
  from: string;
  to: string;
  summary: {
    transactions: number;
    buyers: number;
    amount: number;
    avgBasket: number;
    avgPerBuyer: number;
    avgTxPerBuyer: number;
    repeatBuyers: number;
    newBuyers: number;
    medianLeadHours: number | null;
    guestCheckouts: number;
    guestlist: number;
    guestlistScanned: number;
  };
  pillars: { pillar: PbPillar; transactions: number; units: number; buyers: number; amount: number; avgBasket: number }[];
  leadTime: { bucket: PbLeadBucket; tickets: number; tables: number; ticketUnits: number; amount: number }[];
  leadMedian: { tickets: number | null; tables: number | null };
  /** [pillar, jour (lundi = 0), heure, nombre] dans le fuseau du club. */
  heatmap: [PbPillar, number, number, number][];
  /** h = heures écoulées depuis l'ouverture (-1 = avant, 8 = 8 h et plus). */
  nightDrinks: { h: number; orders: number; amount: number }[];
  drinkRhythm: {
    drinkersPerNight: number;
    avgOrdersPerNight: number | null;
    avgSpendPerNight: number | null;
    multiOrderShare: number | null;
    medianMinutesEntryToFirstDrink: number | null;
  };
  groupSize: {
    tickets: { bucket: string; n: number; units: number }[];
    avgTicketsPerOrder: number | null;
    tables: { bucket: string; n: number }[];
    avgGuestsPerTable: number | null;
    avgPerHead: number | null;
    drinks: { bucket: string; n: number }[];
    avgItemsPerOrder: number | null;
  };
  basketBands: { pillar: PbPillar; band: string; n: number }[];
  rounds: { rank: number; units: number; amount: number }[];
  attach: {
    ticketOrders: number;
    insurance: number;
    bundledDrink: number;
    bundledDrinkRedeemed: number;
    upgrades: number;
    loyaltyRewards: number;
    optinBase: number;
    newsletter: number;
    sms: number;
    tableOrders: number;
    tableDeposit: number;
    tableOnSite: number;
  };
  loyalty: {
    frequency: { bucket: string; buyers: number }[];
    medianDaysBetween: number | null;
    top10Share: number | null;
    newAmount: number;
    returningAmount: number;
  };
  crossSell: { pillar: 'tickets' | 'tables' | 'guestlist'; pairs: number; withDrinks: number; drinkSpend: number | null; withTable: number }[];
  channels: { source: string; n: number; amount: number }[];
  trackedShare: number | null;
  funnel: {
    sessions: number;
    carts: number;
    checkouts: number;
    orders: number;
    abandonedCarts: number;
    abandonedValue: number;
    medianVisitAtPurchase: number | null;
    medianDurationBuyers: number | null;
    medianDurationOthers: number | null;
    newSessions: number;
    newOrders: number;
    returningSessions: number;
    returningOrders: number;
    devices: { device: string; sessions: number; orders: number }[];
    sources: { source: string; sessions: number; orders: number }[];
  };
  attendance: {
    nights: number;
    ticketOrders: number;
    ticketScanned: number;
    tableOrders: number;
    tableScanned: number;
    guestlist: number;
    guestlistScanned: number;
    byLead: { bucket: PbLeadBucket; orders: number; scanned: number }[];
  };
}

export const LEAD_BUCKETS: PbLeadBucket[] = ['d30p', 'd15_30', 'd8_14', 'd4_7', 'd1_3', 'h24', 'after_start'];
export const BASKET_BANDS = ['b0_15', 'b15_30', 'b30_60', 'b60_120', 'b120_300', 'b300p'] as const;

/** Part `a / b`, ou null quand la base est vide (on n'affiche jamais « 0 % » sur rien). */
export function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

/** Matrice 7 × 24 (lundi d'abord) pour un pilier, ou tous les piliers. */
export function heatmapMatrix(rows: PurchaseBehavior['heatmap'], pillar: PbPillar | 'all'): number[][] {
  const m = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const [p, d, h, n] of rows) {
    if (pillar !== 'all' && p !== pillar) continue;
    if (d < 0 || d > 6 || h < 0 || h > 23) continue;
    m[d][h] += n;
  }
  return m;
}

/** Le créneau jour × heure le plus chargé, ou null si la matrice est vide. */
export function peakSlot(m: number[][]): { day: number; hour: number; n: number } | null {
  let best: { day: number; hour: number; n: number } | null = null;
  m.forEach((row, day) => row.forEach((n, hour) => {
    if (n > 0 && (!best || n > best.n)) best = { day, hour, n };
  }));
  return best;
}

/** Part des achats à l'avance faits dans les 72 dernières heures (ou après l'ouverture). */
export function lastMinuteShare(lead: PurchaseBehavior['leadTime'], pillar: 'tickets' | 'tables'): number | null {
  const total = lead.reduce((s, b) => s + b[pillar], 0);
  const late = lead.filter(b => b.bucket === 'd1_3' || b.bucket === 'h24' || b.bucket === 'after_start')
    .reduce((s, b) => s + b[pillar], 0);
  return ratio(late, total);
}

/** Durée lisible à partir d'heures : « 18 h », « 3 j », « 2 sem. ». */
export function fmtLeadHours(hours: number | null, t: (k: string) => string): string {
  if (hours == null || !isFinite(hours)) return '—';
  if (hours < 1) return t('pb.unit.lessHour');
  if (hours < 48) return t('pb.unit.hours').replace('{n}', String(Math.round(hours)));
  const days = hours / 24;
  if (days < 21) return t('pb.unit.days').replace('{n}', String(Math.round(days)));
  return t('pb.unit.weeks').replace('{n}', String(Math.round(days / 7)));
}

export function fmtPctLocale(v: number | null, language: string, digits = 0): string {
  if (v == null || !isFinite(v)) return '—';
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);
}

export function fmtNum(v: number | null, language: string, digits = 0): string {
  if (v == null || !isFinite(v)) return '—';
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);
}

export function fmtEur(v: number | null, language: string): string {
  if (v == null || !isFinite(v)) return '—';
  const locale = language === 'fr' ? 'fr-FR' : language === 'es' ? 'es-ES' : 'en-GB';
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'EUR',
    maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2, minimumFractionDigits: 0,
  }).format(v);
}

export interface PbInsight { key: string; text: string }

/**
 * Les phrases « À retenir » : quatre au plus, seulement quand la base est
 * assez large pour que la phrase veuille dire quelque chose.
 */
export function buildInsights(d: PurchaseBehavior, t: (k: string) => string, language: string): PbInsight[] {
  const out: PbInsight[] = [];
  const ticketsPre = d.leadTime.reduce((s, b) => s + b.tickets, 0);

  if (d.leadMedian.tickets != null && ticketsPre >= 10) {
    out.push({ key: 'lead', text: t('pb.ins.lead').replace('{d}', fmtLeadHours(d.leadMedian.tickets, t)) });
  }
  const late = lastMinuteShare(d.leadTime, 'tickets');
  if (late != null && ticketsPre >= 10 && late >= 0.4) {
    out.push({ key: 'late', text: t('pb.ins.late').replace('{p}', fmtPctLocale(late, language)) });
  }
  const peak = peakSlot(heatmapMatrix(d.heatmap.filter(r => r[0] !== 'drinks'), 'all'));
  if (peak && peak.n >= 3) {
    out.push({
      key: 'peak',
      text: t('pb.ins.peak')
        .replace('{day}', t(`pb.day.${peak.day}`))
        .replace('{h}', String(peak.hour)),
    });
  }
  const repeat = ratio(d.summary.repeatBuyers, d.summary.buyers);
  if (repeat != null && d.summary.buyers >= 10) {
    out.push({ key: 'repeat', text: t('pb.ins.repeat').replace('{p}', fmtPctLocale(repeat, language)) });
  }
  if (d.loyalty.top10Share != null && d.summary.buyers >= 20) {
    out.push({ key: 'top10', text: t('pb.ins.top10').replace('{p}', fmtPctLocale(d.loyalty.top10Share, language)) });
  }
  const tix = d.crossSell.find(c => c.pillar === 'tickets');
  if (d.hasDrinks && tix && tix.pairs >= 10) {
    const r = ratio(tix.withDrinks, tix.pairs);
    if (r != null) out.push({ key: 'bar', text: t('pb.ins.bar').replace('{p}', fmtPctLocale(r, language)) });
  }
  return out.slice(0, 4);
}
