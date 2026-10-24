import type { Triple } from '../../crm/modules/types';
import fromCrm from './fromCrm';
import fromCrmClients from './fromCrmClients';
import tickets from './tickets';
import salesPillars from './salesPillars';
import night from './night';
import partners from './partners';
import traffic from './traffic';
import free from './free';
import journey from './journey';
import switchover from './switchover';
import ticketsClients from './ticketsClients';

/**
 * Toutes les clés des Analyses et des écrans Clients de Yuno Tickets (`ya.*`) :
 * les textes de Yuno CRM, puis ce qui diffère pour Yuno Tickets (qui l'emporte).
 */
export const TIXANA_DICT: Record<string, Triple> = { ...fromCrm, ...fromCrmClients, ...tickets, ...ticketsClients, ...salesPillars, ...night, ...partners, ...traffic, ...free, ...journey, ...switchover };

export function pickLanguage(index: 0 | 1 | 2): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(TIXANA_DICT)) out[k] = v[index];
  return out;
}
