// Centre d'aide d'un compte Yuno CRM (billetterie connectée, rien à vendre).
//
// Même moteur que la Suite (src/pages/OwnerHelpCenter.tsx). Deux sources :
// - les articles propres au CRM (`ohelp.crm.*`, section help des locales) :
//   ce qu'est Yuno CRM, connecter sa billetterie, soirées, audience, clients ;
// - les articles marketing de la Suite qui décrivent une page ouverte au CRM
//   (email, SMS, publicité, Meta, équipe, apparence), repris du jeu du club
//   ou de l'organisateur selon la Console.
// Un lien d'article qui mène à une page fermée au CRM (`isCrmPathAllowed`)
// est retiré : la page le renverrait sur l'accueil.

import type { OwnerHelpArticle, OwnerHelpCategory } from './ownerHelpContent';
import { ownerHelpCategories } from './ownerHelpContent';
import { organizerHelpCategories } from './organizerHelpContent';
import { isCrmPathAllowed, type ConsoleBase } from '@/components/crm/crmNav';

const OPEN = 'ohelp.crm.openPage';

const CRM_BILLING_ARTICLE: OwnerHelpArticle = {
  id: 'crm-billing',
  titleKey: 'ohelp.crm.billing.title',
  descKey: 'ohelp.crm.billing.desc',
  icon: 'CreditCard',
  relatedArticleIds: ['crm-what-is', 'crm-connect'],
  keywords: ['abonnement', 'subscription', 'suscripción', 'offre', 'plan', 'prix', 'price', 'precio', 'essai', 'trial', 'prueba', 'fondateur', 'founder', 'fundador', 'facture', 'invoice', 'factura', 'résilier', 'cancel', 'cancelar', 'limite', 'limit', 'stripe'],
  actionLink: { labelKey: OPEN, path: '/crm/billing' },
  sections: [
    { headingKey: 'ohelp.crm.billing.s1h', bodyKey: 'ohelp.crm.billing.s1b' },
    { headingKey: 'ohelp.crm.billing.s2h', bodyKey: 'ohelp.crm.billing.s2b' },
    { headingKey: 'ohelp.crm.billing.s3h', bodyKey: 'ohelp.crm.billing.s3b', type: 'steps' },
    { headingKey: 'ohelp.crm.billing.s4h', bodyKey: 'ohelp.crm.billing.s4b' },
    { headingKey: 'ohelp.crm.billing.s5h', bodyKey: 'ohelp.crm.billing.s5b', type: 'tip' },
  ],
};

const CRM_ARTICLES: Record<'start' | 'base', OwnerHelpArticle[]> = {
  start: [
    {
      id: 'crm-what-is',
      titleKey: 'ohelp.crm.whatis.title',
      descKey: 'ohelp.crm.whatis.desc',
      icon: 'Lightbulb',
      quickStart: true,
      relatedArticleIds: ['crm-connect', 'crm-nights', 'crm-audience'],
      keywords: ['crm', 'yuno crm', 'shotgun', 'billetterie', 'ticketing', 'ticketera', 'c\'est quoi', 'what is', 'qué es', 'base clients', 'customer base'],
      actionLink: { labelKey: OPEN, path: '/integrations' },
      sections: [
        { headingKey: 'ohelp.crm.whatis.s1h', bodyKey: 'ohelp.crm.whatis.s1b' },
        { headingKey: 'ohelp.crm.whatis.s2h', bodyKey: 'ohelp.crm.whatis.s2b' },
        { headingKey: 'ohelp.crm.whatis.s3h', bodyKey: 'ohelp.crm.whatis.s3b', type: 'steps' },
        { headingKey: 'ohelp.crm.whatis.s4h', bodyKey: 'ohelp.crm.whatis.s4b', type: 'tip' },
      ],
    },
    {
      id: 'crm-connect',
      titleKey: 'ohelp.crm.connect.title',
      descKey: 'ohelp.crm.connect.desc',
      icon: 'Plug',
      quickStart: true,
      relatedArticleIds: ['crm-what-is', 'crm-nights', 'crm-contacts'],
      keywords: ['shotgun', 'connecter', 'connect', 'conectar', 'jeton', 'token', 'api', 'id organisateur', 'organizer id', 'smartboard', 'import', 'synchro', 'sync', 'intégration', 'integration', 'integración'],
      actionLink: { labelKey: OPEN, path: '/integrations' },
      sections: [
        { headingKey: 'ohelp.crm.connect.s1h', bodyKey: 'ohelp.crm.connect.s1b' },
        { headingKey: 'ohelp.crm.connect.s2h', bodyKey: 'ohelp.crm.connect.s2b' },
        { headingKey: 'ohelp.crm.connect.s3h', bodyKey: 'ohelp.crm.connect.s3b', type: 'steps', screenshotUrl: '/help/crm-connect.webp' },
        { headingKey: 'ohelp.crm.connect.s4h', bodyKey: 'ohelp.crm.connect.s4b' },
        { headingKey: 'ohelp.crm.connect.s5h', bodyKey: 'ohelp.crm.connect.s5b', type: 'warning' },
        { headingKey: 'ohelp.crm.connect.s6h', bodyKey: 'ohelp.crm.connect.s6b' },
      ],
    },
  ],
  base: [
    {
      id: 'crm-nights',
      titleKey: 'ohelp.crm.nights.title',
      descKey: 'ohelp.crm.nights.desc',
      icon: 'Calendar',
      relatedArticleIds: ['crm-audience', 'crm-connect'],
      keywords: ['soirées', 'nights', 'events', 'fiestas', 'bilan', 'report', 'informe', 'billets', 'tickets', 'entradas', 'courbe', 'curve', 'comparaison', 'tarifs', 'prices', 'utm', 'sources'],
      actionLink: { labelKey: OPEN, path: '/crm/nights' },
      sections: [
        { headingKey: 'ohelp.crm.nights.s1h', bodyKey: 'ohelp.crm.nights.s1b' },
        { headingKey: 'ohelp.crm.nights.s2h', bodyKey: 'ohelp.crm.nights.s2b', screenshotUrl: '/help/crm-nights.webp' },
        { headingKey: 'ohelp.crm.nights.s3h', bodyKey: 'ohelp.crm.nights.s3b', screenshotUrl: '/help/crm-report.webp' },
        { headingKey: 'ohelp.crm.nights.s4h', bodyKey: 'ohelp.crm.nights.s4b', type: 'tip' },
        { headingKey: 'ohelp.crm.nights.s5h', bodyKey: 'ohelp.crm.nights.s5b' },
      ],
    },
    {
      id: 'crm-audience',
      titleKey: 'ohelp.crm.audience.title',
      descKey: 'ohelp.crm.audience.desc',
      icon: 'BarChart3',
      relatedArticleIds: ['crm-contacts', 'crm-nights'],
      keywords: ['audience', 'public', 'communauté', 'community', 'comunidad', 'fidélité', 'loyalty', 'reviennent', 'returning', 'croissance', 'growth', 'dernière venue', 'last purchase'],
      actionLink: { labelKey: OPEN, path: '/crm/audience' },
      sections: [
        { headingKey: 'ohelp.crm.audience.s1h', bodyKey: 'ohelp.crm.audience.s1b' },
        { headingKey: 'ohelp.crm.audience.s2h', bodyKey: 'ohelp.crm.audience.s2b', screenshotUrl: '/help/crm-audience.webp' },
        { headingKey: 'ohelp.crm.audience.s3h', bodyKey: 'ohelp.crm.audience.s3b', type: 'tip' },
      ],
    },
    {
      id: 'crm-contacts',
      titleKey: 'ohelp.crm.contacts.title',
      descKey: 'ohelp.crm.contacts.desc',
      icon: 'Users',
      relatedArticleIds: ['crm-audience', 'crm-connect'],
      keywords: ['clients', 'customers', 'clientes', 'contacts', 'contactos', 'base', 'segments', 'segmentos', 'export', 'exporter', 'importer', 'import', 'csv', 'excel', 'consentement', 'consent'],
      actionLink: { labelKey: OPEN, path: '/campaigns/contacts' },
      sections: [
        { headingKey: 'ohelp.crm.contacts.s1h', bodyKey: 'ohelp.crm.contacts.s1b' },
        { headingKey: 'ohelp.crm.contacts.s2h', bodyKey: 'ohelp.crm.contacts.s2b', type: 'steps' },
        { headingKey: 'ohelp.crm.contacts.s3h', bodyKey: 'ohelp.crm.contacts.s3b', type: 'warning' },
      ],
    },
  ],
};

/** Articles de la Suite repris tels quels, par Console. */
const REUSED: Record<ConsoleBase, { marketing: string[]; account: string[] }> = {
  '/organizer-app': {
    marketing: ['org-campaigns', 'org-sms', 'org-ads', 'org-meta-ads'],
    account: ['org-team', 'appearance'],
  },
  '/owner': {
    marketing: ['email-campaigns', 'marketing-consent', 'sms-credits', 'ads', 'meta-ads'],
    account: ['support-access', 'appearance'],
  },
};

function allowedLink(article: OwnerHelpArticle, base: ConsoleBase): OwnerHelpArticle {
  const path = article.actionLink?.path;
  if (!path) return article;
  const absolute = path.startsWith('~') ? path.slice(1) : `${base}${path}`;
  if (isCrmPathAllowed(absolute.split('?')[0], base)) return article;
  const { actionLink: _dropped, ...rest } = article;
  return rest;
}

export function buildCrmHelpCategories(base: ConsoleBase): OwnerHelpCategory[] {
  const source = base === '/organizer-app' ? organizerHelpCategories : ownerHelpCategories;
  const byId = new Map(source.flatMap((c) => c.articles).map((a) => [a.id, a] as const));
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((a): a is OwnerHelpArticle => !!a).map((a) => allowedLink(a, base));

  const categories: OwnerHelpCategory[] = [
    { id: 'getting-started', labelKey: 'ohelp.cat.gettingStarted', icon: 'Rocket', articles: CRM_ARTICLES.start },
    { id: 'crm-base', labelKey: 'ohelp.crm.cat.base', icon: 'Users', articles: CRM_ARTICLES.base },
    { id: 'marketing-crm', labelKey: 'sidebar.group.marketingCRM', icon: 'Megaphone', articles: pick(REUSED[base].marketing) },
    { id: 'settings', labelKey: 'sidebar.group.settings', icon: 'Settings', articles: [CRM_BILLING_ARTICLE, ...pick(REUSED[base].account)] },
  ].filter((c) => c.articles.length > 0);

  // Un article lié qui n'existe pas dans ce centre d'aide ne s'affiche pas.
  const known = new Set(categories.flatMap((c) => c.articles.map((a) => a.id)));
  return categories.map((c) => ({
    ...c,
    articles: c.articles.map((a) => (a.relatedArticleIds ? { ...a, relatedArticleIds: a.relatedArticleIds.filter((id) => known.has(id)) } : a)),
  }));
}
