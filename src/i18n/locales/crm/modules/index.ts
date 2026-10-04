import type { CrmDict, Triple } from './types';
import shell from './shell';
import notifications from './notifications';
import home from './home';

/** Toutes les clés de la Console Yuno CRM, un module par écran. */
export const CRM_DICT: CrmDict = {
  ...shell,
  ...notifications,
  ...home,
};

export function pickLanguage(index: 0 | 1 | 2): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(CRM_DICT)) out[k] = (v as Triple)[index];
  return out;
}
