// Agency Help Center — contenu du mode d'emploi de l'espace agence.
// Même moteur que le centre d'aide owner (OwnerHelpCenter), types partagés.
// Texte réel dans src/i18n/locales/{en,fr,es}.ts, namespace `ohelp.agc.*`.
//
// STRUCTURE : le guide miroir la sidebar du cockpit agence
// (agency-app-sidebar.tsx) : Démarrer, Vitrine publique, Équipe, Clubs Yuno,
// Clubs externes, Finance. Les chemins d'action relatifs pointent sous
// /agency-app ; le préfixe '~' cible les routes /affiliate/* du bras externe.

import type { OwnerHelpCategory } from './ownerHelpContent';

export const agencyHelpCategories: OwnerHelpCategory[] = [
  // ─── DÉMARRER ───
  {
    id: 'getting-started',
    labelKey: 'ohelp.agc.cat.gettingStarted',
    icon: 'Rocket',
    articles: [
      {
        id: 'agency-model',
        titleKey: 'ohelp.agc.model.title',
        descKey: 'ohelp.agc.model.desc',
        icon: 'Map',
        quickStart: true,
        relatedArticleIds: ['first-steps', 'showcase-hub'],
        keywords: ['modèle', 'model', 'agence', 'agency', 'bras', 'externe', 'cockpit', 'yuno', 'contrat', 'commencer', 'start', 'overview'],
        sections: [
          { headingKey: 'ohelp.agc.model.s1h', bodyKey: 'ohelp.agc.model.s1b', screenshotUrl: '/help/agency-model.svg' },
          { headingKey: 'ohelp.agc.model.s2h', bodyKey: 'ohelp.agc.model.s2b' },
          { headingKey: 'ohelp.agc.model.s3h', bodyKey: 'ohelp.agc.model.s3b' },
          { headingKey: 'ohelp.agc.model.s4h', bodyKey: 'ohelp.agc.model.s4b', type: 'tip' },
        ],
      },
      {
        id: 'first-steps',
        titleKey: 'ohelp.agc.firstSteps.title',
        descKey: 'ohelp.agc.firstSteps.desc',
        icon: 'ListOrdered',
        quickStart: true,
        actionLink: { labelKey: 'ohelp.agc.action.openShowcase', path: '/vitrine' },
        relatedArticleIds: ['agency-model', 'master-identity', 'invite-promoters'],
        keywords: ['premiers pas', 'first steps', 'setup', 'checklist', 'configurer', 'démarrer', 'onboarding'],
        sections: [
          { headingKey: 'ohelp.agc.firstSteps.s1h', bodyKey: 'ohelp.agc.firstSteps.s1b', type: 'steps' },
          { headingKey: 'ohelp.agc.firstSteps.s2h', bodyKey: 'ohelp.agc.firstSteps.s2b' },
        ],
      },
      {
        id: 'ai-assistant',
        titleKey: 'ohelp.agc.assistant.title',
        descKey: 'ohelp.agc.assistant.desc',
        icon: 'Sparkles',
        quickStart: true,
        relatedArticleIds: ['first-steps'],
        keywords: ['assistant', 'ia', 'ai', 'bras droit', 'chatbot', 'question', 'aide', 'help', 'copilote'],
        sections: [
          { headingKey: 'ohelp.agc.assistant.s1h', bodyKey: 'ohelp.agc.assistant.s1b' },
          { headingKey: 'ohelp.agc.assistant.s2h', bodyKey: 'ohelp.agc.assistant.s2b', type: 'example' },
          { headingKey: 'ohelp.agc.assistant.s3h', bodyKey: 'ohelp.agc.assistant.s3b', type: 'warning' },
        ],
      },
    ],
  },

  // ─── VITRINE PUBLIQUE ───
  {
    id: 'showcase',
    labelKey: 'ohelp.agc.cat.showcase',
    icon: 'Store',
    articles: [
      {
        id: 'showcase-hub',
        titleKey: 'ohelp.agc.showcase.title',
        descKey: 'ohelp.agc.showcase.desc',
        icon: 'Store',
        quickStart: true,
        actionLink: { labelKey: 'ohelp.agc.action.openShowcase', path: '/vitrine' },
        relatedArticleIds: ['master-identity', 'rp-page', 'linktree-page'],
        keywords: ['vitrine', 'showcase', 'pages publiques', 'public', 'complétude', 'checklist', 'partager', 'share'],
        sections: [
          { headingKey: 'ohelp.agc.showcase.s1h', bodyKey: 'ohelp.agc.showcase.s1b', screenshotUrl: '/help/agency-vitrine.svg' },
          { headingKey: 'ohelp.agc.showcase.s2h', bodyKey: 'ohelp.agc.showcase.s2b' },
          { headingKey: 'ohelp.agc.showcase.s3h', bodyKey: 'ohelp.agc.showcase.s3b', type: 'tip' },
        ],
      },
      {
        id: 'master-identity',
        titleKey: 'ohelp.agc.identity.title',
        descKey: 'ohelp.agc.identity.desc',
        icon: 'Building2',
        actionLink: { labelKey: 'ohelp.agc.action.openProfile', path: '/profile' },
        relatedArticleIds: ['showcase-hub', 'linktree-page'],
        keywords: ['profil', 'profile', 'identité', 'identity', 'logo', 'bio', 'instagram', 'tiktok', 'réseaux', 'socials', 'synchronisation', 'sync', 'maître', 'master', 'renommer', 'rename', 'nom', 'name', 'slug', 'url', 'lien', 'link', '30 jours'],
        sections: [
          { headingKey: 'ohelp.agc.identity.s1h', bodyKey: 'ohelp.agc.identity.s1b', screenshotUrl: '/help/agency-identity.svg' },
          { headingKey: 'ohelp.agc.identity.s2h', bodyKey: 'ohelp.agc.identity.s2b' },
          { headingKey: 'ohelp.agc.identity.s3h', bodyKey: 'ohelp.agc.identity.s3b', type: 'warning' },
          { headingKey: 'ohelp.agc.identity.s4h', bodyKey: 'ohelp.agc.identity.s4b' },
        ],
      },
      {
        id: 'rp-page',
        titleKey: 'ohelp.agc.rpPage.title',
        descKey: 'ohelp.agc.rpPage.desc',
        icon: 'Globe',
        actionLink: { labelKey: 'ohelp.agc.action.openShowcase', path: '/vitrine' },
        relatedArticleIds: ['linktree-page', 'external-catalog', 'contracts'],
        keywords: ['page rp', 'rp', 'marketplace', 'publique', 'public page', 'fiche soirée', 'event page', 'interstitiel', 'découverte', 'discovery'],
        sections: [
          { headingKey: 'ohelp.agc.rpPage.s1h', bodyKey: 'ohelp.agc.rpPage.s1b', screenshotUrl: '/help/agency-rp.svg' },
          { headingKey: 'ohelp.agc.rpPage.s2h', bodyKey: 'ohelp.agc.rpPage.s2b' },
          { headingKey: 'ohelp.agc.rpPage.s3h', bodyKey: 'ohelp.agc.rpPage.s3b' },
          { headingKey: 'ohelp.agc.rpPage.s4h', bodyKey: 'ohelp.agc.rpPage.s4b', type: 'tip' },
        ],
      },
      {
        id: 'linktree-page',
        titleKey: 'ohelp.agc.linktree.title',
        descKey: 'ohelp.agc.linktree.desc',
        icon: 'Hash',
        actionLink: { labelKey: 'ohelp.agc.action.openLinktreeSettings', path: '~/affiliate/settings' },
        relatedArticleIds: ['rp-page', 'master-identity', 'traffic'],
        keywords: ['linktree', 'slug', 'adresse', 'bio instagram', 'qr', 'qr code', 'tri', 'sort', 'trust stats', 'stats de confiance', 'agenda'],
        sections: [
          { headingKey: 'ohelp.agc.linktree.s1h', bodyKey: 'ohelp.agc.linktree.s1b', screenshotUrl: '/help/agency-linktree.svg' },
          { headingKey: 'ohelp.agc.linktree.s2h', bodyKey: 'ohelp.agc.linktree.s2b' },
          { headingKey: 'ohelp.agc.linktree.s3h', bodyKey: 'ohelp.agc.linktree.s3b' },
          { headingKey: 'ohelp.agc.linktree.s4h', bodyKey: 'ohelp.agc.linktree.s4b', type: 'tip' },
        ],
      },
    ],
  },

  // ─── ÉQUIPE ───
  {
    id: 'team',
    labelKey: 'ohelp.agc.cat.team',
    icon: 'Users',
    articles: [
      {
        id: 'invite-promoters',
        titleKey: 'ohelp.agc.invite.title',
        descKey: 'ohelp.agc.invite.desc',
        icon: 'UserPlus',
        actionLink: { labelKey: 'ohelp.agc.action.openPromoters', path: '/promoters' },
        relatedArticleIds: ['assignments-tracking', 'rules-pay'],
        keywords: ['inviter', 'invite', 'promoteur', 'promoter', 'roster', 'équipe', 'team', 'groupes', 'groups', 'membre'],
        sections: [
          { headingKey: 'ohelp.agc.invite.s1h', bodyKey: 'ohelp.agc.invite.s1b', type: 'steps' },
          { headingKey: 'ohelp.agc.invite.s2h', bodyKey: 'ohelp.agc.invite.s2b' },
          { headingKey: 'ohelp.agc.invite.s3h', bodyKey: 'ohelp.agc.invite.s3b' },
        ],
      },
      {
        id: 'assignments-tracking',
        titleKey: 'ohelp.agc.assign.title',
        descKey: 'ohelp.agc.assign.desc',
        icon: 'CalendarDays',
        actionLink: { labelKey: 'ohelp.agc.action.openAssignments', path: '~/affiliate/assignments' },
        relatedArticleIds: ['invite-promoters', 'guest-lists-agency'],
        keywords: ['assigner', 'assign', 'assignation', 'suivi', 'tracking', 'terrain', 'annonces', 'announcements', 'comms', 'communication'],
        sections: [
          { headingKey: 'ohelp.agc.assign.s1h', bodyKey: 'ohelp.agc.assign.s1b' },
          { headingKey: 'ohelp.agc.assign.s2h', bodyKey: 'ohelp.agc.assign.s2b' },
          { headingKey: 'ohelp.agc.assign.s3h', bodyKey: 'ohelp.agc.assign.s3b', type: 'tip' },
        ],
      },
      {
        id: 'guest-lists-agency',
        titleKey: 'ohelp.agc.guestlists.title',
        descKey: 'ohelp.agc.guestlists.desc',
        icon: 'ClipboardList',
        actionLink: { labelKey: 'ohelp.agc.action.openGuestLists', path: '/guest-lists' },
        relatedArticleIds: ['assignments-tracking', 'yuno-events'],
        keywords: ['guest list', 'guestlist', 'liste', 'invités', 'quota', 'part', 'entrées', 'porte', 'door'],
        sections: [
          { headingKey: 'ohelp.agc.guestlists.s1h', bodyKey: 'ohelp.agc.guestlists.s1b' },
          { headingKey: 'ohelp.agc.guestlists.s2h', bodyKey: 'ohelp.agc.guestlists.s2b' },
        ],
      },
      {
        id: 'rules-pay',
        titleKey: 'ohelp.agc.rules.title',
        descKey: 'ohelp.agc.rules.desc',
        icon: 'ShieldCheck',
        actionLink: { labelKey: 'ohelp.agc.action.openRules', path: '/rules' },
        relatedArticleIds: ['invite-promoters', 'settle-promoters'],
        keywords: ['règles', 'rules', 'commission', 'modèle', 'template', 'paie', 'pay', 'rémunération', 'par tête', 'guest list allocation'],
        sections: [
          { headingKey: 'ohelp.agc.rules.s1h', bodyKey: 'ohelp.agc.rules.s1b' },
          { headingKey: 'ohelp.agc.rules.s2h', bodyKey: 'ohelp.agc.rules.s2b' },
          { headingKey: 'ohelp.agc.rules.s3h', bodyKey: 'ohelp.agc.rules.s3b', type: 'example' },
        ],
      },
    ],
  },

  // ─── CLUBS YUNO ───
  {
    id: 'yuno-clubs',
    labelKey: 'ohelp.agc.cat.yunoClubs',
    icon: 'Building2',
    articles: [
      {
        id: 'contracts',
        titleKey: 'ohelp.agc.contracts.title',
        descKey: 'ohelp.agc.contracts.desc',
        icon: 'FileText',
        actionLink: { labelKey: 'ohelp.agc.action.openContracts', path: '/clubs' },
        relatedArticleIds: ['yuno-events', 'money-flow'],
        keywords: ['contrat', 'contract', 'club', 'signature', 'signer', 'partenariat', 'partnership', 'commission club'],
        sections: [
          { headingKey: 'ohelp.agc.contracts.s1h', bodyKey: 'ohelp.agc.contracts.s1b' },
          { headingKey: 'ohelp.agc.contracts.s2h', bodyKey: 'ohelp.agc.contracts.s2b', type: 'steps' },
          { headingKey: 'ohelp.agc.contracts.s3h', bodyKey: 'ohelp.agc.contracts.s3b' },
        ],
      },
      {
        id: 'yuno-events',
        titleKey: 'ohelp.agc.events.title',
        descKey: 'ohelp.agc.events.desc',
        icon: 'CalendarDays',
        actionLink: { labelKey: 'ohelp.agc.action.openEvents', path: '/events' },
        relatedArticleIds: ['contracts', 'assignments-tracking', 'stats-analytics'],
        keywords: ['soirée', 'event', 'événement', 'yuno', 'lien tracké', 'tracked link', 'vente', 'billets', 'tickets'],
        sections: [
          { headingKey: 'ohelp.agc.events.s1h', bodyKey: 'ohelp.agc.events.s1b' },
          { headingKey: 'ohelp.agc.events.s2h', bodyKey: 'ohelp.agc.events.s2b' },
          { headingKey: 'ohelp.agc.events.s3h', bodyKey: 'ohelp.agc.events.s3b', type: 'tip' },
        ],
      },
      {
        id: 'stats-analytics',
        titleKey: 'ohelp.agc.stats.title',
        descKey: 'ohelp.agc.stats.desc',
        icon: 'BarChart3',
        actionLink: { labelKey: 'ohelp.agc.action.openStats', path: '/stats' },
        relatedArticleIds: ['yuno-events', 'traffic', 'money-flow'],
        keywords: ['stats', 'statistiques', 'analytics', 'ventes', 'sales', 'graphiques', 'charts', 'classement', 'leaderboard', 'performance'],
        sections: [
          { headingKey: 'ohelp.agc.stats.s1h', bodyKey: 'ohelp.agc.stats.s1b', screenshotUrl: '/help/agency-stats.svg' },
          { headingKey: 'ohelp.agc.stats.s2h', bodyKey: 'ohelp.agc.stats.s2b' },
        ],
      },
    ],
  },

  // ─── CLUBS EXTERNES ───
  {
    id: 'external',
    labelKey: 'ohelp.agc.cat.external',
    icon: 'Globe',
    articles: [
      {
        id: 'external-catalog',
        titleKey: 'ohelp.agc.extCatalog.title',
        descKey: 'ohelp.agc.extCatalog.desc',
        icon: 'Map',
        actionLink: { labelKey: 'ohelp.agc.action.openVenues', path: '~/affiliate/venues' },
        relatedArticleIds: ['external-events', 'rp-page'],
        keywords: ['club externe', 'external club', 'venue', 'catalogue', 'catalog', 'hors yuno', 'partenaire', 'logo club', 'photos'],
        sections: [
          { headingKey: 'ohelp.agc.extCatalog.s1h', bodyKey: 'ohelp.agc.extCatalog.s1b' },
          { headingKey: 'ohelp.agc.extCatalog.s2h', bodyKey: 'ohelp.agc.extCatalog.s2b' },
        ],
      },
      {
        id: 'external-events',
        titleKey: 'ohelp.agc.extEvents.title',
        descKey: 'ohelp.agc.extEvents.desc',
        icon: 'CalendarDays',
        actionLink: { labelKey: 'ohelp.agc.action.openExtEvents', path: '~/affiliate/events' },
        relatedArticleIds: ['external-catalog', 'traffic'],
        keywords: ['soirée externe', 'external event', 'billetterie externe', 'récurrence', 'recurring', 'semaine', 'week', 'publier', 'publish'],
        sections: [
          { headingKey: 'ohelp.agc.extEvents.s1h', bodyKey: 'ohelp.agc.extEvents.s1b' },
          { headingKey: 'ohelp.agc.extEvents.s2h', bodyKey: 'ohelp.agc.extEvents.s2b' },
          { headingKey: 'ohelp.agc.extEvents.s3h', bodyKey: 'ohelp.agc.extEvents.s3b', type: 'tip' },
        ],
      },
      {
        id: 'traffic',
        titleKey: 'ohelp.agc.traffic.title',
        descKey: 'ohelp.agc.traffic.desc',
        icon: 'TrendingUp',
        actionLink: { labelKey: 'ohelp.agc.action.openTraffic', path: '~/affiliate/analytics' },
        relatedArticleIds: ['linktree-page', 'external-events'],
        keywords: ['trafic', 'traffic', 'vues', 'views', 'clics', 'clicks', 'conversion', 'commission externe', 'analytics'],
        sections: [
          { headingKey: 'ohelp.agc.traffic.s1h', bodyKey: 'ohelp.agc.traffic.s1b', screenshotUrl: '/help/agency-traffic.svg' },
          { headingKey: 'ohelp.agc.traffic.s2h', bodyKey: 'ohelp.agc.traffic.s2b' },
        ],
      },
    ],
  },

  // ─── FINANCE ───
  {
    id: 'finance',
    labelKey: 'ohelp.agc.cat.finance',
    icon: 'Wallet',
    articles: [
      {
        id: 'money-flow',
        titleKey: 'ohelp.agc.money.title',
        descKey: 'ohelp.agc.money.desc',
        icon: 'Wallet',
        actionLink: { labelKey: 'ohelp.agc.action.openFinance', path: '/finance' },
        relatedArticleIds: ['settle-promoters', 'contracts'],
        keywords: ['argent', 'money', 'finance', 'marge', 'margin', 'à recevoir', 'receivable', 'à reverser', 'owed', 'virement', 'iban'],
        sections: [
          { headingKey: 'ohelp.agc.money.s1h', bodyKey: 'ohelp.agc.money.s1b', screenshotUrl: '/help/agency-finance.svg' },
          { headingKey: 'ohelp.agc.money.s2h', bodyKey: 'ohelp.agc.money.s2b' },
          { headingKey: 'ohelp.agc.money.s3h', bodyKey: 'ohelp.agc.money.s3b', type: 'warning' },
        ],
      },
      {
        id: 'settle-promoters',
        titleKey: 'ohelp.agc.settle.title',
        descKey: 'ohelp.agc.settle.desc',
        icon: 'CheckCircle',
        actionLink: { labelKey: 'ohelp.agc.action.openFinance', path: '/finance' },
        relatedArticleIds: ['money-flow', 'rules-pay'],
        keywords: ['régler', 'settle', 'règlement', 'payout', 'promoteur', 'virement', 'confirmation', 'accusé', 'litige', 'dispute'],
        sections: [
          { headingKey: 'ohelp.agc.settle.s1h', bodyKey: 'ohelp.agc.settle.s1b', type: 'steps' },
          { headingKey: 'ohelp.agc.settle.s2h', bodyKey: 'ohelp.agc.settle.s2b' },
          { headingKey: 'ohelp.agc.settle.s3h', bodyKey: 'ohelp.agc.settle.s3b', type: 'warning' },
        ],
      },
    ],
  },
];
