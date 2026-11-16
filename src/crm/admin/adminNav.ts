/**
 * Adresses des écrans de l'ex-Admin CRM, à leur place dans l'admin unique
 * (src/admin/nav.ts, refonte du 16/11). Les écrans CRM gardent ces clés ;
 * les anciennes adresses `/admin/crm/...` redirigent (src/admin/redirects.ts).
 */
export const ADMIN_ROUTES = {
  cockpit: '/admin/pilot/crm',
  login: '/admin/login',
  cockpitActivity: '/admin/pilot/crm?tab=activity',
  acquisition: '/admin/pilot/crm-acquisition',
  sales: '/admin/pros/sales',
  invite: '/admin/pros/invite',
  demo: '/admin/pros/crm-demo',
  support: '/admin/pros/crm-support',
  clients: '/admin/pros/crm',
  clientsRisks: '/admin/pros/crm?tab=risks',
  clientsOnboarding: '/admin/pros/crm?tab=onboarding',
  account: (id: string) => `/admin/pros/crm/${encodeURIComponent(id)}`,
  product: '/admin/pilot/crm-product',
  money: '/admin/money/crm',
  platform: '/admin/system/connectors',
  legal: '/admin/legal',
  settings: '/admin/system/pricing',
} as const;
