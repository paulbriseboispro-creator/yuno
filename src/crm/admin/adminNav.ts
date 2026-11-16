/**
 * Adresses des écrans de l'ex-Admin CRM, à leur place dans l'admin unique
 * (src/admin/nav.ts, refonte du 16/11). Les écrans CRM gardent ces clés ;
 * les anciennes adresses `/admin/crm/...` redirigent (src/admin/redirects.ts).
 */
export const ADMIN_ROUTES = {
  cockpit: '/admin/pilot',
  login: '/admin/login',
  cockpitActivity: '/admin',
  acquisition: '/admin/pilot/acquisition',
  sales: '/admin/pros/prospects?tab=pipeline',
  invite: '/admin/pros/invite',
  demo: '/admin/pros/demo?tab=crm',
  support: '/admin/pros/support',
  clients: '/admin/pros?product=crm',
  clientsRisks: '/admin/pros/crm?tab=risks',
  clientsOnboarding: '/admin/pros/crm?tab=onboarding',
  // Fiche unique d'un pro : clé `venue:` | `org:` (lot 2).
  account: (id: string) => {
    const i = id.indexOf(':');
    return i > 0 ? `/admin/pros/${id.slice(0, i)}:${encodeURIComponent(id.slice(i + 1))}` : `/admin/pros/${encodeURIComponent(id)}`;
  },
  product: '/admin/pilot/product?tab=crm',
  money: '/admin/money/crm',
  platform: '/admin/system/connectors',
  legal: '/admin/legal',
  settings: '/admin/system/pricing',
} as const;
