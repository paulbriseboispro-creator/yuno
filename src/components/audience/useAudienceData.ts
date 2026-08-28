import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Les RPC d'audience viennent d'être créées et ne sont pas encore dans les types
// générés (types.ts) → on caste l'appel. À régénérer après le push final.
type RpcResult = { data: unknown; error: unknown };
const rpc = (name: string, params: Record<string, unknown>): Promise<RpcResult> =>
  (supabase.rpc as unknown as (n: string, p: Record<string, unknown>) => Promise<RpcResult>)(name, params);

export type AudienceSubject = { type: 'venue' | 'dj' | 'organizer' | 'agency'; id: string };

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
  repeat_buyers: number | null;
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
export interface AudienceAttribution {
  ok: boolean; supported: boolean;
  campaigns?: { id: string; revenue: number; buyers: number }[];
  total_90d?: number;
}
export interface BenchStat { you: number | null; median: number | null; percentile: number | null }
export interface AudienceBenchmarks {
  ok: boolean; supported: boolean;
  city?: string; sample?: number;
  followers?: BenchStat;
  reach?: BenchStat;
}
export interface AudienceCohorts {
  ok: boolean;
  ledger_start: string | null;
  cohorts: { week: string; size: number; retained: number; retention: number }[];
}
export interface AudienceSources {
  ok: boolean;
  sources: { source: string; count: number }[];
}

export interface TrackedLinksSummary {
  links: number;
  clicks: number;
  conversions: number;
  revenue: number;
}

export interface AudienceData {
  analytics: AudienceAnalytics | null;
  growth: AudienceGrowth | null;
  segments: AudienceSegments | null;
  notifications: AudienceNotifications | null;
  revenue: AudienceRevenue | null;
  attribution: AudienceAttribution | null;
  emailAttribution: AudienceAttribution | null;
  trackedLinks: TrackedLinksSummary | null;
  benchmarks: AudienceBenchmarks | null;
  cohorts: AudienceCohorts | null;
  sources: AudienceSources | null;
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
      const isVenue = subject.type === 'venue';
      const [a, g, s, n, r, at, em, tl, bm, co, sr] = await Promise.all([
        rpc('get_audience_analytics', p),
        rpc('get_audience_growth', p),
        rpc('get_audience_segments', p),
        rpc('get_audience_notifications', p),
        rpc('get_audience_revenue', p),
        rpc('get_audience_push_attribution', p),
        // Attribution email (miroir de la push, matchée par email — venue + organizer)
        subject.type === 'venue' || subject.type === 'organizer'
          ? rpc('get_email_campaign_attribution', p)
          : Promise.resolve({ data: null, error: null } as RpcResult),
        // Résumé liens trackés (venue uniquement) pour la zone Performance
        isVenue
          ? rpc('get_tracked_link_stats', { p_owner_kind: 'venue', p_venue_id: subject.id })
          : Promise.resolve({ data: null, error: null } as RpcResult),
        rpc('get_audience_benchmarks', p),
        rpc('get_audience_cohorts', p),
        rpc('get_audience_sources', p),
      ]);
      let trackedLinks: TrackedLinksSummary | null = null;
      if (isVenue && Array.isArray(tl.data)) {
        const rows = tl.data as Array<{ clicks: number | null; conversions: number | null; revenue: number | null }>;
        trackedLinks = rows.reduce<TrackedLinksSummary>((acc, row) => ({
          links: acc.links + 1,
          clicks: acc.clicks + (Number(row.clicks) || 0),
          conversions: acc.conversions + (Number(row.conversions) || 0),
          revenue: acc.revenue + (Number(row.revenue) || 0),
        }), { links: 0, clicks: 0, conversions: 0, revenue: 0 });
      }
      setData({
        analytics: ok<AudienceAnalytics>(a.data),
        growth: ok<AudienceGrowth>(g.data),
        segments: ok<AudienceSegments>(s.data),
        notifications: ok<AudienceNotifications>(n.data),
        revenue: ok<AudienceRevenue>(r.data),
        attribution: ok<AudienceAttribution>(at.data),
        emailAttribution: ok<AudienceAttribution>(em.data),
        trackedLinks,
        benchmarks: ok<AudienceBenchmarks>(bm.data),
        cohorts: ok<AudienceCohorts>(co.data),
        sources: ok<AudienceSources>(sr.data),
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
