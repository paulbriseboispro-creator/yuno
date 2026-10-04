/**
 * Données de l'Admin CRM : un hook par RPC `crm_admin_*`. La démo est incluse ou
 * non par l'interrupteur de portée du super admin (`AdminScope`), passé à
 * chaque lecture : la porte démo vit en SQL.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAdminScope } from '@/components/admin/AdminScope';
import { rpc } from '@/crm/lib/rpc';
import type { AdminAccount } from '@/crm/lib/admin';

export interface AdminAccounts { at: string; accounts: AdminAccount[] }

export function useAdminAccounts() {
  const { includeDemo } = useAdminScope();
  return useQuery({
    queryKey: ['crm-admin', 'accounts', includeDemo],
    staleTime: 30_000,
    queryFn: () => rpc<AdminAccounts>('crm_admin_accounts', { p_include_demo: includeDemo }),
  });
}

export interface CockpitFunnelRow { k: 'started' | 'account' | 'console' | 'connected' | 'sent' | 'paid'; n: number }
export interface CockpitSignup {
  at: string; who: string | null; org: string | null; city: string | null; kind: string | null;
  last_step: string | null; steps: Record<string, string>; source: string | null; device: string | null; live: boolean; account: boolean;
}
export interface CockpitBuy { at: string; id: string; yunits: number; eur: number; name: string | null }
export interface Cockpit {
  at: string; days: number;
  kpi: {
    started: number; pstarted: number; created: number; pcreated: number; paying: number; late: number; trial: number; mrr: number;
    buys: number; buys_eur: number; live_signups: number;
  };
  funnel: CockpitFunnelRow[];
  series: { t: string; mrr: number; paying: number }[];
  recent_signups: CockpitSignup[];
  recent_buys: CockpitBuy[];
  accounts: AdminAccount[];
}

export function useAdminCockpit(days: number) {
  const { includeDemo } = useAdminScope();
  return useQuery({
    queryKey: ['crm-admin', 'cockpit', includeDemo, days],
    staleTime: 30_000,
    queryFn: () => rpc<Cockpit>('crm_admin_cockpit', { p_include_demo: includeDemo, p_days: days }),
  });
}

export interface AdminAccountDetail {
  account: AdminAccount;
  moves: { at: string; delta: number; kind: string; lot_kind: string | null; channel: string | null; label: string | null }[];
  runs: { at: string; trigger: string | null; status: string | null; requests: number | null; tickets: number | null; error: string | null }[];
  sends: { at: string; name: string; status: string; recipients: number | null; bounced: number | null; complained: number | null; channel: string }[];
  note: string;
  audit: { at: string; action: string; meta: Record<string, unknown> }[];
}

export function useAdminAccount(id: string | undefined) {
  return useQuery({
    queryKey: ['crm-admin', 'account', id],
    enabled: !!id,
    staleTime: 15_000,
    queryFn: () => rpc<AdminAccountDetail>('crm_admin_account', { p_scope_key: id }),
  });
}

/** Un geste admin (RPC qui écrit) : rafraîchit toutes les lectures de l'Admin CRM. */
export function useAdminGesture<A extends Record<string, unknown>>(fn: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => rpc<unknown>(fn, args),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['crm-admin'] }); },
  });
}

// ── Argent, Plateforme, Légal, Réglages ─────────────────────────────────────
export interface PricingCfg {
  price_month: number; price_month_next: number; price_year: number; vat_rate: number; trial_days: number; trial_yunits: number;
  monthly_yunits: number; annual_bonus_yunits: number; yunits_per_euro: number; price_switch_at: number; trial_extensions: number; low_balance: number;
  bonus_tiers: { min: number; pct: number }[]; packs: number[];
  rates: Record<string, number>; costs: Record<string, number>; channels_live: Record<string, boolean>;
}

export interface AdminMoney {
  at: string; cfg: PricingCfg;
  kpi: { mrr: number; paying: number; lost90: number; active_start: number; new_per_month: number; late: number };
  months: { m: string; new: number; newN: number; lost: number; lostN: number; mrr: number }[];
  subs: { id: string; name: string | null; interval: 'month' | 'year'; since: string; next: string | null; late: boolean; price: number }[];
  weeks: { w: string; eur: number; n: number }[];
  packs: { yunits: number; n: number; eur: number }[];
  buys: { at: string; id: string; name: string | null; yunits: number; eur: number }[];
  buyers: { id: string; name: string | null; n: number; eur: number; yunits: number }[];
  margin: { id: string; name: string; state: string; sub: number; recharge: number; units: Record<string, number>; cost: number; revenue: number; margin: number }[];
}
export function useAdminMoney() {
  const { includeDemo } = useAdminScope();
  return useQuery({ queryKey: ['crm-admin', 'money', includeDemo], staleTime: 30_000, queryFn: () => rpc<AdminMoney>('crm_admin_money', { p_include_demo: includeDemo }) });
}

export interface AdminPlatform {
  at: string;
  shotgun: { conns: number; runs24: number; errors24: number; req24: number; hours: { h: string; req: number; runs: number }[]; window: { used: number; window_start: string } | null; errors: { at: string; error: string | null; name: string | null; id: string }[] };
  imports: Record<string, number>;
  quota: { used: number; free: number; credits: number; pool_used: number; pool_cap: number; day_used: number; day_cap: number } | null;
  bounce: { id: string; name: string; sent: number; bounced: number; complained: number }[];
  suppression: { total: number; last30: number; by_reason: Record<string, number> };
  frozen: AdminAccount[];
  cron: { name: string; schedule: string; active: boolean }[];
}
export function useAdminPlatform() {
  const { includeDemo } = useAdminScope();
  return useQuery({ queryKey: ['crm-admin', 'platform', includeDemo], staleTime: 30_000, queryFn: () => rpc<AdminPlatform>('crm_admin_platform', { p_include_demo: includeDemo }) });
}

export interface AdminLegal {
  at: string;
  accept: { id: string; name: string; email: string | null; docs: Record<string, { v: string; at: string; ip: string | null }> }[];
  imports: { at: string; title: string | null; consent: string | null; new: number; status: string; undone: boolean; name: string | null; id: string }[];
  grants: { at: string; status: string; revoked: boolean; reason: string | null; name: string | null }[];
  purge: { id: string; name: string; requested_at: string; purge_at: string }[];
  proof: { reachable: number; with_proof: number };
}
export function useAdminLegal() {
  const { includeDemo } = useAdminScope();
  return useQuery({ queryKey: ['crm-admin', 'legal', includeDemo], staleTime: 30_000, queryFn: () => rpc<AdminLegal>('crm_admin_legal', { p_include_demo: includeDemo }) });
}

export interface AdminPricing { cfg: PricingCfg; history: { at: string; reason: string; before: PricingCfg; after: PricingCfg }[] }
export function useAdminPricing() {
  return useQuery({ queryKey: ['crm-admin', 'pricing'], staleTime: 15_000, queryFn: () => rpc<AdminPricing>('crm_admin_pricing_get') });
}
