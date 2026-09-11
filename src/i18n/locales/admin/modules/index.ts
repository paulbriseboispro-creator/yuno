import type { AdminDict, Triple } from './types';
import common from './common';
import layout from './layout';
import cockpit from './cockpit';
import growth from './growth';
import revenue from './revenue';
import product from './product';
import ai from './ai';
import customers from './customers';
import links from './links';
import venues from './venues';
import organizers from './organizers';
import agencies from './agencies';
import events from './events';
import people from './people';
import orders from './orders';
import demo from './demo';
import support from './support';
import alerts from './alerts';
import audit from './audit';
import feedback from './feedback';
import push from './push';
import automations from './automations';
import system from './system';
import marketing from './marketing';
import drinks from './drinks';

/** Toutes les clés du super admin, un module par page. */
export const ADMIN_DICT: AdminDict = {
  ...common, ...layout, ...cockpit, ...growth, ...revenue, ...product, ...ai, ...customers, ...links,
  ...venues, ...organizers, ...agencies, ...events, ...people, ...orders, ...demo, ...support, ...alerts,
  ...audit, ...feedback, ...push, ...automations, ...system, ...marketing, ...drinks,
};

export function pickLanguage(index: 0 | 1 | 2): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ADMIN_DICT)) out[k] = (v as Triple)[index];
  return out;
}
