import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Les RPC d'audience viennent d'être créées et ne sont pas encore dans les types
// générés (types.ts) → on caste l'appel. À régénérer après le push final.
type RpcResult = { data: unknown; error: unknown };
const rpc = (name: string, params: Record<string, unknown>): Promise<RpcResult> =>
  (supabase.rpc as unknown as (n: string, p: Record<string, unknown>) => Promise<RpcResult>)(name, params);

export type AudienceSubject = { type: 'venue' | 'dj' | 'organizer'; id: string };

export interface AudienceAnalytics {
  ok: boolean;
  total: number; reachable: number; notify_all: number;
  age_known: number; gender_known: number; recent_30d: number;
  growth: { month: string; count: number }[];
  age_buckets: { bucket: string; count: number }[];
  gender: { label: string; count: number }[];
  cities: { city: string; count: number }[];
  languages: { lang: string; count: number }[];
  personas: { persona: string; count: number }[];
  music: { style: string; count: number }[];
}
export interface AudienceGrowth {
  ok: boolean;
  series: { date: string; total: number; gained: number; lost: number; net: number; reachable: number }[];
  ledger_start: string | null;
}
export interface AudienceSegments {
  ok: boolean; total: number;
  engagement: { engaged: number; passive: number; unreachable: number };
  superfans: number;
  cohort: { new_30d: number; established: number };
  converted: number | null;
  spend_tiers: { tier: string; count: number; revenue: number }[] | null;
  recency: { active: number; at_risk: number; lapsed: number } | null;
}
export interface AudienceNotifications {
  ok: boolean;
  reach: { reachable: number; total: number };
  best_send: { dow: number | null; hour: number | null; engagement: number | null };
  push_30d: { sent: number; clicked: number; ctr: number };
  campaigns: { id: string; title: string; created_at: string; targeted: number; sent: number; clicked: number; ctr: number }[];
}
export interface AudienceRevenue {
  ok: boolean; supported: boolean;
  from?: string; to?: string;
  followers?: { orders: number; gross: number; net: number };
  non_followers?: { orders: number; gross: number; net: number };
  follower_share?: number;
}

export interface AudienceData {
  analytics: AudienceAnalytics | null;
  growth: AudienceGrowth | null;
  segments: AudienceSegments | null;
  notifications: AudienceNotifications | null;
  revenue: AudienceRevenue | null;
}

function ok<T extends { ok?: boolean }>(v: unknown): T | null {
  const r = v as T | null;
  return r && (r as { ok?: boolean }).ok ? r : null;
}

export function useAudienceData(subject: AudienceSubject | null) {
  const [data, setData] = useState<AudienceData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!subject?.id) { setLoading(false); return; }
    setLoading(true);
    const p = { p_subject_type: subject.type, p_subject_id: subject.id };
    try {
      const [a, g, s, n, r] = await Promise.all([
        rpc('get_audience_analytics', p),
        rpc('get_audience_growth', p),
        rpc('get_audience_segments', p),
        rpc('get_audience_notifications', p),
        rpc('get_audience_revenue', p),
      ]);
      setData({
        analytics: ok<AudienceAnalytics>(a.data),
        growth: ok<AudienceGrowth>(g.data),
        segments: ok<AudienceSegments>(s.data),
        notifications: ok<AudienceNotifications>(n.data),
        revenue: ok<AudienceRevenue>(r.data),
      });
    } catch (err) {
      console.error('useAudienceData error:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [subject?.type, subject?.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return { data, loading, refetch: fetchAll };
}
