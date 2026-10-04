/**
 * La carte de l'Admin CRM : chaque écran, son adresse, sa place dans le menu
 * (AdminNav du design). Le menu, la palette ⌘K et le titre mobile la lisent.
 */
export const ADMIN_BASE = '/admin/crm';

export const ADMIN_ROUTES = {
  cockpit: ADMIN_BASE,
  cockpitActivity: `${ADMIN_BASE}?tab=activity`,
  acquisition: `${ADMIN_BASE}/acquisition`,
  sales: `${ADMIN_BASE}/sales`,
  clients: `${ADMIN_BASE}/clients`,
  clientsRisks: `${ADMIN_BASE}/clients?tab=risks`,
  clientsOnboarding: `${ADMIN_BASE}/clients?tab=onboarding`,
  account: (id: string) => `${ADMIN_BASE}/clients/${encodeURIComponent(id)}`,
  product: `${ADMIN_BASE}/product`,
  money: `${ADMIN_BASE}/money`,
  platform: `${ADMIN_BASE}/platform`,
  legal: `${ADMIN_BASE}/legal`,
  settings: `${ADMIN_BASE}/settings`,
} as const;

export type AdminScreen = 'cockpit' | 'acquisition' | 'sales' | 'clients' | 'product' | 'money' | 'platform' | 'legal' | 'settings';

/** Écran courant d'après l'adresse (le plus long préfixe gagne). */
export function adminScreenFor(pathname: string): AdminScreen {
  const p = pathname.replace(/\/+$/, '');
  const hit = (['acquisition', 'sales', 'clients', 'product', 'money', 'platform', 'legal', 'settings'] as const).find((k) => p === `${ADMIN_BASE}/${k}` || p.startsWith(`${ADMIN_BASE}/${k}/`));
  return hit ?? 'cockpit';
}

export interface AdminNavItem {
  id: AdminScreen;
  key: string;
  to: string;
  d: string;
  subs?: { key: string; to: string; tab?: string }[];
}

// Tracés Lucide (jauge, entonnoir, colonnes, cube, euro, serveur, balance, curseurs).
export const ADMIN_NAV: { label: string; items: AdminNavItem[] }[] = [
  {
    label: 'pilot',
    items: [
      {
        id: 'cockpit', key: 'cockpit', to: ADMIN_ROUTES.cockpit, d: 'm12 14 4-4M3.34 19a10 10 0 1 1 17.32 0',
        subs: [
          { key: 'cockpitAll', to: ADMIN_ROUTES.cockpit },
          { key: 'cockpitLive', to: ADMIN_ROUTES.cockpitActivity, tab: 'activity' },
        ],
      },
    ],
  },
  {
    label: 'grow',
    items: [
      { id: 'acquisition', key: 'acquisition', to: ADMIN_ROUTES.acquisition, d: 'M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z' },
      { id: 'sales', key: 'sales', to: ADMIN_ROUTES.sales, d: 'M8 5v14M12 9v10M16 3v16M20 8v11M4 12v7' },
    ],
  },
  {
    label: 'serve',
    items: [
      {
        id: 'clients', key: 'clients', to: ADMIN_ROUTES.clients,
        d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
        subs: [
          { key: 'clientsAll', to: ADMIN_ROUTES.clients },
          { key: 'clientsRisk', to: ADMIN_ROUTES.clientsRisks, tab: 'risks' },
          { key: 'clientsOb', to: ADMIN_ROUTES.clientsOnboarding, tab: 'onboarding' },
        ],
      },
      { id: 'product', key: 'product', to: ADMIN_ROUTES.product, d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.3 7 12 12l8.7-5M12 22V12' },
    ],
  },
  {
    label: 'hold',
    items: [
      { id: 'money', key: 'money', to: ADMIN_ROUTES.money, d: 'M4 10h12M4 14h9M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2' },
      { id: 'platform', key: 'platform', to: ADMIN_ROUTES.platform, d: 'M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 15a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM6 7h.01M6 17h.01' },
      { id: 'legal', key: 'legal', to: ADMIN_ROUTES.legal, d: 'm16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2' },
      { id: 'settings', key: 'settings', to: ADMIN_ROUTES.settings, d: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4' },
    ],
  },
];
