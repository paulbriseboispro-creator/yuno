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

export function useAiUsage(range: PeriodRange, includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'ai', range.days, includeDemo],
    queryFn: () => rpc<{
      totals: { events: number; prev_events: number; cost_usd: number; prev_cost_usd: number; users: number; errors: number; tokens: number };
      by_assistant: Array<{ assistant: string; n: number; users: number; cost_usd: number; errors: number }>;
      by_day: Array<{ d: string; n: number; cost_usd: number }>;
    }>('admin_ai_usage', { p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_include_demo: includeDemo }),
    staleTime: 60_000,
  });
}

export function useCrmProduct(includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'pilot', 'crmProduct', includeDemo],
    queryFn: () => rpc<{ live: number; paid: number }>('crm_admin_product', { p_include_demo: includeDemo }),
    staleTime: 5 * 60_000,
  });
}
