import type { Triple } from '../../crm/modules/types';
import fromCrm from './fromCrm';
import tickets from './tickets';
import salesPillars from './salesPillars';
import night from './night';
import partners from './partners';
import traffic from './traffic';

/**
 * Toutes les clés des Analyses de Yuno Tickets (`ya.*`) : les textes des
 * Analyses de Yuno CRM, puis ce qui diffère pour Yuno Tickets (qui l'emporte).
 */
export const TIXANA_DICT: Record<string, Triple> = { ...fromCrm, ...tickets, ...salesPillars, ...night, ...partners, ...traffic };

export function pickLanguage(index: 0 | 1 | 2): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(TIXANA_DICT)) out[k] = v[index];
  return out;
}
