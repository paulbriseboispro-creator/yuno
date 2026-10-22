import type { Triple } from '../../crm/modules/types';
import fromCrm from './fromCrm';
import tickets from './tickets';

/**
 * Toutes les clés des Analyses de Yuno Tickets (`ya.*`) : les textes des
 * Analyses de Yuno CRM, puis ce qui diffère pour Yuno Tickets (qui l'emporte).
 */
export const TIXANA_DICT: Record<string, Triple> = { ...fromCrm, ...tickets };

export function pickLanguage(index: 0 | 1 | 2): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(TIXANA_DICT)) out[k] = v[index];
  return out;
}
