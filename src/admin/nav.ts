/**
 * LA carte de l'admin : huit rubriques, leurs entrées, leurs adresses.
 * Barre latérale, fil d'Ariane et palette ⌘K la lisent ; rien d'autre ne
 * décrit le menu.
 *
 * Ajouter une page (lots 1 à 6) :
 *   1. la route dans `src/admin/<rubrique>/routes.tsx` (chemin RELATIF à la rubrique) ;
 *   2. une entrée ici, dans sa rubrique : `{ key, path }` (+ `end`, `badge`, `hidden`) ;
 *   3. le libellé `adm.nav2.<rubrique>.<key>` en trois langues (module i18n `shell.ts`).
 * Une page sans entrée reste joignable par son adresse, mais n'est pas dans le menu
 * (`hidden: true` la garde dans la recherche et le fil d'Ariane sans l'afficher).
 *
 * Module pur (testé) : aucune dépendance React, les icônes sont des noms.
 */

export const RUBRIC_IDS = ['today', 'pilot', 'pros', 'clients', 'money', 'comms', 'legal', 'system'] as const;
export type RubricId = (typeof RUBRIC_IDS)[number];

/** Identifiant d'un compteur de la barre latérale, servi par `useNavBadges`. */
export type NavBadgeKey = 'alertsUnread' | 'todayUrgent';

export interface AdminNavEntry {
  /** Clé du libellé : `adm.nav2.<rubrique>.<key>`. */
  key: string;
  /** Adresse absolue (`/admin/...`). */
  path: string;
  /** Allumé seulement sur l'adresse exacte (index d'une rubrique)… */
  end?: boolean;
  /** …et sur ces préfixes en plus (pages filles d'un index : l'éditeur d'une campagne). */
  prefixes?: string[];
  badge?: NavBadgeKey;
  /** Hors menu, mais connu du fil d'Ariane et de ⌘K. */
  hidden?: boolean;
}

export interface AdminRubric {
  id: RubricId;
  /** Préfixe d'adresse de la rubrique (« Aujourd'hui » vit à `/admin`). */
  base: string;
  /** Nom d'une icône lucide-react (résolu par la coquille). */
  icon: 'Inbox' | 'LineChart' | 'Building2' | 'Users' | 'Coins' | 'Megaphone' | 'Scale' | 'Server';
  entries: AdminNavEntry[];
}

export const ADMIN_ROOT = '/admin';
export const ADMIN_LOGIN = '/admin/login';

export const ADMIN_NAV: AdminRubric[] = [
  {
    id: 'today', base: '/admin', icon: 'Inbox',
    entries: [
      { key: 'home', path: '/admin', end: true, badge: 'todayUrgent' },
      { key: 'alerts', path: '/admin/today/alerts' },
      { key: 'feedback', path: '/admin/today/feedback' },
    ],
  },
  {
    id: 'pilot', base: '/admin/pilot', icon: 'LineChart',
    entries: [
      { key: 'overview', path: '/admin/pilot', end: true },
      { key: 'growth', path: '/admin/pilot/growth' },
      { key: 'signups', path: '/admin/pilot/signups' },
      { key: 'crmOverview', path: '/admin/pilot/crm' },
      { key: 'crmAcquisition', path: '/admin/pilot/crm-acquisition' },
      { key: 'product', path: '/admin/pilot/product' },
      { key: 'crmProduct', path: '/admin/pilot/crm-product' },
      { key: 'ai', path: '/admin/pilot/ai' },
    ],
  },
  {
    id: 'pros', base: '/admin/pros', icon: 'Building2',
    entries: [
      { key: 'venues', path: '/admin/pros/venues' },
      { key: 'organizers', path: '/admin/pros/organizers' },
      { key: 'agencies', path: '/admin/pros/agencies' },
      { key: 'crmAccounts', path: '/admin/pros/crm' },
      { key: 'sales', path: '/admin/pros/sales' },
      { key: 'invite', path: '/admin/pros/invite' },
      { key: 'demo', path: '/admin/pros/demo' },
      { key: 'crmDemo', path: '/admin/pros/crm-demo' },
      { key: 'support', path: '/admin/pros/support' },
      { key: 'crmSupport', path: '/admin/pros/crm-support' },
    ],
  },
  {
    id: 'clients', base: '/admin/clients', icon: 'Users',
    entries: [
      { key: 'buyers', path: '/admin/clients', end: true },
      { key: 'events', path: '/admin/clients/events' },
      { key: 'people', path: '/admin/clients/people' },
    ],
  },
  {
    id: 'money', base: '/admin/money', icon: 'Coins',
    entries: [
      { key: 'revenue', path: '/admin/money', end: true },
      { key: 'orders', path: '/admin/money/orders' },
      { key: 'crm', path: '/admin/money/crm' },
      { key: 'subscriptions', path: '/admin/money/subscriptions', hidden: true },
    ],
  },
  {
    id: 'comms', base: '/admin/comms', icon: 'Megaphone',
    entries: [
      { key: 'marketing', path: '/admin/comms', end: true, prefixes: ['/admin/comms/email'] },
      { key: 'automations', path: '/admin/comms/automations' },
      { key: 'sms', path: '/admin/comms/sms' },
      { key: 'push', path: '/admin/comms/push' },
      { key: 'engine', path: '/admin/comms/engine' },
      { key: 'links', path: '/admin/comms/links' },
    ],
  },
  {
    id: 'legal', base: '/admin/legal', icon: 'Scale',
    entries: [
      { key: 'crm', path: '/admin/legal', end: true },
      { key: 'deadlines', path: '/admin/legal/deadlines' },
      { key: 'audit', path: '/admin/legal/audit' },
    ],
  },
  {
    id: 'system', base: '/admin/system', icon: 'Server',
    entries: [
      { key: 'health', path: '/admin/system', end: true },
      { key: 'crmPlatform', path: '/admin/system/crm' },
      { key: 'settings', path: '/admin/system/settings' },
    ],
  },
];

function clean(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/** Rubrique d'une adresse : le plus long préfixe gagne, « Aujourd'hui » par défaut. */
export function rubricFor(pathname: string): AdminRubric {
  const p = clean(pathname);
  const hit = ADMIN_NAV.find((r) => r.base !== ADMIN_ROOT && (p === r.base || p.startsWith(`${r.base}/`)));
  return hit ?? ADMIN_NAV[0];
}

export function entryMatches(entry: AdminNavEntry, pathname: string): boolean {
  const p = clean(pathname);
  if (entry.prefixes?.some((x) => p === x || p.startsWith(`${x}/`))) return true;
  return entry.end ? p === entry.path : p === entry.path || p.startsWith(`${entry.path}/`);
}

/**
 * Entrée allumée : la plus SPÉCIFIQUE qui correspond (`/admin/pros/crm-demo`
 * n'allume pas « Comptes CRM »), jamais la première de la liste.
 */
export function activeEntry(pathname: string): { rubric: AdminRubric; entry: AdminNavEntry | null } {
  const rubric = rubricFor(pathname);
  let entry: AdminNavEntry | null = null;
  for (const e of rubric.entries) {
    if (entryMatches(e, pathname) && (!entry || e.path.length > entry.path.length)) entry = e;
  }
  return { rubric, entry };
}

/** Clé i18n du libellé d'une rubrique et d'une entrée. */
export const rubricLabelKey = (id: RubricId) => `adm.nav2.${id}`;
export const entryLabelKey = (id: RubricId, key: string) => `adm.nav2.${id}.${key}`;
/** La question que pose la rubrique (sous-titre de la barre, palette). */
export const rubricQuestionKey = (id: RubricId) => `adm.nav2.${id}.q`;
