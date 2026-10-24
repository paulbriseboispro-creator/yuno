/**
 * Les vues de l'ancienne Analytics gardées dans les Analyses (bascule du 24/10)
 * et la fenêtre d'une période, partagées par `CommunityMore` et `KeptBlocks`.
 */
import type { AnaPeriod } from '@/tickets/analytics/data';

export type CommunityMoreView = 'subscribers' | 'purchase' | 'audience';
export const COMMUNITY_MORE: CommunityMoreView[] = ['subscribers', 'purchase', 'audience'];

const HOURS: Record<AnaPeriod, number> = { '24h': 24, '48h': 48, '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90, '12m': 24 * 365 };

/** La fenêtre (ISO) d'une période des Analyses, pour les composants de l'ancienne Analytics. */
export function periodWindow(period: AnaPeriod): { from: string; to: string } {
  const to = new Date();
  return { from: new Date(to.getTime() - HOURS[period] * 3_600_000).toISOString(), to: to.toISOString() };
}
