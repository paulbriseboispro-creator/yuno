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
  owner_id: string | null;
  trial_ext: { used: number; free: number };
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
  bonus_tiers: { min: number; pct: number }[];
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
  shotgun: { conns: number; runs24: number; errors24: number; req24: number; hours: { h: string; req: number; runs: number }[]; window: { used: number; window_start: string } | null; errors: { at: string; error: string | null; name: string | null; id: string }[]; duration: { n: number; p50: number | null; p95: number | null; open: number } };
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

export interface AdminScenarioAccount {
  id: string; name: string; city: string | null; kind: string | null;
  /** frozen = envoi gelé par un geste admin ; plan_paused = compte en pause (essai fini, impayé). */
  state: 'frozen' | 'plan_paused' | 'ok';
  active: number; paused: number; drafts: number; by_ai: number; broken: number;
  on_their_way: number; entered7: number; sent7: number; would_send7: number; expired7: number;
  held_now: number; held_reason: string | null; last_change: string | null;
}
export interface AdminScenarios {
  at: string;
  totals: { accounts: number; active: number; paused: number; drafts: number; by_ai: number; broken: number; on_their_way: number; entered7: number; sent7: number; expired7: number; held_now: number };
  /** Messages retenus en ce moment, par raison (tous comptes). */
  held: Record<string, number>;
  accounts: AdminScenarioAccount[];
}
/** Admin CRM › Plateforme › Scénarios : des agrégats par compte, jamais une personne. */
export function useAdminScenarios(enabled = true) {
  const { includeDemo } = useAdminScope();
  return useQuery({ queryKey: ['crm-admin', 'scenarios', includeDemo], staleTime: 30_000, enabled, queryFn: () => rpc<AdminScenarios>('crm_admin_scenarios', { p_include_demo: includeDemo }) });
}

export interface AdminDailyItem { id: string; name: string; [k: string]: unknown }
export interface AdminDaily {
  at: string;
  sync_errors: (AdminDailyItem & { error: string | null })[];
  deliverability: (AdminDailyItem & { sent: number; bounced: number; complained: number })[];
  trials_ending: (AdminDailyItem & { trial_ends_at: string })[];
  silent: (AdminDailyItem & { state: string; last_send_at: string | null })[];
  forecast: (AdminDailyItem & { title: string; start_at: string; err_pct: number })[];
  audits: (AdminDailyItem & { event_id: string; title: string; start_at: string; trial_ends_at: string | null })[];
  counts: Record<'sync_errors' | 'deliverability' | 'trials_ending' | 'silent' | 'forecast' | 'audits', number>;
}
/** Admin CRM › Plateforme › Bilan du jour (agents, lot A5) : agrégats, jamais une personne. */
export function useAdminDaily(enabled = true) {
  const { includeDemo } = useAdminScope();
  return useQuery({ queryKey: ['crm-admin', 'daily', includeDemo], staleTime: 60_000, enabled, queryFn: () => rpc<AdminDaily>('crm_admin_daily', { p_include_demo: includeDemo }) });
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

// ── Vente, Acquisition, Produit ─────────────────────────────────────────────
export type ProspectStage = 'prospect' | 'contacted' | 'demo' | 'lost';
export interface Prospect {
  id: string; name: string; contact: string | null; phone: string | null; email: string | null; city: string | null; kind: 'club' | 'organizer' | 'association';
  source: string | null; stage: ProspectStage; next_action: string | null; next_at: string | null; loss_reason: string | null; note: string | null; opposed: boolean;
  stage_changed_at: string; created_at: string; events: { at: string; kind: 'created' | 'stage' | 'exchange'; text: string }[];
}
export interface AdminPipeline {
  at: string; prospects: Prospect[]; price: number;
  accounts: { id: string; name: string; city: string | null; state: AdminAccount['state']; mrr: number; trial_left: number | null; type: string }[];
}
export function useAdminPipeline() {
  const { includeDemo } = useAdminScope();
  return useQuery({ queryKey: ['crm-admin', 'pipeline', includeDemo], staleTime: 15_000, queryFn: () => rpc<AdminPipeline>('crm_admin_pipeline', { p_include_demo: includeDemo }) });
}

export interface AdminAcquisition {
  at: string; days: number;
  funnel: { k: 'opened' | 'role' | 'structure' | 'account' | 'created' | 'console' | 'paid'; n: number }[];
  median_secs: number | null;
  sessions: { at: string; started: string; who: string | null; org: string | null; city: string | null; last_step: string | null; steps: Record<string, string>; source: string | null; device: string | null; account: boolean; state: string | null; secs: number }[];
  sources: { source: string; started: number; created: number; paid: number }[];
  devices: { device: string; n: number }[];
  series: { t: string; started: number; created: number }[];
}
export function useAdminAcquisition(days: number) {
  const { includeDemo } = useAdminScope();
  return useQuery({ queryKey: ['crm-admin', 'acquisition', includeDemo, days], staleTime: 30_000, queryFn: () => rpc<AdminAcquisition>('crm_admin_acquisition', { p_include_demo: includeDemo, p_days: days }) });
}

export interface AdminProduct {
  at: string; live: number; paid: number;
  usage: { step: number; n: number; paid: number }[];
  ttv: { n: number; sync: number | null; sent: number | null; bought: number | null; n_sync: number; n_sent: number; n_bought: number };
  waitlist: { feature: string; n: number }[];
  recipes: { kind: string; n: number }[];
  retention: { with_recipes: number; with_recipes_paid: number; without: number; without_paid: number };
}
export function useAdminProduct() {
  const { includeDemo } = useAdminScope();
  return useQuery({ queryKey: ['crm-admin', 'product', includeDemo], staleTime: 30_000, queryFn: () => rpc<AdminProduct>('crm_admin_product', { p_include_demo: includeDemo }) });
}

// ── Activité en direct ──────────────────────────────────────────────────────
export type ActivityKind = 'signup' | 'account' | 'buy' | 'send' | 'fail' | 'admin';
export interface ActivityEvent {
  at: string; k: ActivityKind; who: string | null; tag: string; id: string | null;
  meta: { step?: string | null; source?: string | null; city?: string | null; secs?: number | null; yunits?: number; eur?: number; name?: string | null; recipients?: number | null; error?: string | null; reason?: string | null };
}
export interface AdminActivity { at: string; live: number; events: ActivityEvent[] }
/** Rafraîchi en douceur toutes les 30 s tant que l'onglet est visible. */
export function useAdminActivity(enabled = true) {
  const { includeDemo } = useAdminScope();
  return useQuery({
    queryKey: ['crm-admin', 'activity', includeDemo], enabled, staleTime: 15_000, refetchInterval: 30_000,
    queryFn: () => rpc<AdminActivity>('crm_admin_activity', { p_include_demo: includeDemo, p_limit: 150 }),
  });
}
/** Pastille du menu : les inscriptions en cours. */
export function useAdminLiveSignups() {
  const { includeDemo } = useAdminScope();
  return useQuery({
    queryKey: ['crm-admin', 'live', includeDemo], staleTime: 15_000, refetchInterval: 30_000,
    queryFn: () => rpc<number>('crm_admin_live_signups', { p_include_demo: includeDemo }),
  });
}
