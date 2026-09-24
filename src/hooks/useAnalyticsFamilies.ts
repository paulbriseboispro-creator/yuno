import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { CommunityOverview, PageTraffic } from '@/lib/communityAnalytics';

export interface AnalyticsScope {
  venueId?: string | null;
  organizerUserId?: string | null;
}

type RpcState<T> = { data: T | null; loading: boolean; error: 'forbidden' | 'error' | null; fetchedAt: Date | null };

/** Appelle une RPC d'analyse de portée et garde la dernière réponse `ok`. */
function useScopedRpc<T extends { ok: true }>(fn: string, args: Record<string, unknown> | null, deps: unknown[]): RpcState<T> {
  const [state, setState] = useState<RpcState<T>>({ data: null, loading: true, error: null, fetchedAt: null });
  useEffect(() => {
    if (!args) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const { data: raw, error } = await supabase.rpc(fn as never, args as never);
        if (cancelled) return;
        if (error) throw error;
        const res = raw as unknown as (T | { ok: false; reason?: string }) | null;
        if (!res || !res.ok) {
          const reason = res && 'reason' in res ? res.reason : null;
          setState({ data: null, loading: false, error: reason === 'forbidden' ? 'forbidden' : 'error', fetchedAt: null });
          return;
        }
        setState({ data: res as T, loading: false, error: null, fetchedAt: new Date() });
      } catch (e) {
        console.error(fn, e);
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: 'error' }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function scopeArgs(scope: AnalyticsScope): Record<string, unknown> | null {
  if (scope.organizerUserId) return { p_organizer_user_id: scope.organizerUserId };
  if (scope.venueId) return { p_venue_id: scope.venueId };
  return null;
}

/** Communauté › Vue d'ensemble (`get_community_overview`). */
export function useCommunityOverview(scope: AnalyticsScope) {
  const args = scopeArgs(scope);
  return useScopedRpc<CommunityOverview>('get_community_overview', args, [scope.venueId, scope.organizerUserId]);
}

/** Trafic › Ma page et Par soirée (`get_page_traffic`). */
export function usePageTraffic(scope: AnalyticsScope, days: number) {
  const base = scopeArgs(scope);
  const args = base ? { ...base, p_days: days } : null;
  return useScopedRpc<PageTraffic>('get_page_traffic', args, [scope.venueId, scope.organizerUserId, days]);
}
