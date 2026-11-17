/**
 * Règles pures de la rubrique « Madrid » (testées). Les seuils sont écrits ici
 * et dans docs/designs/ADMIN_MADRID.md, jamais ailleurs.
 */
import type { CurPrev, MadridMonth } from './data';

/** Aucun taux ni part sous cette base : on montre les nombres bruts. */
export const MIN_BASE = 10;

/** Le verdict ne juge pas en dessous de ce volume sur 4 semaines. */
export const THIN_EXITS = 20;
export const THIN_VISITORS = 50;

/** Une tendance est une hausse ou une baisse d'au moins 20 % ET d'au moins 5 sorties. */
export const TREND_SHARE = 0.2;
export const TREND_MIN = 5;

/** En dessous, presque personne ne revient. */
export const WEAK_RETURN = 0.1;

/** Part `n / base`, ou `null` quand la base est trop petite pour qu'un taux veuille dire quelque chose. */
export function shareOf(n: number | null | undefined, base: number | null | undefined, min = MIN_BASE): number | null {
  if (n == null || base == null || !Number.isFinite(n) || !Number.isFinite(base)) return null;
  if (base < min || base <= 0) return null;
  return Math.max(0, n) / base;
}

export type Trend = 'up' | 'down' | 'flat';

export function trendOf(v: CurPrev | null | undefined): Trend {
  if (!v) return 'flat';
  const cur = Math.max(0, v.cur ?? 0), prev = Math.max(0, v.prev ?? 0);
  if (cur - prev >= TREND_MIN && cur >= prev * (1 + TREND_SHARE)) return 'up';
  if (prev - cur >= TREND_MIN && cur <= prev * (1 - TREND_SHARE)) return 'down';
  return 'flat';
}

export type VerdictLevel = 'thin' | 'up' | 'down' | 'flat';

export interface VerdictInput {
  visitors: CurPrev;
  exits: CurPrev;
  exitPeople: CurPrev;
  returning: { base: number; back: number };
  accounts: CurPrev;
  reportedRows: number;
  costsEntered: boolean;
}

export interface Verdict {
  level: VerdictLevel;
  exitsTrend: Trend;
  visitorsTrend: Trend;
  /** Part des visiteurs (consentants) des 4 semaines déjà venus avant ; `null` sous 10. */
  returnShare: number | null;
  weakReturn: boolean;
  /** Ce qui manque pour dire « ça vaut le coup » (ordre d'affichage). */
  missing: Array<'sales' | 'costs'>;
}

export function madridVerdict(v: VerdictInput): Verdict {
  const exitsTrend = trendOf(v.exits);
  const visitorsTrend = trendOf(v.visitors);
  const thin = (v.exits?.cur ?? 0) < THIN_EXITS && (v.visitors?.cur ?? 0) < THIN_VISITORS;
  const returnShare = shareOf(v.returning?.back, v.returning?.base);
  const level: VerdictLevel = thin ? 'thin' : exitsTrend;
  const missing: Verdict['missing'] = [];
  if (!(v.reportedRows > 0)) missing.push('sales');
  if (!v.costsEntered) missing.push('costs');
  return { level, exitsTrend, visitorsTrend, returnShare, weakReturn: returnShare != null && returnShare < WEAK_RETURN, missing };
}

/** Coût par sortie et par compte, sur les seuls mois renseignés. */
export function costPer(months: MadridMonth[] | null | undefined): {
  months: number; cost: number; hours: number; exits: number; accounts: number;
  perExit: number | null; perAccount: number | null; hoursPerExit: number | null;
} {
  const filled = (months ?? []).filter((m) => m.cost != null || m.hours != null);
  const cost = filled.reduce((s, m) => s + (m.cost ?? 0), 0);
  const hours = filled.reduce((s, m) => s + (m.hours ?? 0), 0);
  const withCost = filled.filter((m) => m.cost != null);
  const withHours = filled.filter((m) => m.hours != null);
  const exitsC = withCost.reduce((s, m) => s + m.exits, 0);
  const accountsC = withCost.reduce((s, m) => s + m.accounts, 0);
  const exitsH = withHours.reduce((s, m) => s + m.exits, 0);
  return {
    months: filled.length, cost, hours,
    exits: filled.reduce((s, m) => s + m.exits, 0),
    accounts: filled.reduce((s, m) => s + m.accounts, 0),
    perExit: withCost.length && exitsC > 0 ? cost / exitsC : null,
    perAccount: withCost.length && accountsC > 0 ? cost / accountsC : null,
    hoursPerExit: withHours.length && exitsH > 0 ? hours / exitsH : null,
  };
}

/** Pays de connexion : l'Espagne (locaux et résidents) contre l'étranger (touristes probables). */
export function localVsForeign(countries: Array<{ key: string; n: number }> | null | undefined): { local: number; foreign: number; unknown: number } {
  let local = 0, foreign = 0, unknown = 0;
  for (const c of countries ?? []) {
    if (!c.key || c.key === '?') unknown += c.n;
    else if (c.key === 'ES') local += c.n;
    else foreign += c.n;
  }
  return { local, foreign, unknown };
}

/** Lundi = 0 : l'indice d'un jour ISO (1 à 7). */
export const isoDowIndex = (dow: number) => ((dow - 1) % 7 + 7) % 7;

/** Lien dans une phrase : souligné discret, l'accent au survol. */
export const linkClass = 'a-t1 underline decoration-[var(--a-border-strong)] underline-offset-2 hover:decoration-[var(--a-accent)]';
