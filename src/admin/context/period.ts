/**
 * La période de l'admin : UNE pour toute une page, dans l'adresse (`?p=`),
 * comparée à la même durée juste avant. Quatre valeurs, jamais d'autres :
 * c'est ce qui met fin aux cinq vocabulaires de période de l'ancien admin.
 *
 * Module pur (testé) : aucun React, aucune date implicite hors `now`.
 */

export const ADMIN_PERIODS = ['7d', '30d', '90d', '12m'] as const;
export type AdminPeriod = (typeof ADMIN_PERIODS)[number];

export const DEFAULT_ADMIN_PERIOD: AdminPeriod = '30d';

/** Nombre de jours de chaque période (12 mois = 365 jours). */
export const PERIOD_DAYS: Record<AdminPeriod, number> = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 };

/** `?p=` illisible ou absent : la période par défaut, jamais une erreur. */
export function parseAdminPeriod(raw: string | null | undefined): AdminPeriod {
  return (ADMIN_PERIODS as readonly string[]).includes(raw ?? '') ? (raw as AdminPeriod) : DEFAULT_ADMIN_PERIOD;
}

export interface PeriodRange {
  period: AdminPeriod;
  days: number;
  /** Début de la période (inclus). */
  from: Date;
  /** Fin de la période (exclue) = maintenant. */
  to: Date;
  /** Même durée, juste avant. */
  prevFrom: Date;
  prevTo: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bornes de la période : fenêtre glissante qui finit maintenant, et la
 * période précédente de même durée qui finit où celle-ci commence.
 */
export function periodRange(period: AdminPeriod, now: Date = new Date()): PeriodRange {
  const days = PERIOD_DAYS[period];
  const to = new Date(now.getTime());
  const from = new Date(to.getTime() - days * DAY_MS);
  const prevTo = new Date(from.getTime());
  const prevFrom = new Date(from.getTime() - days * DAY_MS);
  return { period, days, from, to, prevFrom, prevTo };
}

/** Écart relatif courant / précédent, `null` quand la base est nulle (pas de « +∞ % »). */
export function relativeDelta(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** Pose `p` dans une requête d'adresse sans toucher aux autres paramètres. */
export function withPeriod(search: string, period: AdminPeriod): string {
  const sp = new URLSearchParams(search);
  if (period === DEFAULT_ADMIN_PERIOD) sp.delete('p');
  else sp.set('p', period);
  const s = sp.toString();
  return s ? `?${s}` : '';
}
