/**
 * Rapport de soirée — Analytics › Soirée (club et organisateur). Tous les
 * chiffres viennent de la RPC `get_event_report` (migration 20260924170000) :
 * ce module type la réponse et la met en forme (courbe cumulée alignée sur
 * J-N, fusion avec une soirée comparée, parts). Il n'agrège jamais une vente.
 */
import type { PillarKey } from './eventsSales';

export type ReportPhase = 'before' | 'live' | 'after';
export type LineStatus = 'on_sale' | 'sold_out' | 'upcoming' | 'closed';

export interface ReportLine {
  pillar: PillarKey;
  id: string;
  name: string | null;
  holderType?: 'club' | 'dj' | 'promoter' | 'custom' | null;
  price: number | null;
  sold: number;
  capacity: number | null;
  status: LineStatus;
  amount: number | null;
}

export interface ReportDay {
  /** Jours calendaires AVANT la soirée (0 = le jour J, négatif = après). */
  d: number;
  tickets: number;
  tables: number;
  guests: number;
  amount: number | null;
  visits: number;
  /** Attendus du jour : billets en quantité + convives de table + inscrits guest list (migration 20260925170000). */
  people?: number;
}

/** Un repère de la courbe J-N (migration 20260925170000). */
export interface ReportMarker {
  kind: 'published' | 'round' | 'email' | 'push';
  d: number;
  at: string;
  label: string | null;
}

/** Un constat « À retenir », calculé serveur avec son seuil ; le texte est `er.tk.<key>`. */
export interface ReportTakeaway {
  key: string;
  tone: 'good' | 'bad' | 'info';
  /** La section du rapport qui le prouve. */
  section?: 'sales' | 'curve' | 'reach' | 'who';
  params: Record<string, string | number | null>;
}

export interface ReportMessage {
  kind: 'email' | 'push';
  id: string;
  title: string | null;
  sentAt: string | null;
  auto: boolean;
  templateKey?: string | null;
  reach: number;
  opens: number | null;
  clicks: number;
  orders: number;
  entries: number;
  amount: number | null;
}

export interface EventReport {
  ok: true;
  now: string;
  tz: string;
  dayStart: string;
  money: boolean;
  scope: 'venue' | 'organizer';
  event: {
    id: string; title: string; startAt: string; endAt: string; poster: string | null;
    status: string; cancelled: boolean; publishedAt: string | null; createdAt: string;
    venueName: string | null; phase: ReportPhase;
    /** Objectif d'entrées posé par le pro (`events.entry_target`). */
    entryTarget?: number | null;
  };
  totals: {
    tickets: { sold: number; today: number; orders: number; capacity: number | null; enabled: boolean; soldOut: boolean };
    tables: { booked: number; today: number; guests: number; capacity: number | null; enabled: boolean; soldOut: boolean };
    guestList: { registered: number; today: number; capacity: number | null; enabled: boolean; soldOut: boolean };
    drinks: { orders: number; today: number } | null;
    revenue: { total: number; today: number; tickets: number; tables: number; drinks: number } | null;
    visits: { total: number; today: number; withOrder: number };
    /** La porte : personnes scannées (tous piliers) et attendus (migration 20260925140000). */
    door?: { entered: number; expected: number };
  };
  lines: ReportLine[];
  series: ReportDay[];
  visitSources: { source: string; sessions: number; orders: number }[];
  audience: { people: number; returning: number; new: number; buyers: number; priorEvents: number };
  channels: { source: string; n: number; amount: number | null }[];
  links: { id: string; label: string; code: string; clicks: number; n: number; entries: number; amount: number | null }[];
  messages: ReportMessage[];
  markers?: ReportMarker[];
  takeaways?: ReportTakeaway[];
  /**
   * Avant la soirée : la dernière soirée TERMINÉE de la portée (≥ 20 attendus)
   * et ses attendus au même J-N / au final (migration 20260925170000).
   */
  pace?: { refId: string; refTitle: string; d: number; final: number; atSameD: number } | null;
}

// ── Courbe ──────────────────────────────────────────────────────────────────

export type SeriesMetric = 'tickets' | 'amount' | 'guests' | 'tables' | 'visits';

/** Les mesures qui ont un sens pour cette soirée (une soirée gratuite n'a pas de CA). */
export function availableMetrics(r: EventReport): SeriesMetric[] {
  const out: SeriesMetric[] = [];
  if (r.totals.tickets.enabled || r.totals.tickets.sold > 0) out.push('tickets');
  if (r.totals.revenue && r.totals.revenue.total > 0) out.push('amount');
  if (r.totals.guestList.enabled || r.totals.guestList.registered > 0) out.push('guests');
  if (r.totals.tables.enabled || r.totals.tables.booked > 0) out.push('tables');
  out.push('visits');
  return out;
}

/**
 * Jour J vu d'aujourd'hui : `d` du jour courant (négatif une fois la soirée
 * passée). Borne la courbe : on ne dessine pas de futur.
 */
export function todayD(r: EventReport): number {
  const key = (iso: string) => new Intl.DateTimeFormat('en-CA', {
    timeZone: r.tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
  const a = key(r.now);
  const b = key(r.event.startAt);
  const toDays = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / 86_400_000;
  return Math.round(toDays(b) - toDays(a));
}

function valueOf(day: ReportDay | undefined, metric: SeriesMetric): number {
  if (!day) return 0;
  return metric === 'amount' ? day.amount ?? 0 : day[metric];
}

export interface CurvePoint {
  d: number;
  /** Cette soirée ; `null` au-delà d'aujourd'hui (pas de futur dessiné). */
  main: number | null;
  /** La soirée comparée, au même J-N. */
  compare: number | null;
}

/**
 * Points de la courbe, du premier jour d'activité (des deux soirées) jusqu'au
 * lendemain de la soirée, alignés sur J-N. Cumulé par défaut : c'est la
 * question « où en suis-je à J-5 par rapport à la dernière fois ? ».
 */
export function buildCurve(
  main: EventReport,
  compare: EventReport | null,
  metric: SeriesMetric,
  cumulative = true,
): CurvePoint[] {
  const mainBy = new Map(main.series.map((s) => [s.d, s]));
  const cmpBy = new Map((compare?.series ?? []).map((s) => [s.d, s]));
  const allD = [...mainBy.keys(), ...cmpBy.keys()];
  if (allD.length === 0) return [];
  const maxD = Math.min(Math.max(...allD, 0), 90);
  const minD = Math.max(Math.min(...allD, 0, -1), -3);
  const mainStop = todayD(main);
  const cmpStop = compare ? todayD(compare) : 0;

  const points: CurvePoint[] = [];
  let accMain = 0;
  let accCmp = 0;
  // Ce qui s'est vendu AVANT la fenêtre (au-delà de J-90) entre dans le point de départ.
  for (const [d, s] of mainBy) if (d > maxD) accMain += valueOf(s, metric);
  for (const [d, s] of cmpBy) if (d > maxD) accCmp += valueOf(s, metric);

  for (let d = maxD; d >= minD; d--) {
    const vm = valueOf(mainBy.get(d), metric);
    const vc = valueOf(cmpBy.get(d), metric);
    accMain += vm;
    accCmp += vc;
    points.push({
      d,
      main: d < mainStop ? null : cumulative ? accMain : vm,
      compare: compare ? (d < cmpStop ? null : cumulative ? accCmp : vc) : null,
    });
  }
  return points;
}

/** Où en était la soirée comparée au même J-N qu'aujourd'hui (cumul). */
export function compareAtSameD(main: EventReport, compare: EventReport, metric: SeriesMetric): { main: number; compare: number } | null {
  const d = todayD(main);
  if (d < 0) return null;
  const sumUpTo = (r: EventReport) => r.series.filter((s) => s.d >= d).reduce((acc, s) => acc + valueOf(s, metric), 0);
  return { main: sumUpTo(main), compare: sumUpTo(compare) };
}

// ── Parts ───────────────────────────────────────────────────────────────────

/** Part d'un nombre dans un total, en % arrondi, `null` sans total. */
export function share(n: number, total: number): number | null {
  if (!total || total <= 0) return null;
  return Math.round((n / total) * 100);
}

/** Passage visite → achat, en % à une décimale, `null` sans visite. */
export function conversionPct(withOrder: number, visits: number): number | null {
  if (!visits || visits <= 0) return null;
  return Math.round((withOrder / visits) * 1000) / 10;
}

const KNOWN_VISIT_SOURCES = ['direct', 'social', 'search', 'email', 'qr', 'paid_search', 'paid_social', 'paid', 'affiliate', 'internal', 'referral'];

/** Nom lisible d'une source de visite (`visitor_sessions.referrer_category`). */
export function visitSourceLabel(source: string, t: (k: string) => string): string {
  return KNOWN_VISIT_SOURCES.includes(source) ? t(`er.vsrc.${source}`) : source.charAt(0).toUpperCase() + source.slice(1);
}

// ── La phrase-réponse (plan de simplification, lot 4) ───────────────────────

/** A-t-on quoi que ce soit à dire sur cette soirée ? Sinon : une phrase, pas dix cartes à zéro. */
export function reportHasActivity(r: EventReport): boolean {
  const t = r.totals;
  return t.tickets.sold > 0 || t.tables.booked > 0 || t.guestList.registered > 0
    || (t.revenue?.total ?? 0) > 0 || (t.drinks?.orders ?? 0) > 0 || (t.door?.entered ?? 0) > 0;
}

export type ReportHeadline =
  | { kind: 'empty'; phase: ReportPhase }
  | {
      kind: 'selling';
      /** Le pilier qui porte la soirée : billets s'il y a une billetterie, sinon guest list. */
      pillar: 'tickets' | 'guestList';
      sold: number;
      capacity: number | null;
      daysBefore: number;
      /** Même pilier, soirée de référence, au même J-N (null sans référence). */
      reference: number | null;
    }
  | {
      kind: 'after';
      entered: number;
      expected: number;
      revenue: number | null;
      /** Entrées de la soirée de référence (null sans référence ou sans scan). */
      reference: number | null;
    };

/** Ce que dit la première phrase du rapport. */
export function reportHeadline(r: EventReport, compare: EventReport | null): ReportHeadline {
  if (!reportHasActivity(r)) return { kind: 'empty', phase: r.event.phase };
  if (r.event.phase === 'after') {
    const ref = compare && compare.event.phase === 'after' ? compare.totals.door?.entered ?? null : null;
    return {
      kind: 'after',
      entered: r.totals.door?.entered ?? 0,
      expected: r.totals.door?.expected ?? 0,
      revenue: r.totals.revenue?.total ?? null,
      reference: ref && ref > 0 ? ref : null,
    };
  }
  const useTickets = r.totals.tickets.enabled || r.totals.tickets.sold > 0;
  const pillar = useTickets ? 'tickets' : 'guestList';
  const metric: SeriesMetric = useTickets ? 'tickets' : 'guests';
  const cmp = compare ? compareAtSameD(r, compare, metric) : null;
  return {
    kind: 'selling',
    pillar,
    sold: useTickets ? r.totals.tickets.sold : r.totals.guestList.registered,
    capacity: useTickets ? r.totals.tickets.capacity : r.totals.guestList.capacity,
    daysBefore: Math.max(0, todayD(r)),
    reference: cmp ? cmp.compare : null,
  };
}

/**
 * Repère d'une jauge : où en était la soirée de référence. Avant la soirée,
 * au même J-N ; après, son total final.
 */
export function referenceFor(r: EventReport, compare: EventReport | null, metric: 'tickets' | 'tables' | 'guests'): number | null {
  if (!compare) return null;
  if (r.event.phase === 'after') {
    return metric === 'tickets' ? compare.totals.tickets.sold
      : metric === 'tables' ? compare.totals.tables.booked : compare.totals.guestList.registered;
  }
  return compareAtSameD(r, compare, metric)?.compare ?? null;
}

// ── Objectif et rythme (plan de simplification, lot 7) ──────────────────────

/** Attendus de la soirée à ce jour (même définition que `totals.door.expected`). */
export function expectedSoFar(r: EventReport): number {
  if (r.totals.door) return r.totals.door.expected;
  return r.series.reduce((acc, s) => acc + (s.people ?? 0), 0);
}

export interface PaceProjection {
  projected: number;
  /** La soirée dont on prend le rythme. */
  refTitle: string;
}

/**
 * Où finirait la soirée au rythme d'une soirée de référence : la part de ses
 * attendus qu'elle avait déjà au même J-N, appliquée aux attendus d'aujourd'hui.
 * La soirée comparée à l'écran si elle est terminée, sinon la dernière soirée
 * terminée de la portée (`report.pace`, choisie serveur). `null` quand ça ne dit
 * rien : soirée passée ou en cours, référence trop mince (< 20 attendus) ou
 * encore presque vide à ce J-N (< 5 % de son total).
 */
export function paceProjection(r: EventReport, compare: EventReport | null): PaceProjection | null {
  if (r.event.phase !== 'before') return null;
  const d = todayD(r);
  if (d < 0) return null;
  let refFinal: number;
  let refAt: number;
  let refTitle: string;
  if (compare && compare.event.phase === 'after') {
    const people = (s: ReportDay) => s.people ?? 0;
    refFinal = compare.series.reduce((acc, s) => acc + people(s), 0);
    refAt = compare.series.filter((s) => s.d >= d).reduce((acc, s) => acc + people(s), 0);
    refTitle = compare.event.title;
  } else if (r.pace) {
    refFinal = r.pace.final;
    refAt = r.pace.atSameD;
    refTitle = r.pace.refTitle;
  } else {
    return null;
  }
  if (refFinal < 20 || refAt <= 0 || refAt / refFinal < 0.05) return null;
  return { projected: Math.round(expectedSoFar(r) / (refAt / refFinal)), refTitle };
}

export type TargetStatus =
  | { kind: 'none' }
  | {
      kind: 'progress';
      target: number;
      /** Avant et pendant : les attendus ; après : les entrées scannées. */
      current: number;
      measure: 'expected' | 'entered';
      /** Projection au rythme d'une soirée de référence (avant la soirée seulement). */
      pace: PaceProjection | null;
    };

/** Où en est la soirée face à son objectif. */
export function targetStatus(r: EventReport, compare: EventReport | null, target: number | null | undefined): TargetStatus {
  if (!target || target <= 0) return { kind: 'none' };
  const after = r.event.phase === 'after';
  return {
    kind: 'progress',
    target,
    current: after ? r.totals.door?.entered ?? 0 : expectedSoFar(r),
    measure: after ? 'entered' : 'expected',
    pace: paceProjection(r, compare),
  };
}
