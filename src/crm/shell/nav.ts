/**
 * La carte de la Console CRM : chaque écran, son adresse et sa place dans le
 * menu (dossier « Audit et passage au dev », section 01-02). Le menu, la
 * recherche et le fil d'Ariane lisent cette table ; une page nouvelle s'y
 * range ou n'existe pas.
 */
import type { IconName } from '@/crm/ui/Icon';

export const CRM_BASE = '/crm';

export const CRM_ROUTES = {
  home: '/crm',
  sales: '/crm/analytics/sales',
  traffic: '/crm/analytics/traffic',
  community: '/crm/analytics/community',
  journey: '/crm/journey',
  emails: '/crm/emails',
  emailCampaigns: '/crm/emails/campaigns',
  emailTemplates: '/crm/emails/templates',
  emailAnalysis: '/crm/emails/analysis',
  emailSettings: '/crm/emails/settings',
  emailResults: (id: string) => `/crm/emails/results/${id}`,
  emailStudio: (id: string) => `/crm/emails/studio/${id}`,
  emailSend: (id: string) => `/crm/emails/send/${id}`,
  sms: '/crm/sms',
  smsCampaigns: '/crm/sms/campaigns',
  smsTemplates: '/crm/sms/templates',
  smsAnalysis: '/crm/sms/analysis',
  smsSettings: '/crm/sms/settings',
  smsResults: (id: string) => `/crm/sms/results/${id}`,
  smsCompose: (id: string) => `/crm/sms/compose/${id}`,
  smsSend: (id: string) => `/crm/sms/send/${id}`,
  automations: '/crm/automations',
  instagram: '/crm/instagram',
  nights: '/crm/nights',
  nightsPast: '/crm/nights/past',
  night: (id: string) => `/crm/nights/${id}`,
  signupPages: '/crm/signup-pages',
  clients: '/crm/clients',
  segments: '/crm/segments',
  imports: '/crm/imports',
  connectors: '/crm/connectors',
  settings: '/crm/settings',
  account: '/crm/account',
  accountSection: (s: 'profile' | 'team' | 'billing' | 'notifications' | 'help') => `/crm/account/${s}`,
  notifications: '/crm/notifications',
  yunits: '/crm/yunits',
  pricing: '/crm/tarifs',
} as const;

/** Identifiant de l'écran courant, tel que le menu le connaît. */
export type CrmScreen =
  | 'accueil' | 'ventes' | 'trafic' | 'communaute' | 'parcours'
  | 'emails' | 'sms' | 'auto' | 'instagram'
  | 'avenir' | 'passees'
  | 'inscriptions' | 'clients' | 'segments' | 'imports'
  | 'connecteurs' | 'reglages' | 'aide' | 'compte' | 'notifications' | 'yunits' | '';

export function screenFor(pathname: string): CrmScreen {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/crm') return 'accueil';
  const rules: [string, CrmScreen][] = [
    ['/crm/analytics/sales', 'ventes'], ['/crm/analytics/traffic', 'trafic'], ['/crm/analytics/community', 'communaute'],
    ['/crm/analytics', 'ventes'], ['/crm/journey', 'parcours'],
    ['/crm/emails', 'emails'], ['/crm/sms', 'sms'], ['/crm/automations', 'auto'], ['/crm/instagram', 'instagram'],
    ['/crm/nights/past', 'passees'], ['/crm/nights', 'avenir'],
    ['/crm/signup-pages', 'inscriptions'], ['/crm/clients', 'clients'], ['/crm/segments', 'segments'], ['/crm/imports', 'imports'],
    ['/crm/connectors', 'connecteurs'], ['/crm/settings', 'reglages'], ['/crm/account/help', 'aide'], ['/crm/account', 'compte'],
    ['/crm/notifications', 'notifications'], ['/crm/yunits', 'yunits'],
  ];
  for (const [prefix, id] of rules) if (p === prefix || p.startsWith(prefix + '/')) return id;
  return '';
}

export type NavGroupKey = 'analyses' | 'campagnes' | 'soirees' | 'clients';

export const NAV_GROUP_CHILDREN: Record<NavGroupKey, CrmScreen[]> = {
  analyses: ['ventes', 'trafic', 'communaute', 'parcours'],
  campagnes: ['emails', 'sms', 'auto', 'instagram'],
  soirees: ['avenir', 'passees'],
  clients: ['clients', 'segments', 'imports'],
};

export const NAV_ICONS: Record<string, IconName> = {
  accueil: 'home', analyses: 'chart', campagnes: 'send', soirees: 'calendar',
  inscriptions: 'qr', clients: 'users', connecteurs: 'plug', reglages: 'sliders', aide: 'help',
};
