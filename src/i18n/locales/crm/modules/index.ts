import type { CrmDict, Triple } from './types';
import shell from './shell';
import notifications from './notifications';
import home from './home';
import clients from './clients';
import segments from './segments';
import segmentCatalog from './segmentCatalog';
import imports from './imports';
import soon from './soon';
import smsSoon from './smsSoon';
import nights from './nights';
import guestlist from './guestlist';
import links from './links';
import connectors from './connectors';
import emails from './emails';
import emailTemplates from './emailTemplates';
import emailStudio from './emailStudio';
import emailSend from './emailSend';
import emailResult from './emailResult';
import emailAnalysis from './emailAnalysis';
import emailSettings from './emailSettings';
import account from './account';
import accountHelp from './accountHelp';
import yunits from './yunits';
import settings from './settings';
import analytics from './analytics';
import journey from './journey';
import automations from './automations';
import sms from './sms';
import pricing from './pricing';
import errors from './errors';
import signupPages from './signupPages';
import instagram from './instagram';
import login from './login';
import analysis from './analysis';
import holdout from './holdout';
import legal from './legal';

/** Toutes les clés de la Console Yuno CRM, un module par écran. */
export const CRM_DICT: CrmDict = {
  ...shell,
  ...notifications,
  ...home,
  ...clients,
  ...segments,
  ...segmentCatalog,
  ...imports,
  ...soon,
  ...smsSoon,
  ...signupPages,
  ...instagram,
  ...nights,
  ...guestlist,
  ...links,
  ...connectors,
  ...emails,
  ...emailTemplates,
  ...emailStudio,
  ...emailSend,
  ...emailResult,
  ...emailAnalysis,
  ...emailSettings,
  ...account,
  ...accountHelp,
  ...yunits,
  ...settings,
  ...analytics,
  ...journey,
  ...automations,
  ...sms,
  ...pricing,
  ...errors,
  ...login,
  ...analysis,
  ...holdout,
  ...legal,
};

export function pickLanguage(index: 0 | 1 | 2): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(CRM_DICT)) out[k] = (v as Triple)[index];
  return out;
}
