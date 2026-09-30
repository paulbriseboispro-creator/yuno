/**
 * Trafic d'UNE soirée — Analytics › Trafic › Par soirée. Tous les chiffres
 * viennent de la RPC `get_event_traffic` (migration 20260930244000) : ce module
 * type la réponse et met en forme le tunnel (étapes, pertes, plus grosse fuite).
 * Il n'agrège jamais une visite.
 */
import { MIN_SAMPLE } from './metrics';

export type TrafficPhase = 'before' | 'live' | 'after';
export type TrafficPillar = 'tickets' | 'tables' | 'guest_list';

export interface TrafficFunnelTotals {
  tracked: boolean;
  sessions: number;
  selected: number;
  checkout: number;
  details: number;
  purchased: number;
  failedOpen: number;
}

export interface TrafficPillarFunnel {
  pillar: TrafficPillar;
  selected: number;
  checkout: number;
  details: number;
  purchased: number;
}

export interface TrafficSelection {
  pillar: 'tickets' | 'tables';
  ref: string;
  name: string | null;
  sessions: number;
  units: number;
  sold: number;
}

export interface TrafficSourceRow { source: string; visits: number; sessions: number; checkout: number; purchased: number }
export interface TrafficDeviceRow { device: string; visits: number; sessions: number; checkout: number; purchased: number }

/** Un constat « À retenir » calculé serveur avec son seuil ; le texte est `evl.<lentille>.tk.<key>`. */
export interface LensTakeaway {
  key: string;
  tone: 'good' | 'bad' | 'info';
  section?: string;
  params: Record<string, string | number | null>;
}

export interface EventTraffic {
  ok: true;
  now: string;
  tz: string;
  money: boolean;
  scope: 'venue' | 'organizer';
  event: { id: string; title: string; startAt: string; endAt: string; poster: string | null; cancelled: boolean; phase: TrafficPhase };
  visits: {
    total: number; today: number; visitors: number; returning: number;
    avgDuration: number | null; scrollSample: number; scrollHalf: number; scrollFull: number;
  };
  cities: { city: string; visits: number }[];
  funnel: TrafficFunnelTotals;
  pillars: TrafficPillarFunnel[];
  failures: { reason: string; sessions: number }[];
  selections: TrafficSelection[];
  sources: TrafficSourceRow[];
  devices: TrafficDeviceRow[];
  timing: { buyers: number; viewToBuy: number | null; checkoutToBuy: number | null };
  abandoned: { sessions: number; amount: number | null };
  series: { d: number; visits: number; checkout: number; purchased: number }[];
  live: { total: number; cart: number; checkout: number };
  takeaways?: LensTakeaway[];
}

// ── Le tunnel ────────────────────────────────────────────────────────────────

export type StageKey = 'viewed' | 'selected' | 'checkout' | 'details' | 'purchased';

export interface FunnelStage {
  key: StageKey;
  count: number;
  /** Part de l'étape précédente qui a continué (0-100, un chiffre après la virgule) ; `null` sur la première. */
  ofPrev: number | null;
  /** Part de la première étape (0-100). */
  ofTop: number | null;
  /** Personnes perdues entre l'étape précédente et celle-ci. */
  lost: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Étapes d'un tunnel à partir des comptes atteints, dans l'ordre. */
export function buildStages(steps: { key: StageKey; count: number }[]): FunnelStage[] {
  const top = steps[0]?.count ?? 0;
  return steps.map((s, i) => {
    const prev = i === 0 ? null : steps[i - 1].count;
    return {
      key: s.key,
      count: s.count,
      ofPrev: prev === null ? null : prev > 0 ? round1((s.count / prev) * 100) : null,
      ofTop: top > 0 ? round1((s.count / top) * 100) : null,
      lost: prev === null ? 0 : Math.max(0, prev - s.count),
    };
  });
}

/** Le tunnel de toute la soirée : vue → choix → paiement → coordonnées → achat. */
export function overallStages(f: TrafficFunnelTotals): FunnelStage[] {
  return buildStages([
    { key: 'viewed', count: f.sessions },
    { key: 'selected', count: f.selected },
    { key: 'checkout', count: f.checkout },
    { key: 'details', count: f.details },
    { key: 'purchased', count: f.purchased },
  ]);
}

/**
 * Le tunnel d'un pilier : il part du CHOIX (on ne sait pas « qui a regardé les
 * billets » parmi ceux qui ont vu la page). La guest list n'a pas d'étape
 * « coordonnées » distincte : son inscription est l'achat.
 */
export function pillarStages(p: TrafficPillarFunnel): FunnelStage[] {
  const steps: { key: StageKey; count: number }[] = [
    { key: 'selected', count: p.selected },
    { key: 'checkout', count: p.checkout },
  ];
  if (p.pillar !== 'guest_list') steps.push({ key: 'details', count: p.details });
  steps.push({ key: 'purchased', count: p.purchased });
  return buildStages(steps);
}

export interface Leak {
  /** L'étape qu'on n'atteint pas. */
  at: StageKey;
  lost: number;
  /** Part perdue de l'étape d'avant (0-100). */
  lostPct: number;
}

/**
 * La plus grosse fuite : l'étape où l'on perd le plus de monde en valeur
 * absolue (la première étape — « vu la page, sans rien choisir » — est la
 * règle, pas une fuite : on la sort si une autre perd autant). Se tait sous
 * `MIN_SAMPLE` personnes perdues : un constat sur 4 personnes n'en est pas un.
 */
export function biggestLeak(stages: FunnelStage[], skipFirst = true): Leak | null {
  const candidates = stages.slice(1).filter((s) => s.lost >= MIN_SAMPLE && s.ofPrev !== null);
  if (candidates.length === 0) return null;
  const pool = skipFirst && candidates.length > 1 ? candidates.filter((s) => s.key !== 'selected') : candidates;
  // À pertes égales, celle qui coûte la plus grande part de l'étape d'avant.
  const worst = [...(pool.length ? pool : candidates)].sort((a, b) => b.lost - a.lost || (a.ofPrev ?? 0) - (b.ofPrev ?? 0))[0];
  return { at: worst.key, lost: worst.lost, lostPct: round1(100 - (worst.ofPrev ?? 0)) };
}

/** Conversion visite → achat, au dixième ; `null` sous `MIN_SAMPLE` visites. */
export function visitConversion(purchased: number, visits: number): number | null {
  if (visits < MIN_SAMPLE) return null;
  return round1((purchased / visits) * 100);
}

// ── Refus de paiement ────────────────────────────────────────────────────────

const KNOWN_FAILURES = ['network', 'validation', 'server', 'sold_out', 'payments_not_ready', 'rate_limited'] as const;

/** Clé de libellé d'un motif de refus ; un code inconnu devient « autre raison ». */
export function failureLabelKey(reason: string): string {
  return (KNOWN_FAILURES as readonly string[]).includes(reason) ? `evl.fail.${reason}` : 'evl.fail.other';
}

// ── Sources et appareils ─────────────────────────────────────────────────────

export interface ConversionRow {
  key: string;
  visits: number;
  sessions: number;
  checkout: number;
  purchased: number;
  /** Achats / sessions suivies dans le tunnel (0-100) ; `null` sous MIN_SAMPLE. */
  conversion: number | null;
}

/** Une ligne source / appareil avec sa conversion (sur les sessions du tunnel, pas sur les visites). */
export function withConversion<T extends { visits: number; sessions: number; checkout: number; purchased: number }>(
  rows: T[],
  key: (r: T) => string,
): ConversionRow[] {
  return rows.map((r) => ({
    key: key(r),
    visits: r.visits,
    sessions: r.sessions,
    checkout: r.checkout,
    purchased: r.purchased,
    conversion: r.sessions >= MIN_SAMPLE ? round1((r.purchased / r.sessions) * 100) : null,
  }));
}

/** « 2 min 05 », « 45 s » — les durées médianes du tunnel. */
export function formatDuration(seconds: number, units: { min: string; sec: string }): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} ${units.sec}`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m} ${units.min}` : `${m} ${units.min} ${String(rest).padStart(2, '0')}`;
}
