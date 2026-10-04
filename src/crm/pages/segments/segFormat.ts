/**
 * Mise en forme commune de l'écran Segments : taux du design (une décimale
 * sous 10 %), libellés de période, chemin d'une courbe.
 */
import type { SegPeriod } from '@/crm/data/segments';

/** Taux d'un rapport (0-1) : « 5,1 % », « 41 % ». */
export function ratePct(pct: (v: number, digits?: number) => string, part: number, whole: number): string {
  if (!whole) return '—';
  const v = (part / whole) * 100;
  return v < 10 ? pct(v, 1) : pct(v);
}

export const rate = (a: number, b: number) => (b ? a / b : 0);

export const PERIODS: SegPeriod[] = ['30d', '90d', '12m'];

/** Chemin SVG (viewBox 0..100 × 0..h) d'une série. */
export function linePath(values: number[], h: number, lo?: number, hi?: number, pad = 4): string {
  const n = values.length;
  if (!n) return '';
  const min = lo ?? Math.min(...values);
  const max = hi ?? Math.max(...values);
  const sx = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const sy = (v: number) => h - pad - ((v - min) / Math.max(1e-9, max - min)) * (h - pad * 2);
  return 'M' + values.map((v, i) => `${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(' L');
}
