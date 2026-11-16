/**
 * Lectures de la rubrique « Aujourd'hui ». Une RPC par bloc :
 *   - admin_today        : la file et cinq des six chiffres ;
 *   - admin_cockpit      : les ventes de la semaine et les feux de santé
 *                          (jamais admin_release_health au chargement) ;
 *   - admin_activity_feed + crm_admin_activity : le fil unique.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CrmFeedItem, SuiteFeedItem, TodayPayload } from './queue';

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data as T;
}

export const TODAY_KEY = ['admin', 'today'] as const;

export function useToday(includeDemo: boolean) {
  return useQuery({
    queryKey: [...TODAY_KEY, 'queue', includeDemo],
    queryFn: () => rpc<TodayPayload>('admin_today', { p_include_demo: includeDemo, p_with_kpis: true }),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

/** Le compteur de la barre latérale : lignes urgentes non traitées (sans les chiffres). */
export function useTodayUrgentCount(): number {
  const q = useQuery({
    queryKey: [...TODAY_KEY, 'urgent'],
    queryFn: () => rpc<TodayPayload>('admin_today', { p_include_demo: false, p_with_kpis: false }),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
  });
  return q.data?.open_urgent ?? 0;
}

export interface CockpitWeek { gmv: number }
export interface CockpitHealth {
  urgent_alerts: number;
  crons_total: number;
  app_crashes_7d: number;
  ota_download_fail_7d: number;
  ai_errors_24h: number;
  maintenance_mode: boolean;
  payments_disabled: boolean;
  email_quota: { used: number; free: number; credits: number; remaining: number; day_used: number; day_cap: number } | null;
}
export interface CockpitLite {
  week: CockpitWeek;
  prev_week: CockpitWeek;
  health: CockpitHealth;
}

export function useCockpit(includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'cockpit', includeDemo],
    queryFn: () => rpc<CockpitLite>('admin_cockpit', { p_include_demo: includeDemo }),
    staleTime: 120_000,
  });
}

const FEED_PAGE = 40;

export function useSuiteFeed(includeDemo: boolean) {
  return useInfiniteQuery({
    queryKey: [...TODAY_KEY, 'feed', includeDemo],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const rows = await rpc<SuiteFeedItem[] | null>('admin_activity_feed', {
        p_limit: FEED_PAGE, p_before: pageParam, p_include_demo: includeDemo, p_kinds: null,
      });
      return rows ?? [];
    },
    getNextPageParam: (last) => (last.length < FEED_PAGE ? undefined : last[last.length - 1]?.at),
    staleTime: 60_000,
  });
}

export function useCrmFeed(includeDemo: boolean) {
  return useQuery({
    queryKey: [...TODAY_KEY, 'crm-feed', includeDemo],
    queryFn: async () => {
      const d = await rpc<{ events?: CrmFeedItem[] } | null>('crm_admin_activity', { p_include_demo: includeDemo, p_limit: 150 });
      return d?.events ?? [];
    },
    staleTime: 60_000,
  });
}

export type MarkStatus = 'done' | 'snoozed' | 'open';

export function useMarkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; status: MarkStatus; days?: number; reason?: string | null }) =>
      rpc('admin_today_mark', { p_key: v.key, p_status: v.status, p_days: v.days ?? 1, p_reason: v.reason ?? null }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: TODAY_KEY });
      void qc.invalidateQueries({ queryKey: ['admin', 'nav-badge'] });
    },
  });
}
