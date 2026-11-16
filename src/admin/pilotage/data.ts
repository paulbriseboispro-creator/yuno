/**
 * Lectures de la rubrique « Pilotage ». Une RPC par bloc, aucune agrégation au
 * front (seules des additions de parts déjà calculées : revenu de Yuno).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { PeriodRange } from '../context/period';

export async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data as T;
}

export interface CurPrev { cur: number; prev: number }

export interface OverviewMonth {
  m: string; sales: number; fees: number; subs: number; recharges: number; refunds: number;
  mrr_end: number; new_pros: number; selling: number; buyers: number;
}

export interface PilotOverview {
  days: number;
  kpis: {
    sales: CurPrev; fees: CurPrev; subs: CurPrev; recharges: CurPrev; mrr: CurPrev;
    selling: CurPrev; buyers: CurPrev; new_pros: CurPrev; refunds: CurPrev;
  };
  series: Array<{ d: string; fees: number; subs: number; recharges: number }>;
  prev_series: Array<{ d: string; total: number }>;
  months: OverviewMonth[];
  concentration: {
    total: number; pros_selling: number; top5: number;
    top: Array<{ key: string; name: string | null; amount: number; n: number }>;
  };
}

export function usePilotOverview(range: PeriodRange, includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'overview', range.days, includeDemo],
    queryFn: () => rpc<PilotOverview>('admin_pilot_overview', { p_days: range.days, p_include_demo: includeDemo }),
    staleTime: 60_000,
  });
}

export interface ProductSteps { created: number; configured: number; first: number; paying: number }
export interface Acquisition {
  days: number;
  visits: number; opened: number; created: number; configured: number; first: number; paying: number;
  created_signup: number; robots: number; leads: number; to_contact: number;
  by_product: Partial<Record<'tickets' | 'crm', ProductSteps>>;
  median_days_to_first_sale: number | null; median_n: number;
  sources: Array<{ origin: { source?: string | null; utm_source?: string | null; referrer_host?: string | null } | null; started: number; created: number }>;
  by_day: Array<{ d: string; started: number; created: number }>;
  landing_by_day: Array<{ d: string; n: number }>;
}

export function useAcquisition(range: PeriodRange, includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'acquisition', range.days, includeDemo],
    queryFn: () => rpc<Acquisition>('admin_pro_acquisition', { p_days: range.days, p_include_demo: includeDemo }),
    staleTime: 60_000,
  });
}

export interface Retention {
  cohorts: Array<{ m: string; size: number; months_elapsed: number; active: number[]; amount: number[] }>;
  pros_ever: number;
  crm_departures: Array<{ key: string; name: string | null; at: string; price: number }>;
  crm_states: Record<string, number>;
  crm_paused: Array<{ key: string; name: string | null; state: string }>;
}

export function useRetention(includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'retention', includeDemo],
    queryFn: () => rpc<Retention>('admin_pro_retention', { p_include_demo: includeDemo }),
    staleTime: 5 * 60_000,
  });
}

export interface BuyersStats { active: CurPrev; returning: CurPrev; new: CurPrev; ever: number }

export function useBuyers(range: PeriodRange, includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'buyers', range.days, includeDemo],
    queryFn: () => rpc<BuyersStats>('admin_buyers_stats', { p_days: range.days, p_include_demo: includeDemo }),
    staleTime: 60_000,
  });
}

/** Trafic de la plateforme (get_platform_traffic), sur la période et la précédente. */
export interface Traffic {
  totals: { sessions: number; visitors: number; pageviews: number; bounce_rate: number; native_sessions: number; avg_session_seconds: number };
  funnel: { sessions: number; event_views: number; checkouts: number; purchases: number };
  series: Array<{ t: string; sessions: number; visitors: number; pageviews: number }>;
  channels: Array<{ channel: string; sessions: number; visitors: number }>;
  referrers: Array<{ host: string; sessions: number }>;
  countries: Array<{ k: string; n: number }>;
  devices: Array<{ k: string; n: number }>;
  pages: Array<{ path: string; views: number; sessions: number; avg_seconds: number }>;
}

export function useTraffic(range: PeriodRange) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'traffic', range.days, range.from.toISOString().slice(0, 16)],
    queryFn: async () => {
      const [cur, prev] = await Promise.all([
        rpc<Traffic>('get_platform_traffic', { p_from: range.from.toISOString(), p_to: range.to.toISOString() }),
        rpc<Traffic>('get_platform_traffic', { p_from: range.prevFrom.toISOString(), p_to: range.prevTo.toISOString() }),
      ]);
      return { cur, prev };
    },
    staleTime: 60_000,
  });
}

/** Installations d'app : admin_cockpit (depuis le lancement, iPhone client / Pro). */
export function useInstalls(includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'installs', includeDemo],
    queryFn: () => rpc<{ since_launch: { installs_client: number; installs_pro: number; push_subscriptions: number } }>('admin_cockpit', { p_include_demo: includeDemo }),
    staleTime: 5 * 60_000,
  });
}

export interface AiUsage {
  totals: {
    events: number; chats: number; users: number; prompt_tokens: number; completion_tokens: number; tokens: number; cost_usd: number;
    errors: number; error_rate: number; avg_latency_ms: number; p95_latency_ms: number; avg_turns: number; tool_events: number;
    prev_events: number; prev_cost_usd: number; prev_tokens: number;
  };
  by_assistant: Array<{ assistant: string; n: number; users: number; tokens: number; cost_usd: number; errors: number; avg_latency_ms: number; avg_turns: number }>;
  by_day: Array<{ d: string; n: number; tokens: number; cost_usd: number; errors: number }>;
  by_model: Array<{ model: string; n: number; tokens: number; cost_usd: number }>;
  recent: Array<{
    id: number; at: string; assistant: string; model: string; email: string | null; status: string; error: string | null; tokens: number | null;
    cost_usd: number; latency_ms: number | null; turns: number | null; tools: string[] | null; language: string | null; prompt: string | null;
  }>;
  recent_errors: Array<{ id: number; at: string; assistant: string; status: string; error: string | null; email: string | null }>;
  top_tools: Array<{ tool: string; n: number; assistant: string }>;
}

export function useAiUsage(range: PeriodRange, includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'ai', range.days, includeDemo],
    queryFn: () => rpc<AiUsage>('admin_ai_usage', { p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_include_demo: includeDemo }),
    staleTime: 60_000,
  });
}

export interface McpUsage {
  totals: {
    active_connections: number; connected_users: number; customers_level: number; new_connections: number; revoked: number;
    security_revocations: number; calls: number; prev_calls: number; errors: number; active_users: number; avg_ms: number | null;
  };
  by_tool: Array<{ tool: string; n: number; errors: number; avg_ms: number | null }>;
  by_client: Array<{ client: string; connections: number; calls: number }>;
  by_space: Array<{ space: string; name: string; calls: number }>;
  recent_errors: Array<{ tool: string; error: string | null; status: string; at: string }>;
}

export function useMcpUsage(range: PeriodRange, includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'mcp', range.days, includeDemo],
    queryFn: () => rpc<McpUsage>('admin_mcp_usage', { p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_include_demo: includeDemo }),
    staleTime: 60_000,
  });
}

export interface KV { k: string; n: number }
export interface ProductInsights {
  page_groups: Array<{ group: string; views: number; sessions: number; avg_seconds: number | null }>;
  top_events_viewed: Array<{ id: string; title: string; start_at: string; venue_name: string | null; views: number; sessions: number; avg_seconds: number | null; guestlist: number; tickets: number }>;
  top_paths: Array<{ path: string; group: string; views: number; avg_seconds: number | null }>;
  favorites: {
    by_type: Array<{ type: string; period: number; total: number }>;
    top_events: Array<{ id: string; title: string; start_at: string; n: number }>;
    top_venues: Array<{ id: string; name: string; city: string | null; n: number }>;
    top_djs: Array<{ id: string; name: string; n: number }>;
  };
  follows: { by_subject: Array<{ subject: string; follows: number; unfollows: number }> };
  taste: { profiles: number; genres: KV[]; night_type: KV[]; budget: KV[]; frequency: KV[]; drink: KV[]; booking: KV[] };
  audience: { cities: KV[]; languages: KV[]; genders: KV[]; ages: KV[]; personas: KV[]; session_countries: KV[]; session_languages: KV[]; session_devices: KV[] };
  entry: {
    guestlist: number; guestlist_scanned: number; tickets: number; tickets_scanned: number; tables: number; wallet_passes: number;
    wallet_by_type: KV[]; guest_checkout_share: number | null; abandoned_carts: number;
  };
  notifications: {
    push_users: number; push_by_platform: KV[];
    auto_push: Array<{ key: string; sent: number; clicked: number; failed: number; ctr: number }>;
    discovery_sent: number; discovery_opened: number; discovery_opt_out: number; newsletter_opt_in: number; newsletter_opt_out_period: number;
  };
  feedback: {
    open: number; by_category: KV[];
    recent: Array<{ id: string; title: string; category: string; priority: string; status: string; at: string; reporter: string | null; venue: string | null }>;
    incidents: number; email_complaints: number;
  };
  ai_questions: Array<{ at: string; q: string; lang: string | null; turns: number | null; status: string }>;
  pro_questions: Array<{ at: string; q: string; assistant: string; tools: string[] | null; status: string }>;
  links_interest: Array<{ target: string; n: number }>;
}

export function useProductInsights(range: PeriodRange, includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'insights', range.days, includeDemo],
    queryFn: () => rpc<ProductInsights>('admin_product_insights', { p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_include_demo: includeDemo }),
    staleTime: 60_000,
  });
}

export interface CrmProduct {
  at: string; live: number; paid: number;
  usage: Array<{ step: number; n: number; paid: number }>;
  ttv: { n: number; sync: number | null; sent: number | null; bought: number | null; n_sync: number; n_sent: number; n_bought: number };
  waitlist: Array<{ feature: string; n: number }>;
  recipes: Array<{ kind: string; n: number }>;
  retention: { with_recipes: number; with_recipes_paid: number; without: number; without_paid: number };
}

export function useCrmProduct(includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'crmProduct', includeDemo],
    queryFn: () => rpc<CrmProduct>('crm_admin_product', { p_include_demo: includeDemo }),
    staleTime: 5 * 60_000,
  });
}

export type FeatureStatus = 'new' | 'seen' | 'planned' | 'done';
export interface CrmFeedback {
  at: string;
  nps: {
    n: number; promoters: number; passives: number; detractors: number; score: number | null; dismissed: number;
    responses: Array<{ at: string; score: number; comment: string | null; name: string; person: string | null; id: string }>;
  };
  requests: Array<{ key: string; body: string; accounts: number; n: number; names: string[]; status: FeatureStatus; reason: string | null; last_at: string }>;
}

export function useCrmFeedback(includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'crmFeedback', includeDemo],
    queryFn: () => rpc<CrmFeedback>('crm_admin_feedback', { p_include_demo: includeDemo }),
    staleTime: 30_000,
  });
}

export interface CrmLanding {
  at: string; days: number; visits: number; visitor_days: number; signup_starts: number; page_views: number;
  sections: Array<{ section: string; n: number }>;
  clicks: Array<{ target: string; section: string | null; n: number }>;
  sources: Array<{ source: string; visits: number; visitors: number; starts: number; signups: number; created: number }>;
  series: Array<{ t: string; visits: number; visitors: number }>;
}

export function useCrmLanding(days: number, includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'crmLanding', days, includeDemo],
    queryFn: () => rpc<CrmLanding>('crm_admin_landing', { p_include_demo: includeDemo, p_days: days }),
    staleTime: 30_000,
  });
}
