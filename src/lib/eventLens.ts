import type { AnalyticsFamily } from './analyticsNav';

/** Les trois lentilles d'UNE soirée : ses ventes, son trafic, sa communauté. */
export type EventLens = 'sales' | 'traffic' | 'community';

/** Où mène chaque lentille (famille + vue « par soirée »). */
export const LENS_ROUTE: Record<EventLens, { family: AnalyticsFamily; view: string }> = {
  sales: { family: 'sales', view: 'event' },
  traffic: { family: 'traffic', view: 'events' },
  community: { family: 'community', view: 'event' },
};
