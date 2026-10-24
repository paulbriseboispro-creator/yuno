/**
 * Données de l'écran Segments de Yuno Tickets (copie de src/crm/data/segments.ts) :
 * vue d'ensemble d'une période (tix_segments_overview), fiche d'un segment
 * (tix_segment_detail), effectifs des modèles (tix_audience_counts).
 */
import { useEffect, useRef } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useTixScope } from '@/tickets/clients/scope';
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
  sources: { yuno: number; import: number; other: number };
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
  /** Dates repères de la période pas encore calculées : l'évolution arrive juste après. */
  anchors_pending?: number;
}

export interface SegmentDetail {
  key: string;
  period: SegPeriod;
  entered: number;
  exited: number;
  sends: { id: string; channel: 'email' | 'sms'; name: string | null; sent_at: string; received: number; clicked: number; revenue: number; buyers: number }[];
}

export function useSegmentsOverview(period: SegPeriod) {
  const { rpc: args, qk, ready } = useTixScope();
  const qc = useQueryClient();
  const q = useQuery({
    enabled: ready,
    queryKey: ['tix-cli', qk, 'segments', period],
    queryFn: () => rpc<SegmentsOverview>('tix_segments_overview', { ...args, p_period: period }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  // Les dates repères (début de période, puis deux points intermédiaires)
  // manquent la première fois et après la création d'un segment : l'écran
  // s'affiche sans elles, on les fait calculer une par une (~1,5 s chacune
  // sur un gros compte), puis on relit l'écran. Une seule tentative par
  // espace et par période : un échec laisse simplement l'évolution à « — ».
  const pending = q.data?.period === period ? q.data.anchors_pending ?? 0 : 0;
  const tried = useRef(new Set<string>());
  useEffect(() => {
    const key = `${qk}:${period}`;
    if (!pending || tried.current.has(key)) return;
    tried.current.add(key);
    void (async () => {
      let filled = false;
      try {
        for (let i = 0; i < 4; i++) {
          const r = await rpc<{ remaining: number }>('tix_segments_fill_anchors', { ...args, p_period: period });
          filled = true;
          if (!r || r.remaining <= 0) break;
        }
      } catch {
        // Rien à montrer : l'écart reste « — » jusqu'à la prochaine visite.
      }
      if (filled) await qc.invalidateQueries({ queryKey: ['tix-cli', qk, 'segments', period], exact: true });
    })();
  }, [pending, qk, period, args, qc]);

  return q;
}

export function useSegmentDetail(key: string | null, period: SegPeriod) {
  const { rpc: args, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-cli', qk, 'segments', 'detail', key, period],
    queryFn: () => rpc<SegmentDetail | null>('tix_segment_detail', { ...args, p_seg_key: key, p_period: period }),
    enabled: ready && !!key,
    staleTime: 60_000,
  });
}

export function useAudienceCounts(defs: ClientFilterDef[], enabled: boolean) {
  const { rpc: args, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-cli', qk, 'audience-counts', defs],
    queryFn: () => rpc<{ total: number; reachable: number }[]>('tix_audience_counts', { ...args, p_defs: defs }),
    enabled: ready && enabled,
    staleTime: 60_000,
  });
}

export const AUTO_KEYS: Lifecycle[] = ['hab', 'occ', 'nou', 'end', 'none'];
export const isAutoKey = (k: string): k is Lifecycle => (AUTO_KEYS as string[]).includes(k);
