/**
 * Le haut « rond » d'un axe de graphique : le plus petit multiple d'une
 * puissance de dix (pas fins ou grossiers) au-dessus du maximum majoré
 * d'une marge. Partagé par l'accueil, la vue d'ensemble et les résultats
 * des e-mails.
 */
export const FINE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10] as const;
export const COARSE_STEPS = [1, 2, 2.5, 5, 10] as const;

export function niceTop(
  max: number,
  { headroom = 1.1, empty = 100, steps = FINE_STEPS }: { headroom?: number; empty?: number; steps?: readonly number[] } = {},
): number {
  if (!(max > 0)) return empty;
  const raw = max * headroom;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = steps.find((x) => x * p >= raw) ?? 10;
  return step * p;
}
