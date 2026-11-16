/**
 * Les comptes pros de l'admin (lot 2) : types des RPC `admin_accounts` /
 * `admin_account`, clés de compte, statuts de cycle de vie et filtres.
 * Module pur (testé, src/admin/pros/__tests__/accounts.test.ts).
 *
 * Une clé de compte : `venue:<id>` (club), `org:<uuid>` (organisateur ou
 * association), `agency:<uuid>` (agence). Les mêmes que les portées du CRM.
 */

export type AccountKind = 'venue' | 'org' | 'agency';
export type AccountType = 'club' | 'organizer' | 'association' | 'agency';
export type AccountProduct = 'tickets' | 'crm';

/** Ordre d'évaluation = ordre de la définition SQL (migration 20261218120000). */
export const LIFECYCLE = ['selling', 'at_risk', 'configured', 'signed_up', 'invited', 'paused', 'closed'] as const;
export type Lifecycle = (typeof LIFECYCLE)[number];

export type Tone = 'neutral' | 'accent' | 'positive' | 'negative' | 'warning';

export const LIFECYCLE_TONE: Record<Lifecycle, Tone> = {
  selling: 'positive',
  at_risk: 'warning',
  configured: 'accent',
  signed_up: 'neutral',
  invited: 'neutral',
  paused: 'neutral',
  closed: 'negative',
};

export type CrmState = 'trial' | 'paid' | 'late' | 'churned' | 'paused';

export interface AccountRow {
  key: string;
  type: AccountType;
  ref: string;
  name: string;
  city: string | null;
  products: AccountProduct[];
  status: Lifecycle;
  hidden: boolean;
  is_demo: boolean;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  created_at: string;
  last_login: string | null;
  last_seen: string | null;
  stripe_ready: boolean;
  sales_period: number;
  sales_prev: number;
  sales_30d: number;
  sales_total: number;
  /** CA club (fees.ts) ; null pour une agence (elle ne vend pas, elle attribue). */
  revenue_period: number | null;
  revenue_prev: number | null;
  revenue_total: number | null;
  last_sale_at: string | null;
  upcoming: number;
  events_total: number;
  crm: {
    state: CrmState;
    mrr: number;
    health: number;
    balance: number;
    trial_left: number | null;
    sync: 'none' | 'ok' | 'error';
    paid: boolean;
    granted: boolean;
    frozen: boolean;
  } | null;
  /** Accès assisté ouvert : demandé (`pending`) ou accordé (`active`). */
  support: 'pending' | 'active' | null;
  note: string | null;
  tags: string[];
}

export interface AccountsPayload {
  at: string;
  days: number;
  from: string;
  prev_from: string;
  accounts: AccountRow[];
}

export function parseAccountKey(key: string | null | undefined): { kind: AccountKind; ref: string } | null {
  if (!key) return null;
  const i = key.indexOf(':');
  if (i <= 0) return null;
  const kind = key.slice(0, i);
  const ref = key.slice(i + 1);
  if (!ref || (kind !== 'venue' && kind !== 'org' && kind !== 'agency')) return null;
  return { kind, ref };
}

/** Adresse de la fiche d'un compte : `/admin/pros/venue:womber`. */
export function accountHref(key: string): string {
  const p = parseAccountKey(key);
  if (!p) return '/admin/pros';
  return `/admin/pros/${p.kind}:${encodeURIComponent(p.ref)}`;
}

export function accountKey(kind: AccountKind, ref: string): string {
  return `${kind}:${ref}`;
}

export interface AccountFilters {
  type: AccountType | 'all';
  product: 'all' | 'tickets' | 'crm' | 'both';
  status: Lifecycle | 'all';
  city: string | 'all';
}

export const DEFAULT_FILTERS: AccountFilters = { type: 'all', product: 'all', status: 'all', city: 'all' };

export function matchesFilters(r: AccountRow, f: AccountFilters): boolean {
  if (f.type !== 'all' && r.type !== f.type) return false;
  const t = r.products.includes('tickets');
  const c = r.products.includes('crm');
  if (f.product === 'tickets' && !t) return false;
  if (f.product === 'crm' && !c) return false;
  if (f.product === 'both' && !(t && c)) return false;
  if (f.status !== 'all' && r.status !== f.status) return false;
  if (f.city !== 'all' && (r.city ?? '').trim().toLowerCase() !== f.city.toLowerCase()) return false;
  return true;
}

/** Villes présentes, triées par nombre de comptes. */
export function citiesOf(rows: AccountRow[]): string[] {
  const n = new Map<string, { label: string; c: number }>();
  for (const r of rows) {
    const c = (r.city ?? '').trim();
    if (!c) continue;
    const k = c.toLowerCase();
    const cur = n.get(k);
    if (cur) cur.c += 1; else n.set(k, { label: c, c: 1 });
  }
  return [...n.values()].sort((a, b) => b.c - a.c || a.label.localeCompare(b.label)).map((x) => x.label);
}

/** Les cinq chiffres de la liste, avec leur valeur sur la période précédente. */
export function accountKpis(rows: AccountRow[], from: string, prevFrom: string) {
  const fromT = new Date(from).getTime();
  const prevT = new Date(prevFrom).getTime();
  const created = (r: AccountRow) => new Date(r.created_at).getTime();
  const open = rows.filter((r) => r.status !== 'closed');
  return {
    total: open.length,
    totalPrev: open.filter((r) => created(r) < fromT).length,
    // « Qui vendent » = une vente Yuno sur la période (comparable à la précédente) ;
    // les abonnés CRM sont comptés à part (paidCrm).
    selling: rows.filter((r) => r.sales_period > 0).length,
    sellingPrev: rows.filter((r) => r.sales_prev > 0).length,
    newOnes: rows.filter((r) => created(r) >= fromT).length,
    newPrev: rows.filter((r) => created(r) >= prevT && created(r) < fromT).length,
    atRisk: rows.filter((r) => r.status === 'at_risk').length,
    paidCrm: rows.filter((r) => r.crm && (r.crm.state === 'paid' || r.crm.state === 'late') && r.crm.paid).length,
    mrr: rows.reduce((s, r) => s + (r.crm?.mrr ?? 0), 0),
  };
}

/** Où « Voir sa Console » atterrit, selon le compte. */
export function consoleLanding(row: Pick<AccountRow, 'type' | 'products'>): string {
  if (!row.products.includes('tickets') && row.products.includes('crm')) return '/crm';
  if (row.type === 'club') return '/owner';
  if (row.type === 'agency') return '/agency-app';
  return '/organizer-app';
}

/** Identifiant d'un club tiré de son nom (minuscules, sans accent, tirets), comme l'ancienne liste. */
export function venueIdFromName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

/** Lien `tel:` / WhatsApp d'un numéro, sans espaces. */
export function phoneLinks(phone: string | null | undefined): { tel: string; wa: string } | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length < 6) return null;
  const wa = digits.replace(/^\+/, '').replace(/^0(\d{9})$/, '33$1');
  return { tel: `tel:${digits}`, wa: `https://wa.me/${wa}` };
}
