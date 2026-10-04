import type { CrmDict, Triple } from './types';
import shell from './shell';
import notifications from './notifications';
import home from './home';
import clients from './clients';
import segments from './segments';
import imports from './imports';
import soon from './soon';
import nights from './nights';
import connectors from './connectors';
import emails from './emails';
import emailTemplates from './emailTemplates';
import emailStudio from './emailStudio';
import emailSend from './emailSend';
import emailResult from './emailResult';
import emailAnalysis from './emailAnalysis';

/** Toutes les clés de la Console Yuno CRM, un module par écran. */
export const CRM_DICT: CrmDict = {
  ...shell,
  ...notifications,
  ...home,
  ...clients,
  ...segments,
  ...imports,
  ...soon,
  ...nights,
  ...connectors,
  ...emails,
  ...emailTemplates,
  ...emailStudio,
  ...emailSend,
  ...emailResult,
  ...emailAnalysis,
};

export function pickLanguage(index: 0 | 1 | 2): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(CRM_DICT)) out[k] = (v as Triple)[index];
  return out;
}
