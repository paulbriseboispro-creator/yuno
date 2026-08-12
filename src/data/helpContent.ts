// Help Center content structure — all text via i18n keys
// Each article has sections with headings and body text.
//
// Screenshots: `screenshot` is either
//   - a screen name (e.g. 'explore') resolved per language to
//     /help/app/<lang>/<name>.webp — real app captures taken in EN/FR/ES
//     (mobile viewport, portrait);
//   - an absolute path (starts with '/') used as-is — shared desktop captures
//     from the owner dashboard (same convention as the in-app owner guide).

export interface HelpSection {
  headingKey: string;
  bodyKey: string;
  screenshot?: string;
}

export interface HelpArticle {
  id: string;
  titleKey: string;
  descKey: string;
  icon: string;
  sections: HelpSection[];
}

export interface HelpCategory {
  id: string;
  labelKey: string;
  articles: HelpArticle[];
}

export const helpContent: Record<string, HelpCategory[]> = {
  client: [
    {
      id: 'client-discover',
      labelKey: 'help.client.discoverLabel',
      articles: [
        {
          id: 'client-explore',
          titleKey: 'help.client.explore.title',
          descKey: 'help.client.explore.desc',
          icon: '🔍',
          sections: [
            { headingKey: 'help.client.explore.s1h', bodyKey: 'help.client.explore.s1b', screenshot: 'explore' },
            { headingKey: 'help.client.explore.s2h', bodyKey: 'help.client.explore.s2b' },
            { headingKey: 'help.client.explore.s3h', bodyKey: 'help.client.explore.s3b' },
          ],
        },
        {
          id: 'client-events',
          titleKey: 'help.client.events.title',
          descKey: 'help.client.events.desc',
          icon: '🎉',
          sections: [
            { headingKey: 'help.client.events.s1h', bodyKey: 'help.client.events.s1b', screenshot: 'event' },
            { headingKey: 'help.client.events.s2h', bodyKey: 'help.client.events.s2b' },
          ],
        },
      ],
    },
    {
      id: 'client-order',
      labelKey: 'help.client.orderLabel',
      articles: [
        {
          id: 'client-tickets',
          titleKey: 'help.client.tickets.title',
          descKey: 'help.client.tickets.desc',
          icon: '🎫',
          sections: [
            { headingKey: 'help.client.tickets.s1h', bodyKey: 'help.client.tickets.s1b', screenshot: 'tickets' },
            { headingKey: 'help.client.tickets.s2h', bodyKey: 'help.client.tickets.s2b' },
            { headingKey: 'help.client.tickets.s3h', bodyKey: 'help.client.tickets.s3b' },
          ],
        },
        {
          id: 'client-tables',
          titleKey: 'help.client.tables.title',
          descKey: 'help.client.tables.desc',
          icon: '🍾',
          sections: [
            { headingKey: 'help.client.tables.s1h', bodyKey: 'help.client.tables.s1b', screenshot: 'tables' },
            { headingKey: 'help.client.tables.s2h', bodyKey: 'help.client.tables.s2b' },
            { headingKey: 'help.client.tables.s3h', bodyKey: 'help.client.tables.s3b' },
          ],
        },
        {
          id: 'client-guestlist',
          titleKey: 'help.client.guestlist.title',
          descKey: 'help.client.guestlist.desc',
          icon: '📝',
          sections: [
            { headingKey: 'help.client.guestlist.s1h', bodyKey: 'help.client.guestlist.s1b', screenshot: 'guestlist' },
            { headingKey: 'help.client.guestlist.s2h', bodyKey: 'help.client.guestlist.s2b' },
          ],
        },
        {
          id: 'client-drinks',
          titleKey: 'help.client.drinks.title',
          descKey: 'help.client.drinks.desc',
          icon: '🍸',
          sections: [
            { headingKey: 'help.client.drinks.s1h', bodyKey: 'help.client.drinks.s1b', screenshot: 'drinks' },
            { headingKey: 'help.client.drinks.s2h', bodyKey: 'help.client.drinks.s2b' },
            { headingKey: 'help.client.drinks.s3h', bodyKey: 'help.client.drinks.s3b' },
          ],
        },
        {
          id: 'client-qr',
          titleKey: 'help.client.qr.title',
          descKey: 'help.client.qr.desc',
          icon: '📱',
          sections: [
            { headingKey: 'help.client.qr.s1h', bodyKey: 'help.client.qr.s1b', screenshot: 'myorders' },
            { headingKey: 'help.client.qr.s2h', bodyKey: 'help.client.qr.s2b' },
          ],
        },
      ],
    },
    {
      id: 'client-loyalty',
      labelKey: 'help.client.loyaltyLabel',
      articles: [
        {
          id: 'client-points',
          titleKey: 'help.client.points.title',
          descKey: 'help.client.points.desc',
          icon: '⭐',
          sections: [
            { headingKey: 'help.client.points.s1h', bodyKey: 'help.client.points.s1b', screenshot: 'profile' },
            { headingKey: 'help.client.points.s2h', bodyKey: 'help.client.points.s2b' },
          ],
        },
        {
          id: 'client-account',
          titleKey: 'help.client.account.title',
          descKey: 'help.client.account.desc',
          icon: '🔐',
          sections: [
            { headingKey: 'help.client.account.s1h', bodyKey: 'help.client.account.s1b', screenshot: 'settings' },
            { headingKey: 'help.client.account.s2h', bodyKey: 'help.client.account.s2b' },
            { headingKey: 'help.client.account.s3h', bodyKey: 'help.client.account.s3b' },
          ],
        },
        {
          id: 'client-payment-issues',
          titleKey: 'help.client.paymentIssues.title',
          descKey: 'help.client.paymentIssues.desc',
          icon: '💳',
          sections: [
            { headingKey: 'help.client.paymentIssues.s1h', bodyKey: 'help.client.paymentIssues.s1b' },
            { headingKey: 'help.client.paymentIssues.s2h', bodyKey: 'help.client.paymentIssues.s2b' },
          ],
        },
      ],
    },
  ],
  owner: [
    {
      id: 'owner-setup',
      labelKey: 'help.owner.setupLabel',
      articles: [
        {
          id: 'owner-venue-setup',
          titleKey: 'help.owner.venueSetup.title',
          descKey: 'help.owner.venueSetup.desc',
          icon: '🏢',
          sections: [
            { headingKey: 'help.owner.venueSetup.s1h', bodyKey: 'help.owner.venueSetup.s1b', screenshot: '/help/owner-venue.png' },
            { headingKey: 'help.owner.venueSetup.s2h', bodyKey: 'help.owner.venueSetup.s2b' },
            { headingKey: 'help.owner.venueSetup.s3h', bodyKey: 'help.owner.venueSetup.s3b' },
          ],
        },
        {
          id: 'owner-stripe',
          titleKey: 'help.owner.stripe.title',
          descKey: 'help.owner.stripe.desc',
          icon: '💰',
          sections: [
            { headingKey: 'help.owner.stripe.s1h', bodyKey: 'help.owner.stripe.s1b' },
            { headingKey: 'help.owner.stripe.s2h', bodyKey: 'help.owner.stripe.s2b' },
            { headingKey: 'help.owner.stripe.s3h', bodyKey: 'help.owner.stripe.s3b' },
          ],
        },
      ],
    },
    {
      id: 'owner-manage',
      labelKey: 'help.owner.manageLabel',
      articles: [
        {
          id: 'owner-menu-mgmt',
          titleKey: 'help.owner.menuMgmt.title',
          descKey: 'help.owner.menuMgmt.desc',
          icon: '📋',
          sections: [
            { headingKey: 'help.owner.menuMgmt.s1h', bodyKey: 'help.owner.menuMgmt.s1b', screenshot: '/help/owner-menu.png' },
            { headingKey: 'help.owner.menuMgmt.s2h', bodyKey: 'help.owner.menuMgmt.s2b' },
            { headingKey: 'help.owner.menuMgmt.s3h', bodyKey: 'help.owner.menuMgmt.s3b' },
          ],
        },
        {
          id: 'owner-events-mgmt',
          titleKey: 'help.owner.eventsMgmt.title',
          descKey: 'help.owner.eventsMgmt.desc',
          icon: '📅',
          sections: [
            { headingKey: 'help.owner.eventsMgmt.s1h', bodyKey: 'help.owner.eventsMgmt.s1b', screenshot: '/help/owner-events.png' },
            { headingKey: 'help.owner.eventsMgmt.s2h', bodyKey: 'help.owner.eventsMgmt.s2b' },
            { headingKey: 'help.owner.eventsMgmt.s3h', bodyKey: 'help.owner.eventsMgmt.s3b' },
          ],
        },
        {
          id: 'owner-staff-mgmt',
          titleKey: 'help.owner.staffMgmt.title',
          descKey: 'help.owner.staffMgmt.desc',
          icon: '👥',
          sections: [
            { headingKey: 'help.owner.staffMgmt.s1h', bodyKey: 'help.owner.staffMgmt.s1b', screenshot: '/help/owner-staff.png' },
            { headingKey: 'help.owner.staffMgmt.s2h', bodyKey: 'help.owner.staffMgmt.s2b' },
          ],
        },
        {
          id: 'owner-orders-flow',
          titleKey: 'help.owner.ordersFlow.title',
          descKey: 'help.owner.ordersFlow.desc',
          icon: '📦',
          sections: [
            { headingKey: 'help.owner.ordersFlow.s1h', bodyKey: 'help.owner.ordersFlow.s1b' },
            { headingKey: 'help.owner.ordersFlow.s2h', bodyKey: 'help.owner.ordersFlow.s2b' },
            { headingKey: 'help.owner.ordersFlow.s3h', bodyKey: 'help.owner.ordersFlow.s3b' },
          ],
        },
      ],
    },
    {
      id: 'owner-analytics',
      labelKey: 'help.owner.analyticsLabel',
      articles: [
        {
          id: 'owner-analytics-basics',
          titleKey: 'help.owner.analyticsBasics.title',
          descKey: 'help.owner.analyticsBasics.desc',
          icon: '📊',
          sections: [
            { headingKey: 'help.owner.analyticsBasics.s1h', bodyKey: 'help.owner.analyticsBasics.s1b', screenshot: '/help/owner-dashboard.png' },
            { headingKey: 'help.owner.analyticsBasics.s2h', bodyKey: 'help.owner.analyticsBasics.s2b', screenshot: '/help/owner-analytics.png' },
          ],
        },
        {
          id: 'owner-refunds',
          titleKey: 'help.owner.refunds.title',
          descKey: 'help.owner.refunds.desc',
          icon: '↩️',
          sections: [
            { headingKey: 'help.owner.refunds.s1h', bodyKey: 'help.owner.refunds.s1b', screenshot: '/help/owner-refunds.png' },
            { headingKey: 'help.owner.refunds.s2h', bodyKey: 'help.owner.refunds.s2b' },
          ],
        },
        {
          id: 'owner-mistakes',
          titleKey: 'help.owner.mistakes.title',
          descKey: 'help.owner.mistakes.desc',
          icon: '⚠️',
          sections: [
            { headingKey: 'help.owner.mistakes.s1h', bodyKey: 'help.owner.mistakes.s1b' },
            { headingKey: 'help.owner.mistakes.s2h', bodyKey: 'help.owner.mistakes.s2b' },
          ],
        },
      ],
    },
  ],
  staff: [
    {
      id: 'staff-barman',
      labelKey: 'help.staff.barmanLabel',
      articles: [
        {
          id: 'staff-barman-queue',
          titleKey: 'help.staff.barman.queue.title',
          descKey: 'help.staff.barman.queue.desc',
          icon: '🍺',
          sections: [
            { headingKey: 'help.staff.barman.queue.s1h', bodyKey: 'help.staff.barman.queue.s1b', screenshot: 'barman' },
            { headingKey: 'help.staff.barman.queue.s2h', bodyKey: 'help.staff.barman.queue.s2b' },
            { headingKey: 'help.staff.barman.queue.s3h', bodyKey: 'help.staff.barman.queue.s3b' },
          ],
        },
      ],
    },
    {
      id: 'staff-bouncer',
      labelKey: 'help.staff.bouncerLabel',
      articles: [
        {
          id: 'staff-bouncer-scan',
          titleKey: 'help.staff.bouncer.scan.title',
          descKey: 'help.staff.bouncer.scan.desc',
          icon: '🚪',
          sections: [
            { headingKey: 'help.staff.bouncer.scan.s1h', bodyKey: 'help.staff.bouncer.scan.s1b', screenshot: 'bouncer' },
            { headingKey: 'help.staff.bouncer.scan.s2h', bodyKey: 'help.staff.bouncer.scan.s2b' },
          ],
        },
      ],
    },
    {
      id: 'staff-vip',
      labelKey: 'help.staff.vipLabel',
      articles: [
        {
          id: 'staff-vip-tables',
          titleKey: 'help.staff.vip.tables.title',
          descKey: 'help.staff.vip.tables.desc',
          icon: '🥂',
          sections: [
            { headingKey: 'help.staff.vip.tables.s1h', bodyKey: 'help.staff.vip.tables.s1b', screenshot: 'viphost' },
            { headingKey: 'help.staff.vip.tables.s2h', bodyKey: 'help.staff.vip.tables.s2b' },
            { headingKey: 'help.staff.vip.tables.s3h', bodyKey: 'help.staff.vip.tables.s3b' },
          ],
        },
      ],
    },
    {
      id: 'staff-cloakroom',
      labelKey: 'help.staff.cloakroomLabel',
      articles: [
        {
          id: 'staff-cloakroom-flow',
          titleKey: 'help.staff.cloakroom.flow.title',
          descKey: 'help.staff.cloakroom.flow.desc',
          icon: '🧥',
          sections: [
            { headingKey: 'help.staff.cloakroom.flow.s1h', bodyKey: 'help.staff.cloakroom.flow.s1b', screenshot: 'cloakroom' },
            { headingKey: 'help.staff.cloakroom.flow.s2h', bodyKey: 'help.staff.cloakroom.flow.s2b' },
          ],
        },
      ],
    },
  ],
};
