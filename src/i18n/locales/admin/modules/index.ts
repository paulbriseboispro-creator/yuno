import type { AdminDict, Triple } from './types';
import common from './common';
import layout from './layout';
import cockpit from './cockpit';
import product from './product';
import ai from './ai';
import links from './links';
import venues from './venues';
import organizers from './organizers';
import agencies from './agencies';
import events from './events';
import people from './people';
import demo from './demo';
import alerts from './alerts';
import audit from './audit';
import feedback from './feedback';
import push from './push';
import automations from './automations';
import system from './system';
import marketing from './marketing';
import drinks from './drinks';
import signups from './signups';
import crmAdmin from './crmAdmin';
import crmAdmin2 from './crmAdmin2';
import crmAdmin3 from './crmAdmin3';
import crmAdmin4 from './crmAdmin4';
import crmAdminAnalysis from './crmAdminAnalysis';
import crmAdminFounder from './crmAdminFounder';
import crmAdminInvite from './crmAdminInvite';
import crmAdminSms from './crmAdminSms';
import crmAdminCustomerBasis from './crmAdminCustomerBasis';
import shell from './shell';
import today from './today';
import pros from './pros';
import clients from './clients';
import pilotage from './pilotage';
import money from './money';
import legal from './legal';
import comms from './comms';

/** Toutes les clés du super admin, un module par page. */
export const ADMIN_DICT: AdminDict = {
  ...common, ...layout, ...cockpit, ...product, ...ai, ...links,
  ...venues, ...organizers, ...agencies, ...events, ...people, ...demo, ...alerts,
  ...audit, ...feedback, ...push, ...automations, ...system, ...marketing, ...drinks, ...signups, ...crmAdmin, ...crmAdmin2, ...crmAdmin3, ...crmAdmin4, ...crmAdminAnalysis, ...crmAdminFounder, ...crmAdminInvite, ...crmAdminSms, ...crmAdminCustomerBasis, ...shell, ...today, ...pros, ...clients, ...pilotage, ...money, ...legal, ...comms,
};

export function pickLanguage(index: 0 | 1 | 2): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ADMIN_DICT)) out[k] = (v as Triple)[index];
  return out;
}
