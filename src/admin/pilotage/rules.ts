/**
 * Règles pures des pages v3 de Pilotage et d'Argent (testées,
 * src/admin/__tests__/pilotMoneyV3.test.ts). Elles ne recalculent aucun
 * chiffre métier : elles LISENT ce que rendent les RPC pour choisir quoi dire
 * (la plus grosse perte d'un entonnoir, la cohorte qu'une phrase raconte, la
 * colonne d'échéance d'une ligne à régler, le pont du MRR).
 */
import { MIN_SAMPLE } from '@/lib/metrics';

/**
 * Index de l'étape (destination) qui perd le plus de monde par rapport à la
 * précédente. En personnes, jamais en pourcentage : sur de petits volumes, un
 * taux de perte ment. `null` quand aucune étape ne perd personne.
 */
export function biggestDrop(values: readonly number[]): number | null {
  let best: number | null = null;
  let bestLost = 0;
  for (let i = 1; i < values.length; i += 1) {
    const lost = Math.max(0, (values[i - 1] ?? 0) - (values[i] ?? 0));
    if (lost > bestLost) { bestLost = lost; best = i; }
  }
  return best;
}

/** Part d'un total, `null` sous MIN_SAMPLE (aucun pourcentage sur une petite base). */
export function shareOrNull(part: number, base: number, min = MIN_SAMPLE): number | null {
  if (!Number.isFinite(base) || base < min || base <= 0) return null;
  return Math.max(0, part) / base;
}

export interface CohortLike { m: string; size: number; months_elapsed: number; active: number[] }

/**
 * La cohorte que la phrase de la rétention raconte : la plus récente qui a
 * trois mois de recul (sinon un mois) et des pros, avec le nombre encore actifs au dernier
 * mois écoulé. Sans recul possible : la plus récente, `still` = null.
 */
export function cohortStory(cohorts: readonly CohortLike[]): { m: string; size: number; still: number | null; after: number } | null {
  const withPros = cohorts.filter((c) => c.size > 0);
  if (withPros.length === 0) return null;
  const sorted = [...withPros].sort((a, b) => a.m.localeCompare(b.m));
  // La plus récente qui a trois mois de recul (sinon un) : assez proche pour
  // s'en souvenir, assez ancienne pour dire quelque chose.
  const pick = sorted.filter((c) => c.months_elapsed >= 3).at(-1) ?? sorted.filter((c) => c.months_elapsed >= 1).at(-1);
  if (!pick) {
    const last = [...withPros].sort((a, b) => a.m.localeCompare(b.m)).at(-1)!;
    return { m: last.m, size: last.size, still: null, after: 0 };
  }
  const k = Math.min(pick.months_elapsed, 6, pick.active.length - 1);
  return { m: pick.m, size: pick.size, still: pick.active[k] ?? 0, after: k };
}

/** Pont du MRR d'un mois : départ, nouveaux, perdus, autres variations (prix, annuel), fin. */
export function mrrBridge(months: ReadonlyArray<{ new: number; lost: number; mrr: number }>):
  { start: number; added: number; lost: number; other: number; end: number } | null {
  if (months.length === 0) return null;
  const last = months[months.length - 1];
  const start = months.length >= 2 ? months[months.length - 2].mrr : 0;
  const other = round2(last.mrr - start - last.new + last.lost);
  return { start, added: last.new, lost: last.lost, other: Math.abs(other) < 0.01 ? 0 : other, end: last.mrr };
}

// ── À régler : par échéance ─────────────────────────────────────────────────
export type DueBucket = 'now' | 'week' | 'later';
export const DUE_BUCKETS: DueBucket[] = ['now', 'week', 'later'];

/**
 * Colonne d'une ligne à régler. Une échéance passée, un litige ou une alerte
 * (un fait déjà arrivé : litige Stripe, vente payée sans billet, échec) = à
 * traiter maintenant ; une échéance sous 7 jours = cette semaine ; le reste plus tard.
 */
export function dueBucket(x: { disputed?: boolean; alert?: boolean; due?: string | null }, now: number = Date.now()): DueBucket {
  if (x.alert || x.disputed) return 'now';
  if (!x.due) return 'later';
  const t = Date.parse(x.due);
  if (!Number.isFinite(t)) return 'later';
  if (t <= now) return 'now';
  return t - now <= 7 * 86_400_000 ? 'week' : 'later';
}

/** Ancienneté en mois pleins (abonnés) ; `null` sans date lisible. */
export function monthsSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const a = new Date(t), b = new Date(now);
  const m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
  return Math.max(0, m);
}

/** Vrai quand une série n'a aucune valeur non nulle (dire en phrase, pas dessiner plat). */
export function isFlatZero(values: ReadonlyArray<number | null | undefined>): boolean {
  return values.every((v) => !v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
