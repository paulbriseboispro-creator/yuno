/**
 * Données de l'écran Segments : vue d'ensemble d'une période (crm_segments_overview),
 * fiche d'un segment (crm_segment_detail), effectifs des modèles (crm_audience_counts).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { ClientFilterDef, Lifecycle } from './clients';

export type SegPeriod = '30d' | '90d' | '12m';

export interface MsgStats { received: number; clicked: number; ticketing: number; bought: number; buyers: number; revenue: number }

export interface SegmentRow {
  key: string;
  kind: 'auto' | 'custom';
  name: string | null;
  description: string | null;
  template: string | null;
  definition: ClientFilterDef;
  created_at: string | null;
  n: number;
  reachable: number;
  email: number;
  sms: number;
  avg_spend: number | null;
  avg_nights: number | null;
  sources: { shotgun: number; utm: number; import: number; other: number };
  msg: MsgStats;
  n_start: number | null;
  spark: { d: string; n: number }[];
}

export interface SendRow extends MsgStats {
  id: string;
  channel: 'email' | 'sms';
  name: string | null;
  sent_at: string;
  /** Clé d'un segment automatique, uuid d'un segment à vous, 'all' ou 'custom'. */
  target: string;
}

export interface SegmentsOverview {
  period: SegPeriod;
  from: string;
  to: string;
  step_days: number;
  totals: MsgStats & { sends: number; prev_revenue: number; has_prev: boolean };
  series: { t: string; v: number; sends: string[] }[];
  segments: SegmentRow[];
  sends: SendRow[];
  rules: { regular_min_nights: number; regular_window_months: number; lapse_months: number };
  computed_at: string;
}

export interface SegmentDetail {
  key: string;
  period: SegPeriod;
  entered: number;
  exited: number;
  sends: { id: string; channel: 'email' | 'sms'; name: string | null; sent_at: string; received: number; clicked: number; revenue: number; buyers: number }[];
}

export function useSegmentsOverview(period: SegPeriod) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'segments', period],
    queryFn: () => rpc<SegmentsOverview>('crm_segments_overview', { ...args, p_period: period }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useSegmentDetail(key: string | null, period: SegPeriod) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'segments', 'detail', key, period],
    queryFn: () => rpc<SegmentDetail | null>('crm_segment_detail', { ...args, p_seg_key: key, p_period: period }),
    enabled: !!key,
    staleTime: 60_000,
  });
}

export function useAudienceCounts(defs: ClientFilterDef[], enabled: boolean) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'audience-counts', defs],
    queryFn: () => rpc<{ total: number; reachable: number }[]>('crm_audience_counts', { ...args, p_defs: defs }),
    enabled,
    staleTime: 60_000,
  });
}

export const AUTO_KEYS: Lifecycle[] = ['hab', 'occ', 'nou', 'end', 'none'];
export const isAutoKey = (k: string): k is Lifecycle => (AUTO_KEYS as string[]).includes(k);
