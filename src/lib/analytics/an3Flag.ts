/**
 * Analytics v3 : quel écran servir. `?v=3` force le nouveau, `?v=2` l'ancien ;
 * sans paramètre, `ANALYTICS_V3_DEFAULT` décide. Passé à `true` à la fin de la
 * phase 1 (docs/designs/ANALYTICS_REBUILD_PLAN.md) ; l'ancien écran disparaît
 * en phase 2.
 */
export const ANALYTICS_V3_DEFAULT = true;

export function isAnalyticsV3(params: URLSearchParams): boolean {
  const v = params.get('v');
  if (v === '3') return true;
  if (v === '2') return false;
  return ANALYTICS_V3_DEFAULT;
}
