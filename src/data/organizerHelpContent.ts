// Organizer Help Center — complete content structure
// All text via i18n keys — real content in src/i18n/data.ts (namespace ohelp.org.*).
//
// STRUCTURE: mirrors the organizer dashboard sidebar (src/components/org-sidebar.tsx)
// page-by-page. Top groups map 1:1 to the menu groups (Overview, Events,
// Marketing & CRM, Ecosystem, Finance, Settings), each article maps to a menu
// page. "Getting started" is the intro. Rendered by OwnerHelpCenter (shared
// component) via OrganizerHelpCenter, which passes these categories in.
//
// Reuses the OwnerHelp* types and the shared glossaryTerms from ownerHelpContent.

import type { OwnerHelpCategory } from './ownerHelpContent';

// All organizer action links share one "open this page" label.
const OPEN = 'ohelp.org.openPage';

export const organizerHelpCategories: OwnerHelpCategory[] = [
  // ─── GETTING STARTED (intro) ───
  {
    id: 'getting-started',
    labelKey: 'ohelp.cat.gettingStarted',
    icon: 'Rocket',
    articles: [
      {
        id: 'org-what-is',
        titleKey: 'ohelp.org.whatis.title',
        descKey: 'ohelp.org.whatis.desc',
        icon: 'Lightbulb',
        quickStart: true,
        relatedArticleIds: ['org-onboarding', 'org-dashboard-tour', 'org-payments'],
        keywords: ['organizer', 'organisateur', 'bde', 'yuno', 'what is', "c'est quoi", 'qué es', 'promoter', 'events', 'soirées'],
        sections: [
          { headingKey: 'ohelp.org.whatis.s1h', bodyKey: 'ohelp.org.whatis.s1b' },
          { headingKey: 'ohelp.org.whatis.s2h', bodyKey: 'ohelp.org.whatis.s2b' },
          { headingKey: 'ohelp.org.whatis.s3h', bodyKey: 'ohelp.org.whatis.s3b' },
          { headingKey: 'ohelp.org.whatis.s4h', bodyKey: 'ohelp.org.whatis.s4b' },
          { headingKey: 'ohelp.org.whatis.s5h', bodyKey: 'ohelp.org.whatis.s5b', type: 'tip' },
        ],
      },
      {
        id: 'org-onboarding',
        titleKey: 'ohelp.org.onboarding.title',
        descKey: 'ohelp.org.onboarding.desc',
        icon: 'CheckCircle',
        quickStart: true,
        relatedArticleIds: ['org-payments', 'org-organization', 'org-dashboard-tour'],
        keywords: ['onboarding', 'setup', 'configuration', 'démarrage', 'stripe', 'steps', 'étapes', 'empezar'],
        sections: [
          { headingKey: 'ohelp.org.onboarding.s1h', bodyKey: 'ohelp.org.onboarding.s1b' },
          { headingKey: 'ohelp.org.onboarding.s2h', bodyKey: 'ohelp.org.onboarding.s2b', screenshotUrl: '/help/org-onboarding.png' },
          { headingKey: 'ohelp.org.onboarding.s3h', bodyKey: 'ohelp.org.onboarding.s3b', type: 'steps' },
          { headingKey: 'ohelp.org.onboarding.s4h', bodyKey: 'ohelp.org.onboarding.s4b', type: 'tip' },
        ],
      },
      {
        id: 'org-dashboard-tour',
        titleKey: 'ohelp.org.dashtour.title',
        descKey: 'ohelp.org.dashtour.desc',
        icon: 'Map',
        relatedArticleIds: ['org-dashboard', 'org-events', 'org-payments'],
        keywords: ['dashboard', 'menu', 'navigation', 'sidebar', 'tour', 'visite', 'recorrido'],
        sections: [
          { headingKey: 'ohelp.org.dashtour.s1h', bodyKey: 'ohelp.org.dashtour.s1b' },
          { headingKey: 'ohelp.org.dashtour.s2h', bodyKey: 'ohelp.org.dashtour.s2b', screenshotUrl: '/help/org-dashboard.png' },
          { headingKey: 'ohelp.org.dashtour.s3h', bodyKey: 'ohelp.org.dashtour.s3b' },
          { headingKey: 'ohelp.org.dashtour.s4h', bodyKey: 'ohelp.org.dashtour.s4b', type: 'tip' },
        ],
      },
    ],
  },

  // ─── OVERVIEW ───
  {
    id: 'overview',
    labelKey: 'sidebar.group.overview',
    icon: 'LayoutGrid',
    articles: [
      {
        id: 'org-dashboard',
        titleKey: 'ohelp.org.dashboard.title',
        descKey: 'ohelp.org.dashboard.desc',
        icon: 'LayoutDashboard',
        actionLink: { labelKey: OPEN, path: '/' },
        relatedArticleIds: ['org-analytics', 'org-events', 'org-payments'],
        keywords: ['dashboard', 'tableau de bord', 'kpi', 'revenue', 'revenu', 'next event', 'panel'],
        sections: [
          { headingKey: 'ohelp.org.dashboard.s1h', bodyKey: 'ohelp.org.dashboard.s1b' },
          { headingKey: 'ohelp.org.dashboard.s2h', bodyKey: 'ohelp.org.dashboard.s2b', screenshotUrl: '/help/org-dashboard.png' },
          { headingKey: 'ohelp.org.dashboard.s3h', bodyKey: 'ohelp.org.dashboard.s3b' },
          { headingKey: 'ohelp.org.dashboard.s4h', bodyKey: 'ohelp.org.dashboard.s4b', type: 'tip' },
        ],
      },
      {
        id: 'org-analytics',
        titleKey: 'ohelp.org.analytics.title',
        descKey: 'ohelp.org.analytics.desc',
        icon: 'BarChart3',
        actionLink: { labelKey: OPEN, path: '/analytics' },
        relatedArticleIds: ['org-dashboard', 'org-customers', 'org-events'],
        keywords: ['analytics', 'analytique', 'stats', 'reports', 'rapports', 'funnel', 'conversion', 'analítica'],
        sections: [
          { headingKey: 'ohelp.org.analytics.s1h', bodyKey: 'ohelp.org.analytics.s1b' },
          { headingKey: 'ohelp.org.analytics.s2h', bodyKey: 'ohelp.org.analytics.s2b', screenshotUrl: '/help/org-analytics.png' },
          { headingKey: 'ohelp.org.analytics.s3h', bodyKey: 'ohelp.org.analytics.s3b' },
          { headingKey: 'ohelp.org.analytics.s4h', bodyKey: 'ohelp.org.analytics.s4b', type: 'tip' },
        ],
      },
    ],
  },

  // ─── EVENTS ───
  {
    id: 'events',
    labelKey: 'sidebar.group.events',
    icon: 'Calendar',
    articles: [
      {
        id: 'org-events',
        titleKey: 'ohelp.org.events.title',
        descKey: 'ohelp.org.events.desc',
        icon: 'CalendarDays',
        quickStart: true,
        actionLink: { labelKey: OPEN, path: '/events' },
        relatedArticleIds: ['org-ticketing', 'org-guest-list', 'org-partners', 'org-event-live'],
        keywords: ['events', 'événements', 'soirées', 'create event', 'créer', 'co-event', 'eventos'],
        sections: [
          { headingKey: 'ohelp.org.events.s1h', bodyKey: 'ohelp.org.events.s1b' },
          { headingKey: 'ohelp.org.events.s2h', bodyKey: 'ohelp.org.events.s2b', screenshotUrl: '/help/org-events.png' },
          { headingKey: 'ohelp.org.events.s3h', bodyKey: 'ohelp.org.events.s3b', type: 'steps' },
          { headingKey: 'ohelp.org.events.s4h', bodyKey: 'ohelp.org.events.s4b' },
          { headingKey: 'ohelp.org.events.s5h', bodyKey: 'ohelp.org.events.s5b', type: 'tip' },
          { headingKey: 'ohelp.org.events.s6h', bodyKey: 'ohelp.org.events.s6b', type: 'warning' },
        ],
      },
      {
        id: 'org-ticketing',
        titleKey: 'ohelp.org.ticketing.title',
        descKey: 'ohelp.org.ticketing.desc',
        icon: 'Ticket',
        actionLink: { labelKey: OPEN, path: '/ticketing' },
        relatedArticleIds: ['org-events', 'org-payments', 'org-guest-list'],
        keywords: ['ticketing', 'billetterie', 'tickets', 'billets', 'rounds', 'paliers', 'presale', 'prévente', 'entradas'],
        sections: [
          { headingKey: 'ohelp.org.ticketing.s1h', bodyKey: 'ohelp.org.ticketing.s1b' },
          { headingKey: 'ohelp.org.ticketing.s2h', bodyKey: 'ohelp.org.ticketing.s2b', screenshotUrl: '/help/org-ticketing.png' },
          { headingKey: 'ohelp.org.ticketing.s3h', bodyKey: 'ohelp.org.ticketing.s3b' },
          { headingKey: 'ohelp.org.ticketing.s4h', bodyKey: 'ohelp.org.ticketing.s4b', type: 'steps' },
          { headingKey: 'ohelp.org.ticketing.s5h', bodyKey: 'ohelp.org.ticketing.s5b', type: 'tip' },
          { headingKey: 'ohelp.org.ticketing.s6h', bodyKey: 'ohelp.org.ticketing.s6b', type: 'warning' },
        ],
      },
      {
        id: 'org-guest-list',
        titleKey: 'ohelp.org.guestlist.title',
        descKey: 'ohelp.org.guestlist.desc',
        icon: 'ClipboardList',
        actionLink: { labelKey: OPEN, path: '/guest-list' },
        relatedArticleIds: ['org-checkin', 'org-promoters', 'org-events'],
        keywords: ['guest list', 'liste invités', 'quota', 'free entry', 'entrée gratuite', 'lista de invitados'],
        sections: [
          { headingKey: 'ohelp.org.guestlist.s1h', bodyKey: 'ohelp.org.guestlist.s1b' },
          { headingKey: 'ohelp.org.guestlist.s2h', bodyKey: 'ohelp.org.guestlist.s2b', screenshotUrl: '/help/org-guest-list.png' },
          { headingKey: 'ohelp.org.guestlist.s3h', bodyKey: 'ohelp.org.guestlist.s3b', type: 'steps' },
          { headingKey: 'ohelp.org.guestlist.s4h', bodyKey: 'ohelp.org.guestlist.s4b' },
          { headingKey: 'ohelp.org.guestlist.s5h', bodyKey: 'ohelp.org.guestlist.s5b', type: 'tip' },
        ],
      },
      {
        id: 'org-checkin',
        titleKey: 'ohelp.org.checkin.title',
        descKey: 'ohelp.org.checkin.desc',
        icon: 'QrCode',
        quickStart: true,
        actionLink: { labelKey: OPEN, path: '/checkin' },
        relatedArticleIds: ['org-guest-list', 'org-team', 'org-event-live'],
        keywords: ['check-in', 'checkin', 'scan', 'qr', 'door', 'porte', 'entrée', 'bouncer', 'videur', 'escaneo'],
        sections: [
          { headingKey: 'ohelp.org.checkin.s1h', bodyKey: 'ohelp.org.checkin.s1b' },
          { headingKey: 'ohelp.org.checkin.s2h', bodyKey: 'ohelp.org.checkin.s2b', screenshotUrl: '/help/org-checkin.png' },
          { headingKey: 'ohelp.org.checkin.s3h', bodyKey: 'ohelp.org.checkin.s3b', type: 'steps' },
          { headingKey: 'ohelp.org.checkin.s4h', bodyKey: 'ohelp.org.checkin.s4b' },
          { headingKey: 'ohelp.org.checkin.s5h', bodyKey: 'ohelp.org.checkin.s5b', type: 'warning' },
        ],
      },
      {
        id: 'org-djs',
        titleKey: 'ohelp.org.djs.title',
        descKey: 'ohelp.org.djs.desc',
        icon: 'Music',
        actionLink: { labelKey: OPEN, path: '/djs' },
        relatedArticleIds: ['org-events', 'org-team'],
        keywords: ['djs', 'lineup', 'programmation', 'set', 'music', 'musique'],
        sections: [
          { headingKey: 'ohelp.org.djs.s1h', bodyKey: 'ohelp.org.djs.s1b' },
          { headingKey: 'ohelp.org.djs.s2h', bodyKey: 'ohelp.org.djs.s2b', screenshotUrl: '/help/org-djs.png' },
          { headingKey: 'ohelp.org.djs.s3h', bodyKey: 'ohelp.org.djs.s3b', type: 'steps' },
          { headingKey: 'ohelp.org.djs.s4h', bodyKey: 'ohelp.org.djs.s4b', type: 'tip' },
        ],
      },
      {
        id: 'org-event-live',
        titleKey: 'ohelp.org.eventlive.title',
        descKey: 'ohelp.org.eventlive.desc',
        icon: 'Radio',
        relatedArticleIds: ['org-checkin', 'org-dashboard', 'org-events'],
        keywords: ['live', 'en direct', 'event night', 'soirée', 'real-time', 'temps réel', 'en vivo'],
        sections: [
          { headingKey: 'ohelp.org.eventlive.s1h', bodyKey: 'ohelp.org.eventlive.s1b' },
          { headingKey: 'ohelp.org.eventlive.s2h', bodyKey: 'ohelp.org.eventlive.s2b' },
          { headingKey: 'ohelp.org.eventlive.s3h', bodyKey: 'ohelp.org.eventlive.s3b' },
          { headingKey: 'ohelp.org.eventlive.s4h', bodyKey: 'ohelp.org.eventlive.s4b', type: 'tip' },
        ],
      },
    ],
  },

  // ─── MARKETING & CRM ───
  {
    id: 'marketing-crm',
    labelKey: 'sidebar.group.marketingCRM',
    icon: 'Heart',
    articles: [
      {
        id: 'org-customers',
        titleKey: 'ohelp.org.customers.title',
        descKey: 'ohelp.org.customers.desc',
        icon: 'Users',
        actionLink: { labelKey: OPEN, path: '/customers' },
        relatedArticleIds: ['org-campaigns', 'org-analytics'],
        keywords: ['customers', 'clients', 'crm', 'segments', 'export', 'clientes'],
        sections: [
          { headingKey: 'ohelp.org.customers.s1h', bodyKey: 'ohelp.org.customers.s1b' },
          { headingKey: 'ohelp.org.customers.s2h', bodyKey: 'ohelp.org.customers.s2b', screenshotUrl: '/help/org-customers.png' },
          { headingKey: 'ohelp.org.customers.s3h', bodyKey: 'ohelp.org.customers.s3b' },
          { headingKey: 'ohelp.org.customers.s4h', bodyKey: 'ohelp.org.customers.s4b', type: 'tip' },
        ],
      },
      {
        id: 'org-campaigns',
        titleKey: 'ohelp.org.campaigns.title',
        descKey: 'ohelp.org.campaigns.desc',
        icon: 'Mail',
        actionLink: { labelKey: OPEN, path: '/campaigns' },
        relatedArticleIds: ['org-customers', 'org-events'],
        keywords: ['campaigns', 'campagnes', 'email', 'newsletter', 'marketing', 'campañas'],
        sections: [
          { headingKey: 'ohelp.org.campaigns.s1h', bodyKey: 'ohelp.org.campaigns.s1b' },
          { headingKey: 'ohelp.org.campaigns.s2h', bodyKey: 'ohelp.org.campaigns.s2b', screenshotUrl: '/help/org-campaigns.png' },
          { headingKey: 'ohelp.org.campaigns.s3h', bodyKey: 'ohelp.org.campaigns.s3b', type: 'steps' },
          { headingKey: 'ohelp.org.campaigns.s4h', bodyKey: 'ohelp.org.campaigns.s4b' },
          { headingKey: 'ohelp.org.campaigns.s5h', bodyKey: 'ohelp.org.campaigns.s5b', type: 'tip' },
        ],
      },
      {
        id: 'org-promoters',
        titleKey: 'ohelp.org.promoters.title',
        descKey: 'ohelp.org.promoters.desc',
        icon: 'Megaphone',
        actionLink: { labelKey: OPEN, path: '/promoters' },
        relatedArticleIds: ['org-guest-list', 'org-checkin', 'org-events'],
        keywords: ['promoters', 'promoteurs', 'commission', 'guest list', 'sales', 'ventes', 'promotores'],
        sections: [
          { headingKey: 'ohelp.org.promoters.s1h', bodyKey: 'ohelp.org.promoters.s1b' },
          { headingKey: 'ohelp.org.promoters.s2h', bodyKey: 'ohelp.org.promoters.s2b', screenshotUrl: '/help/org-promoters.png' },
          { headingKey: 'ohelp.org.promoters.s3h', bodyKey: 'ohelp.org.promoters.s3b', type: 'steps' },
          { headingKey: 'ohelp.org.promoters.s4h', bodyKey: 'ohelp.org.promoters.s4b' },
          { headingKey: 'ohelp.org.promoters.s5h', bodyKey: 'ohelp.org.promoters.s5b', type: 'tip' },
        ],
      },
    ],
  },

  // ─── ECOSYSTEM ───
  {
    id: 'ecosystem',
    labelKey: 'ohelp.orgcat.ecosystem',
    icon: 'Handshake',
    articles: [
      {
        id: 'org-partners',
        titleKey: 'ohelp.org.partners.title',
        descKey: 'ohelp.org.partners.desc',
        icon: 'Handshake',
        quickStart: true,
        actionLink: { labelKey: OPEN, path: '/partners' },
        relatedArticleIds: ['org-events', 'org-payments'],
        keywords: ['partners', 'partenaires', 'clubs', 'venue', 'lieu', 'co-event', 'split', 'socios'],
        sections: [
          { headingKey: 'ohelp.org.partners.s1h', bodyKey: 'ohelp.org.partners.s1b' },
          { headingKey: 'ohelp.org.partners.s2h', bodyKey: 'ohelp.org.partners.s2b', screenshotUrl: '/help/org-partners.png' },
          { headingKey: 'ohelp.org.partners.s3h', bodyKey: 'ohelp.org.partners.s3b', type: 'steps' },
          { headingKey: 'ohelp.org.partners.s4h', bodyKey: 'ohelp.org.partners.s4b' },
          { headingKey: 'ohelp.org.partners.s5h', bodyKey: 'ohelp.org.partners.s5b', type: 'tip' },
        ],
      },
      {
        id: 'org-team',
        titleKey: 'ohelp.org.team.title',
        descKey: 'ohelp.org.team.desc',
        icon: 'Shield',
        actionLink: { labelKey: OPEN, path: '/team' },
        relatedArticleIds: ['org-checkin', 'org-djs'],
        keywords: ['team', 'équipe', 'staff', 'roles', 'permissions', 'pin', 'equipo'],
        sections: [
          { headingKey: 'ohelp.org.team.s1h', bodyKey: 'ohelp.org.team.s1b' },
          { headingKey: 'ohelp.org.team.s2h', bodyKey: 'ohelp.org.team.s2b', screenshotUrl: '/help/org-team.png' },
          { headingKey: 'ohelp.org.team.s3h', bodyKey: 'ohelp.org.team.s3b', type: 'steps' },
          { headingKey: 'ohelp.org.team.s4h', bodyKey: 'ohelp.org.team.s4b', type: 'tip' },
        ],
      },
      {
        id: 'org-profile',
        titleKey: 'ohelp.org.profile.title',
        descKey: 'ohelp.org.profile.desc',
        icon: 'Globe',
        actionLink: { labelKey: OPEN, path: '/profile' },
        relatedArticleIds: ['org-organization', 'org-events'],
        keywords: ['profile', 'profil', 'public', 'page', 'followers', 'abonnés', 'perfil'],
        sections: [
          { headingKey: 'ohelp.org.profile.s1h', bodyKey: 'ohelp.org.profile.s1b' },
          { headingKey: 'ohelp.org.profile.s2h', bodyKey: 'ohelp.org.profile.s2b', screenshotUrl: '/help/org-profile.png' },
          { headingKey: 'ohelp.org.profile.s3h', bodyKey: 'ohelp.org.profile.s3b' },
          { headingKey: 'ohelp.org.profile.s4h', bodyKey: 'ohelp.org.profile.s4b', type: 'tip' },
        ],
      },
    ],
  },

  // ─── FINANCE ───
  {
    id: 'finance',
    labelKey: 'ohelp.orgcat.finance',
    icon: 'Wallet',
    articles: [
      {
        id: 'org-payments',
        titleKey: 'ohelp.org.payments.title',
        descKey: 'ohelp.org.payments.desc',
        icon: 'Wallet',
        quickStart: true,
        actionLink: { labelKey: OPEN, path: '/payments' },
        relatedArticleIds: ['org-onboarding', 'org-invoices', 'org-refunds'],
        keywords: ['payments', 'paiements', 'stripe', 'connect', 'payout', 'virement', 'pagos'],
        sections: [
          { headingKey: 'ohelp.org.payments.s1h', bodyKey: 'ohelp.org.payments.s1b' },
          { headingKey: 'ohelp.org.payments.s2h', bodyKey: 'ohelp.org.payments.s2b', screenshotUrl: '/help/org-payments.png' },
          { headingKey: 'ohelp.org.payments.s3h', bodyKey: 'ohelp.org.payments.s3b', type: 'steps' },
          { headingKey: 'ohelp.org.payments.s4h', bodyKey: 'ohelp.org.payments.s4b' },
          { headingKey: 'ohelp.org.payments.s5h', bodyKey: 'ohelp.org.payments.s5b', type: 'warning' },
        ],
      },
      {
        id: 'org-invoices',
        titleKey: 'ohelp.org.invoices.title',
        descKey: 'ohelp.org.invoices.desc',
        icon: 'Receipt',
        actionLink: { labelKey: OPEN, path: '/invoices' },
        relatedArticleIds: ['org-accounting', 'org-payments'],
        keywords: ['invoices', 'factures', 'csv', 'export', 'vat', 'tva', 'facturas'],
        sections: [
          { headingKey: 'ohelp.org.invoices.s1h', bodyKey: 'ohelp.org.invoices.s1b' },
          { headingKey: 'ohelp.org.invoices.s2h', bodyKey: 'ohelp.org.invoices.s2b', screenshotUrl: '/help/org-invoices.png' },
          { headingKey: 'ohelp.org.invoices.s3h', bodyKey: 'ohelp.org.invoices.s3b' },
          { headingKey: 'ohelp.org.invoices.s4h', bodyKey: 'ohelp.org.invoices.s4b', type: 'tip' },
        ],
      },
      {
        id: 'org-accounting',
        titleKey: 'ohelp.org.accounting.title',
        descKey: 'ohelp.org.accounting.desc',
        icon: 'FileText',
        actionLink: { labelKey: OPEN, path: '/accounting' },
        relatedArticleIds: ['org-invoices', 'org-payments', 'org-refunds'],
        keywords: ['accounting', 'comptabilité', 'compta', 'revenue', 'revenu', 'fees', 'frais', 'contabilidad'],
        sections: [
          { headingKey: 'ohelp.org.accounting.s1h', bodyKey: 'ohelp.org.accounting.s1b' },
          { headingKey: 'ohelp.org.accounting.s2h', bodyKey: 'ohelp.org.accounting.s2b', screenshotUrl: '/help/org-accounting.png' },
          { headingKey: 'ohelp.org.accounting.s3h', bodyKey: 'ohelp.org.accounting.s3b' },
          { headingKey: 'ohelp.org.accounting.s4h', bodyKey: 'ohelp.org.accounting.s4b', type: 'tip' },
        ],
      },
      {
        id: 'org-refunds',
        titleKey: 'ohelp.org.refunds.title',
        descKey: 'ohelp.org.refunds.desc',
        icon: 'Undo2',
        actionLink: { labelKey: OPEN, path: '/refunds' },
        relatedArticleIds: ['org-payments', 'org-accounting'],
        keywords: ['refunds', 'remboursements', 'refund', 'cancel', 'annuler', 'reembolsos'],
        sections: [
          { headingKey: 'ohelp.org.refunds.s1h', bodyKey: 'ohelp.org.refunds.s1b' },
          { headingKey: 'ohelp.org.refunds.s2h', bodyKey: 'ohelp.org.refunds.s2b', screenshotUrl: '/help/org-refunds.png' },
          { headingKey: 'ohelp.org.refunds.s3h', bodyKey: 'ohelp.org.refunds.s3b', type: 'steps' },
          { headingKey: 'ohelp.org.refunds.s4h', bodyKey: 'ohelp.org.refunds.s4b', type: 'warning' },
        ],
      },
    ],
  },

  // ─── SETTINGS ───
  {
    id: 'settings',
    labelKey: 'sidebar.group.settings',
    icon: 'Settings',
    articles: [
      {
        id: 'org-organization',
        titleKey: 'ohelp.org.organization.title',
        descKey: 'ohelp.org.organization.desc',
        icon: 'Settings',
        actionLink: { labelKey: OPEN, path: '/organization' },
        relatedArticleIds: ['org-profile', 'org-payments', 'org-team'],
        keywords: ['organization', 'organisation', 'settings', 'réglages', 'legal', 'siret', 'tva', 'organización'],
        sections: [
          { headingKey: 'ohelp.org.organization.s1h', bodyKey: 'ohelp.org.organization.s1b' },
          { headingKey: 'ohelp.org.organization.s2h', bodyKey: 'ohelp.org.organization.s2b', screenshotUrl: '/help/org-organization.png' },
          { headingKey: 'ohelp.org.organization.s3h', bodyKey: 'ohelp.org.organization.s3b' },
          { headingKey: 'ohelp.org.organization.s4h', bodyKey: 'ohelp.org.organization.s4b', type: 'tip' },
        ],
      },
    ],
  },
];
