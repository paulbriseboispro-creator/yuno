/**
 * Les cinq cycles de vie d'un client CRM (règle serveur : _crm_people_build)
 * et leur dessin : couleur de pastille et d'avatar. Le libellé vient de
 * `yc.cli.seg.<cycle>`, sa définition de `yc.cli.seg.<cycle>.def`.
 */
import type { Lifecycle } from '@/crm/data/clients';

export const LIFECYCLES: Lifecycle[] = ['hab', 'occ', 'nou', 'end', 'none'];

export const LIFECYCLE_COLOR: Record<Lifecycle, string> = {
  hab: 'var(--red-500)',
  occ: 'var(--tangerine-500)',
  nou: 'var(--red-200)',
  end: 'var(--sand-300)',
  none: 'var(--sand-100)',
};

/** Fond et encre de l'avatar d'un client, selon son cycle de vie. */
export const LIFECYCLE_AVATAR: Record<Lifecycle, [string, string]> = {
  hab: ['var(--gradient-brand)', '#fff'],
  occ: ['var(--red-100)', 'var(--red-700)'],
  nou: ['var(--sand-100)', 'var(--sand-700)'],
  end: ['var(--sand-50)', 'var(--sand-500)'],
  none: ['var(--sand-50)', 'var(--sand-400)'],
};

export function initials(first: string | null, last: string | null, email: string): string {
  const a = (first ?? '').trim();
  const b = (last ?? '').trim();
  if (a || b) return ((a[0] ?? '') + (b[0] ?? '')).toUpperCase() || (a || b).slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

export function fullName(first: string | null, last: string | null, email: string): string {
  return [first, last].filter((x) => x && x.trim()).join(' ') || email;
}

/** « il y a 3 sem. », « il y a 2 mois »… depuis un nombre de jours. */
export function relDays(days: number, t: (k: string, v?: Record<string, string | number>) => string, tp: (k: string, n: number) => string): string {
  if (days < 1) return t('yc.cli.list.rel.today');
  if (days < 14) return t('yc.cli.list.rel.days', { n: days });
  if (days < 60) return t('yc.cli.list.rel.weeks', { n: Math.round(days / 7) });
  if (days < 365) return t('yc.cli.list.rel.months', { n: Math.round(days / 30.4) });
  return tp('yc.cli.list.rel.years', Math.floor(days / 365));
}
