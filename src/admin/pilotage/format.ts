/**
 * Petites règles pures partagées par Pilotage et Argent (testées) : adresses
 * des fiches (pro : lot 2, `/admin/pros/<clé>` ; personne : lot 3,
 * `/admin/clients/<e-mail>`), mois lisible, case d'une cohorte.
 */
import { MIN_SAMPLE } from '@/lib/metrics';
import type { Retention } from './data';

/** Clé de compte : `venue:<id>` | `org:<uuid>` | `agency:<id>`. */
export function proHref(key: string): string {
  return `/admin/pros/${encodeURIComponent(key)}`;
}

export function personHref(email: string): string {
  return `/admin/clients/${encodeURIComponent(email.trim().toLowerCase())}`;
}

export function fmtMonth(m: string, lang: string): string {
  const [y, mo] = m.split('-').map(Number);
  if (!y || !mo) return m;
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es-ES' : 'en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

type Cohort = Retention['cohorts'][number];
export type CohortMode = 'accounts' | 'sales';

/** Valeur d'une case de cohorte : `null` = mois pas encore écoulé. */
export function cohortCell(c: Cohort, k: number, mode: CohortMode): { raw: number; pct: number | null } | null {
  if (k > c.months_elapsed) return null;
  const raw = mode === 'accounts' ? c.active[k] ?? 0 : c.amount[k] ?? 0;
  const base = mode === 'accounts' ? c.size : c.amount[0] ?? 0;
  const pct = mode === 'accounts' && c.size < MIN_SAMPLE ? null : base > 0 ? raw / base : null;
  return { raw, pct };
}
