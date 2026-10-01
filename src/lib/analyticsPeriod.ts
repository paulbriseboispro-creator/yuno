/**
 * La période des vues « toutes les soirées » d'Analytics (Ventes, Trafic,
 * Communauté) : un seul sélecteur, les mêmes six choix partout, dans l'URL
 * (`?period=`). Les RPC prennent des HEURES (`p_hours`, NULL = depuis toujours) ;
 * Ventes, qui compte en soirées terminées, les lit par `salesPeriodOf`.
 */
import type { SalesPeriod } from './salesOverview';

export type PeriodKey = '24h' | '48h' | '7d' | '30d' | '90d' | 'all';

export const PERIODS: readonly PeriodKey[] = ['24h', '48h', '7d', '30d', '90d', 'all'];
export const DEFAULT_PERIOD: PeriodKey = '30d';

const HOURS: Record<PeriodKey, number | null> = { '24h': 24, '48h': 48, '7d': 168, '30d': 720, '90d': 2160, all: null };

/** Heures de la période, `null` = depuis toujours. */
export function periodHours(p: PeriodKey): number | null {
  return HOURS[p];
}

/** Une valeur d'URL lisible, sinon la période par défaut (jamais un écran vide). */
export function parsePeriod(raw: string | null | undefined): PeriodKey {
  return raw && (PERIODS as readonly string[]).includes(raw) ? (raw as PeriodKey) : DEFAULT_PERIOD;
}

/** La même période, lue par Ventes (soirées terminées dont la fin tombe dans la fenêtre). */
export function salesPeriodOf(p: PeriodKey): SalesPeriod {
  return ({ '24h': 'd1', '48h': 'd2', '7d': 'd7', '30d': 'd30', '90d': 'd90', all: 'all' } as const)[p];
}

/** La fenêtre de la période en dates ISO (pour les blocs qui lisent encore `from` / `to`). « Tout » part de 2020. */
export function periodWindow(p: PeriodKey, now: Date = new Date()): { from: string; to: string } {
  const h = HOURS[p];
  const from = h == null ? new Date('2020-01-01T00:00:00Z') : new Date(now.getTime() - h * 3_600_000);
  return { from: from.toISOString(), to: now.toISOString() };
}
