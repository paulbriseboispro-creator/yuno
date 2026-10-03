// Barre latérale de la Console en mode Yuno CRM (club ou organisateur).
// Plan : docs/designs/YUNO_CRM_PLAN.md §5.1.
//
// Un compte CRM ne vend rien chez Yuno : pas de billetterie, de tables, de
// porte, de commandes ni de Stripe. Sa Console garde les mêmes cinq familles
// (Vue d'ensemble, Soirées, Marketing & CRM, Réglages) mais ne montre que ce
// qui marche sans vente Yuno. La même liste de chemins sert au garde de routes
// (`isCrmPathAllowed`) : une page de la Suite tapée à la main renvoie à
// l'accueil CRM. Une nouvelle page de la Console se classe ici ou n'existe pas
// en CRM (règle du CLAUDE.md).

import {
  LayoutGridIcon, UsersIcon, CalendarIcon, MailIcon, ZapIcon, MessageSquareIcon,
  RocketIcon, PlugIcon, StoreIcon, UserCheckIcon, LifeBuoyIcon, BarChart3Icon, CreditCardIcon, BotIcon,
} from 'lucide-react';
import type { SidebarNavGroup } from '@/components/app-shared';
import { SMS_MARKETING_LIVE } from '@/lib/smsMarketing';

export type ConsoleBase = '/owner' | '/organizer-app';

/** Accueil de la Console : `/owner/dashboard` pour un club, la racine pour un organisateur. */
export function crmHomePath(base: ConsoleBase): string {
  return base === '/owner' ? '/owner/dashboard' : '/organizer-app';
}

export function buildCrmNavGroups(t: (key: string) => string, base: ConsoleBase, metaLive: boolean): SidebarNavGroup[] {
  const isOrg = base === '/organizer-app';
  return [
    {
      label: t('sidebar.group.overview'),
      items: [
        { title: t('crm.nav.home'), path: crmHomePath(base), icon: <LayoutGridIcon />, exact: isOrg },
        { title: t('crm.nav.audience'), path: `${base}/crm/audience`, icon: <BarChart3Icon /> },
      ],
    },
    {
      label: t('sidebar.group.events'),
      items: [
        { title: t('crm.nav.nights'), path: `${base}/crm/nights`, icon: <CalendarIcon /> },
      ],
    },
    {
      label: t('sidebar.group.marketingCRM'),
      items: [
        { title: t('crm.nav.contacts'), path: `${base}/campaigns/contacts`, icon: <UsersIcon /> },
        {
          title: t('sidebar.emailMarketing'),
          path: `${base}/campaigns`,
          icon: <MailIcon />,
          subItems: [
            { title: t('sidebar.emailCampaigns'), path: `${base}/campaigns`, icon: <MailIcon /> },
            { title: t('sidebar.emailAutomations'), path: `${base}/campaigns/automations`, icon: <ZapIcon /> },
          ],
        },
        {
          title: t('sidebar.smsMarketing'),
          path: isOrg ? '/organizer-app/sms' : '/owner/sms-campaigns',
          icon: <MessageSquareIcon />,
          badge: SMS_MARKETING_LIVE ? undefined : t('smsc.soonBadge'),
        },
        {
          title: t('sidebar.ads'),
          path: `${base}/ads`,
          icon: <RocketIcon />,
          badge: metaLive ? undefined : t('integ.buildingBadge'),
        },
      ],
    },
    {
      label: t('sidebar.group.settings'),
      items: [
        { title: t('crm.nav.ticketing'), path: `${base}/integrations`, icon: <PlugIcon /> },
        isOrg
          ? { title: t('crm.nav.organization'), path: '/organizer-app/organization', icon: <StoreIcon /> }
          : { title: t('sidebar.myVenue'), path: '/owner/venue', icon: <StoreIcon /> },
        isOrg
          ? { title: t('crm.nav.team'), path: '/organizer-app/team', icon: <UserCheckIcon /> }
          : { title: t('crm.nav.team'), path: '/owner/managers', icon: <UserCheckIcon /> },
        { title: t('crm.nav.billing'), path: `${base}/crm/billing`, icon: <CreditCardIcon /> },
        { title: t('sidebar.aiAssistants'), path: `${base}/ai-assistants`, icon: <BotIcon /> },
        { title: t('sidebar.supportAccess'), path: `${base}/support-access`, icon: <LifeBuoyIcon /> },
      ],
    },
  ];
}

const CRM_PREFIXES: Record<ConsoleBase, string[]> = {
  '/owner': [
    '/owner/dashboard', '/owner/crm', '/owner/campaigns', '/owner/sms-campaigns', '/owner/sms',
    '/owner/ads', '/owner/integrations', '/owner/venue', '/owner/managers', '/owner/support-access', '/owner/ai-assistants',
    '/owner/help', '/owner/support', '/owner/notifications',
  ],
  '/organizer-app': [
    '/organizer-app/crm', '/organizer-app/campaigns', '/organizer-app/sms', '/organizer-app/ads',
    '/organizer-app/integrations', '/organizer-app/organization', '/organizer-app/profile',
    '/organizer-app/team', '/organizer-app/support-access', '/organizer-app/ai-assistants', '/organizer-app/help',
    '/organizer-app/support', '/organizer-app/notifications', '/organizer-app/dashboard',
  ],
};

/** Une page de la Console est-elle ouverte à un compte Yuno CRM ? */
export function isCrmPathAllowed(pathname: string, base: ConsoleBase): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === base || path === crmHomePath(base)) return true;
  return CRM_PREFIXES[base].some((p) => path === p || path.startsWith(`${p}/`));
}
