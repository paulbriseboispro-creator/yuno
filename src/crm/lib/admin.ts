/**
 * Admin CRM (super admin) : types des lignes rendues par les RPC `crm_admin_*`
 * et fonctions PURES (testées dans `__tests__/admin.test.ts`) : santé, statut,
 * « à faire aujourd'hui », risques, étapes d'onboarding. La définition de la
 * santé /100 vit en SQL (`_crm_admin_rows`) ; ici on ne fait que la lire.
 */

export type AdminState = 'trial' | 'paid' | 'late' | 'paused' | 'churned';
export type AdminSync = 'ok' | 'error' | 'none';
export type HealthTone = 'good' | 'mid' | 'bad';

export interface AdminAccount {
  id: string;
  kind: 'venue' | 'org';
  venue_id: string | null;
  organizer_user_id: string | null;
  name: string;
  city: string | null;
  type: 'club' | 'organizer' | 'association';
  contact: string | null;
  email: string | null;
  phone: string | null;
  state: AdminState;
  sub_status: string | null;
  interval: 'month' | 'year' | null;
  founder: boolean;
  trial_ends_at: string | null;
  trial_left: number | null;
  period_end: string | null;
  cancel_at_end: boolean;
  paid: boolean;
  granted: boolean;
  signup_at: string | null;
  sub_created: string | null;
  mrr: number;
  provider: string | null;
  conn_status: string | null;
  sync: AdminSync;
  sync_at: string | null;
  sync_error: string | null;
  sync_error_at: string | null;
  contacts: number;
  reach: number;
  sends30: number;
  last_send_at: string | null;
  balance: number;
  buys: number;
  buys_eur: number;
  last_buy_at: string | null;
  last_login: string | null;
  source: string | null;
  /** Les sept étapes de mise en route, dans l'ordre de `OB_STEPS`. */
  ob: boolean[];
  recipes: number;
  team: number;
  health: number;
  /** Les quatre parts de la santé : mise en route /40, envois /30, présence /15, billetterie /15. */
  h: [number, number, number, number];
  frozen_at: string | null;
  frozen_reason: string | null;
  deletion_requested_at: string | null;
  is_demo: boolean;
}

export const OB_STEPS = ['connect', 'sync', 'import', 'sender', 'send', 'recipes', 'team'] as const;
export const HEALTH_MAX = [40, 30, 15, 15] as const;

const DAY = 86_400_000;

export function healthTone(score: number): HealthTone {
  return score >= 80 ? 'good' : score >= 60 ? 'mid' : 'bad';
}

export const HEALTH_COLOR: Record<HealthTone, string> = { good: 'var(--green-500)', mid: 'var(--amber-500)', bad: 'var(--red-500)' };

/** « À risque » : un compte vivant dont la santé passe sous 60. */
export function atRisk(a: Pick<AdminAccount, 'state' | 'health'>): boolean {
  return a.state !== 'churned' && a.health < 60;
}

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null;
}

/** Première étape non faite (celle où le compte « est bloqué »), ou null. */
export function blockedStep(ob: boolean[]): number | null {
  const i = ob.findIndex((x) => !x);
  return i < 0 ? null : i;
}

export interface StateCounts { all: number; paid: number; trial: number; late: number; risk: number; off: number }

export function countStates(rows: AdminAccount[]): StateCounts {
  return {
    all: rows.length,
    paid: rows.filter((r) => r.state === 'paid').length,
    trial: rows.filter((r) => r.state === 'trial').length,
    late: rows.filter((r) => r.state === 'late').length,
    risk: rows.filter(atRisk).length,
    off: rows.filter((r) => r.state === 'paused' || r.state === 'churned').length,
  };
}

export type StateFilter = 'all' | 'paid' | 'trial' | 'late' | 'risk' | 'off';

export function matchesFilter(r: AdminAccount, f: StateFilter): boolean {
  switch (f) {
    case 'paid': return r.state === 'paid';
    case 'trial': return r.state === 'trial';
    case 'late': return r.state === 'late';
    case 'risk': return atRisk(r);
    case 'off': return r.state === 'paused' || r.state === 'churned';
    default: return true;
  }
}

export type SortKey = 'health' | 'bought' | 'size' | 'recent' | 'name';

export function sortAccounts(rows: AdminAccount[], key: SortKey): AdminAccount[] {
  const by: Record<SortKey, (a: AdminAccount, b: AdminAccount) => number> = {
    health: (a, b) => a.health - b.health,
    bought: (a, b) => b.buys_eur - a.buys_eur,
    size: (a, b) => b.contacts - a.contacts,
    recent: (a, b) => new Date(b.signup_at ?? 0).getTime() - new Date(a.signup_at ?? 0).getTime(),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return [...rows].sort((a, b) => by[key](a, b) || a.name.localeCompare(b.name));
}

export function searchAccounts(rows: AdminAccount[], q: string): AdminAccount[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((r) => [r.name, r.city, r.contact, r.email].some((x) => (x ?? '').toLowerCase().includes(s)));
}

export function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [l, d] = email.split('@');
  return d ? `${l.slice(0, 2)}•••@${d}` : null;
}

// ── À faire aujourd'hui ─────────────────────────────────────────────────────

export type TodoKind = 'trial_no_conn' | 'sync_error' | 'late' | 'silent_paid' | 'low_yunits' | 'frozen';
export interface Todo { id: string; kind: TodoKind; sev: 'red' | 'amber' | 'grey'; account: AdminAccount; n?: number }

/** Les sujets du jour, calculés des lignes de compte : le texte est composé par l'écran. */
export function buildTodo(rows: AdminAccount[], now = Date.now()): Todo[] {
  const out: Todo[] = [];
  for (const a of rows) {
    if (a.state === 'churned') continue;
    if (a.frozen_at) out.push({ id: `frozen:${a.id}`, kind: 'frozen', sev: 'grey', account: a });
    if (a.state === 'late') out.push({ id: `late:${a.id}`, kind: 'late', sev: 'red', account: a });
    if (a.state === 'trial' && (a.trial_left ?? 99) <= 2 && a.sync === 'none') {
      out.push({ id: `trial:${a.id}`, kind: 'trial_no_conn', sev: 'red', account: a, n: a.trial_left ?? 0 });
    }
    if (a.sync === 'error' && a.sync_error_at) {
      out.push({ id: `sync:${a.id}`, kind: 'sync_error', sev: 'red', account: a, n: daysSince(a.sync_error_at, now) ?? 0 });
    }
    if (a.state === 'paid') {
      const idle = daysSince(a.last_send_at, now);
      if (idle === null ? (daysSince(a.signup_at, now) ?? 0) > 14 : idle >= 30) {
        out.push({ id: `silent:${a.id}`, kind: 'silent_paid', sev: 'amber', account: a, n: idle ?? undefined });
      }
    }
    if ((a.state === 'paid' || a.state === 'trial') && a.balance < 500) {
      out.push({ id: `low:${a.id}`, kind: 'low_yunits', sev: 'amber', account: a });
    }
  }
  const rank = { red: 0, amber: 1, grey: 2 } as const;
  return out.sort((x, y) => rank[x.sev] - rank[y.sev] || x.account.name.localeCompare(y.account.name));
}

// ── Onboarding ──────────────────────────────────────────────────────────────

/** Le point de blocage n°1 : l'étape où s'arrêtent le plus de comptes (étape : nombre). */
export function topBlocker(rows: AdminAccount[]): { step: number; n: number } | null {
  const c = new Array(OB_STEPS.length).fill(0);
  for (const r of rows) {
    const b = blockedStep(r.ob);
    if (b !== null) c[b] += 1;
  }
  const n = Math.max(...c);
  return n > 0 ? { step: c.indexOf(n), n } : null;
}

/** Relatif court : « aujourd'hui », « hier », « il y a 3 j » (le texte est composé par l'écran). */
export function ago(iso: string | null | undefined, now = Date.now()): { unit: 'now' | 'min' | 'h' | 'd' | 'never'; n: number } {
  if (!iso) return { unit: 'never', n: 0 };
  const ms = Math.max(0, now - new Date(iso).getTime());
  if (ms < 3_600_000) return { unit: ms < 120_000 ? 'now' : 'min', n: Math.floor(ms / 60_000) };
  if (ms < DAY) return { unit: 'h', n: Math.floor(ms / 3_600_000) };
  return { unit: 'd', n: Math.floor(ms / DAY) };
}
