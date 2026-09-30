/**
 * Analytics v3 — une requête par carte, en cache (react-query), jamais une
 * page bloquée par un jeu de chiffres qu'elle ne lit pas.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { An3Audience, An3Benchmarks, An3Campaigns, An3Cohorts, An3Denied, An3Door, An3Insights, An3Overview, An3Pacing, An3Promoters, An3Rfm, An3Sales, An3Scope, An3Sources, An3Tonight } from '@/lib/analytics/an3Types';
import type { An3Compare } from '@/lib/analytics/an3Nav';

export interface An3Subject { eventId: string | null; from: string; to: string }

export class An3Error extends Error {
  reason: string;
  constructor(reason: string) { super(reason); this.reason = reason; }
}

async function callRpc<T extends { ok: true }>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw new An3Error(error.message);
  const d = data as T | An3Denied | null;
  if (!d) throw new An3Error('empty');
  if (!d.ok) throw new An3Error((d as An3Denied).reason);
  return d as T;
}

function scopeArgs(scope: An3Scope) {
  return { p_venue_id: scope.venueId ?? null, p_organizer_user_id: scope.organizerUserId ?? null };
}
function subjectArgs(subject: An3Subject) {
  return subject.eventId
    ? { p_event_id: subject.eventId, p_from: null, p_to: null }
    : { p_event_id: null, p_from: subject.from, p_to: subject.to };
}
const enabled = (scope: An3Scope) => !!(scope.venueId || scope.organizerUserId);
const STALE = 60_000;

export function useAn3Overview(scope: An3Scope, subject: An3Subject, compare: An3Compare): UseQueryResult<An3Overview, An3Error> {
  return useQuery({
    queryKey: ['an3', 'overview', scope.venueId ?? null, scope.organizerUserId ?? null, subject.eventId, subject.eventId ? null : subject.from, subject.eventId ? null : subject.to, compare],
    queryFn: () => callRpc<An3Overview>('get_analytics_overview', { ...scopeArgs(scope), ...subjectArgs(subject), p_compare: compare }),
    enabled: enabled(scope), staleTime: STALE,
  });
}

export function useAn3Pacing(eventId: string | null, compare: An3Compare, days = 30): UseQueryResult<An3Pacing, An3Error> {
  // Le pacing compare toujours à des soirées : « période d'avant » n'a pas de sens ici.
  const mode = compare === 'previous' ? 'comparable' : compare;
  return useQuery({
    queryKey: ['an3', 'pacing', eventId, mode, days],
    queryFn: () => callRpc<An3Pacing>('get_analytics_pacing', { p_event_id: eventId, p_compare: mode, p_days: days }),
    enabled: !!eventId, staleTime: STALE,
  });
}

export function useAn3Sales(scope: An3Scope, subject: An3Subject): UseQueryResult<An3Sales, An3Error> {
  return useQuery({
    queryKey: ['an3', 'sales', scope.venueId ?? null, scope.organizerUserId ?? null, subject.eventId, subject.eventId ? null : subject.from, subject.eventId ? null : subject.to],
    queryFn: () => callRpc<An3Sales>('get_analytics_sales', { ...scopeArgs(scope), ...subjectArgs(subject) }),
    enabled: enabled(scope), staleTime: STALE,
  });
}

export function useAn3Door(scope: An3Scope, subject: An3Subject): UseQueryResult<An3Door, An3Error> {
  return useQuery({
    queryKey: ['an3', 'door', scope.venueId ?? null, scope.organizerUserId ?? null, subject.eventId, subject.eventId ? null : subject.from, subject.eventId ? null : subject.to],
    queryFn: () => callRpc<An3Door>('get_analytics_door', { ...scopeArgs(scope), ...subjectArgs(subject) }),
    enabled: enabled(scope), staleTime: STALE,
  });
}

export function useAn3Promoters(scope: An3Scope, subject: An3Subject): UseQueryResult<An3Promoters, An3Error> {
  return useQuery({
    queryKey: ['an3', 'promoters', scope.venueId ?? null, scope.organizerUserId ?? null, subject.eventId, subject.eventId ? null : subject.from, subject.eventId ? null : subject.to],
    queryFn: () => callRpc<An3Promoters>('get_analytics_promoters', { ...scopeArgs(scope), ...subjectArgs(subject) }),
    enabled: enabled(scope), staleTime: STALE,
  });
}

export function useAn3Audience(scope: An3Scope, subject: An3Subject): UseQueryResult<An3Audience, An3Error> {
  return useQuery({
    queryKey: ['an3', 'audience', scope.venueId ?? null, scope.organizerUserId ?? null, subject.eventId, subject.eventId ? null : subject.from, subject.eventId ? null : subject.to],
    queryFn: () => callRpc<An3Audience>('get_analytics_audience', { ...scopeArgs(scope), ...subjectArgs(subject) }),
    enabled: enabled(scope), staleTime: STALE,
  });
}

export function useAn3Sources(scope: An3Scope, subject: An3Subject): UseQueryResult<An3Sources, An3Error> {
  return useQuery({
    queryKey: ['an3', 'sources', scope.venueId ?? null, scope.organizerUserId ?? null, subject.eventId, subject.eventId ? null : subject.from, subject.eventId ? null : subject.to],
    queryFn: () => callRpc<An3Sources>('get_analytics_sources', { ...scopeArgs(scope), ...subjectArgs(subject) }),
    enabled: enabled(scope), staleTime: STALE,
  });
}

export function useAn3Campaigns(scope: An3Scope, subject: An3Subject): UseQueryResult<An3Campaigns, An3Error> {
  return useQuery({
    queryKey: ['an3', 'campaigns', scope.venueId ?? null, scope.organizerUserId ?? null, subject.eventId, subject.eventId ? null : subject.from, subject.eventId ? null : subject.to],
    queryFn: () => callRpc<An3Campaigns>('get_analytics_campaigns', { ...scopeArgs(scope), ...subjectArgs(subject) }),
    enabled: enabled(scope), staleTime: STALE,
  });
}

export function useAn3Insights(scope: An3Scope, subject: An3Subject, compare: An3Compare): UseQueryResult<An3Insights, An3Error> {
  return useQuery({
    queryKey: ['an3', 'insights', scope.venueId ?? null, scope.organizerUserId ?? null, subject.eventId, subject.eventId ? null : subject.from, subject.eventId ? null : subject.to, compare],
    queryFn: () => callRpc<An3Insights>('get_analytics_insights', { ...scopeArgs(scope), ...subjectArgs(subject), p_compare: compare }),
    enabled: enabled(scope), staleTime: STALE,
  });
}

export function useAn3Rfm(scope: An3Scope): UseQueryResult<An3Rfm, An3Error> {
  return useQuery({
    queryKey: ['an3', 'rfm', scope.venueId ?? null, scope.organizerUserId ?? null],
    queryFn: () => callRpc<An3Rfm>('get_analytics_rfm', scopeArgs(scope)),
    enabled: enabled(scope), staleTime: 5 * STALE,
  });
}

export function useAn3Cohorts(scope: An3Scope): UseQueryResult<An3Cohorts, An3Error> {
  return useQuery({
    queryKey: ['an3', 'cohorts', scope.venueId ?? null, scope.organizerUserId ?? null],
    queryFn: () => callRpc<An3Cohorts>('get_analytics_cohorts', { ...scopeArgs(scope), p_months: 12 }),
    enabled: enabled(scope), staleTime: 5 * STALE,
  });
}

/** Ce soir : rafraîchi toutes les 30 s tant que l'onglet est visible. */
export function useAn3Tonight(scope: An3Scope): UseQueryResult<An3Tonight, An3Error> {
  return useQuery({
    queryKey: ['an3', 'tonight', scope.venueId ?? null, scope.organizerUserId ?? null],
    queryFn: () => callRpc<An3Tonight>('get_analytics_tonight', scopeArgs(scope)),
    enabled: enabled(scope), staleTime: 15_000, refetchInterval: 30_000, refetchIntervalInBackground: false,
  });
}

export function useAn3Benchmarks(scope: An3Scope): UseQueryResult<An3Benchmarks, An3Error> {
  return useQuery({
    queryKey: ['an3', 'benchmarks', scope.venueId ?? null, scope.organizerUserId ?? null],
    queryFn: () => callRpc<An3Benchmarks>('get_analytics_benchmarks', scopeArgs(scope)),
    enabled: enabled(scope), staleTime: 30 * STALE,
  });
}

/** L'état d'une carte à partir d'une requête et d'un test « a-t-on quelque chose à montrer ? ». */
export function cardState<T>(q: UseQueryResult<T, An3Error>, hasData: (d: T) => boolean): 'loading' | 'error' | 'empty' | 'ready' {
  if (q.isLoading) return 'loading';
  if (q.isError) return 'error';
  if (!q.data || !hasData(q.data)) return 'empty';
  return 'ready';
}
