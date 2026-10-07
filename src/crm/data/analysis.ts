/**
 * Données de l'analyse client (« Ce qui fait venir ») : une RPC par écran,
 * migration 20261010140000. Rien n'est calculé ici : le moteur tourne hors
 * écran (crons), ces lectures ne font que relire ses tables.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { FamilyStatus, Hypothesis } from '@/crm/lib/analysis';
import type { TargetAudience } from '@/crm/data/clients';

export interface AnalysisCoverage {
  families: Record<string, 'ok' | 'reduced' | 'unavailable'>;
  totals: Record<string, number>;
  scan_share: number | null; zip_share: number | null; launch_share: number | null;
  multi_share: number | null; multi_holder_share: number | null;
}

export interface AnalysisOverview {
  state: {
    computed_at: string | null; full_at: string | null; rules_version: number | null; people: number | null;
    stats: { people: number; once: number; returners: number; median_days: number | null; p25_days: number | null;
             p75_days: number | null; eligible: number; returned: number } | null;
    coverage: AnalysisCoverage | null;
  } | null;
  min_sample: number;
  rules_version: number;
  families: FamilyStatus[];
  newcomers: { n: number; by_family: Record<string, number> };
  once: { n: number; local: number; passing: number; unknown: number };
}

export interface ClientAnalysis {
  excluded: boolean;
  profile: boolean;
  computed_at: string | null;
  nights?: number;
  first?: {
    nid: string; event_id: string | null; title: string | null; start_at: string; series: string | null;
    deal: string | null; tier_rank: number | null; tier_count: number | null; lead_days: number | null;
    since_launch_h: number | null; src: string | null; medium: string | null; order_size: number;
    multi_holder: boolean; with_returning: boolean; invitation: boolean; table: boolean; door: boolean;
    dist_km: number | null; artists: { k: string; name: string | null; rare: boolean }[];
  };
  agg?: {
    artists: { k: string; name: string | null; n: number; series: number; rare: number }[];
    genres: { v: string; n: number }[];
    genre_nights: number;
    traits: Record<string, { v: string; n: number }[]>;
    series: { v: string; n: number; lineups: number }[];
    buy: { n: number; early: number; launch_known: number; launch: number; last_minute: number; door: number; group: number; table: number } | null;
    country: string | null; main_country: string | null; cp_known: boolean;
  };
  hyps?: Hypothesis[];
  dist_km?: number | null;
  passing?: boolean | null;
}

export interface NightAnalysisArtist {
  k: string; name: string | null; avatar: string | null; share: number | null; resident: boolean; first: boolean;
  nights: number | null; new_brought: number | null; fans: number | null;
  return_rate: number | null; new_eligible: number | null; new_returned: number | null;
}

export interface NightAnalysis {
  profile: boolean;
  computed_at?: string;
  title?: string | null; starts_at?: string; series?: string | null; slot?: string | null; weekday?: number | null;
  format?: string | null; genres?: string[];
  entries?: number; buyers?: number; new_people?: number; new_share?: number | null;
  launch_known?: boolean; launch_48h_share?: number | null;
  origin?: { src: Record<string, number>; far: number; foreign: number; group: number; invited: number; lead_days: number | null };
  return?: { eligible: number; returned: number; rate: number | null };
  artists?: NightAnalysisArtist[];
  usual?: { new_share: number | null; launch_48h_share: number | null; nights: number };
  newcomers?: { n: number; by_family: Record<string, number> };
  min_sample?: number;
  /** Seuil « loin » des règles en vigueur (km). */
  far_km?: number;
}

export interface ArtistRow {
  k: string; name: string | null; slug: string | null; avatar: string | null;
  nights: number; entries: number; new_brought: number; fans: number; share: number | null; last_night: string | null;
  /** Joue à plus de `resident_share` des soirées du compte (règle en vigueur). */
  resident: boolean;
  new_eligible: number; new_returned: number; return_rate: number | null;
}

export interface ArtistsAnalysis {
  min_sample: number;
  resident_share: number;
  baseline: { eligible: number; returned: number; rate: number | null };
  family: FamilyStatus | null;
  artists: ArtistRow[];
  total: number;
}

export function useAnalysisOverview(enabled = true) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'analysis-overview'],
    queryFn: () => rpc<AnalysisOverview>('crm_analysis_overview', args),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useClientAnalysis(email: string | null) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'client-analysis', email],
    queryFn: () => rpc<ClientAnalysis>('crm_client_analysis', { ...args, p_email: email }),
    enabled: !!email,
    staleTime: 60_000,
  });
}

export function useNightAnalysis(eventId: string | null) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'night-analysis', eventId],
    queryFn: () => rpc<NightAnalysis>('crm_night_analysis', { ...args, p_event_id: eventId }),
    enabled: !!eventId,
    staleTime: 5 * 60_000,
  });
}

/** « Qui cibler » (migration 20261011110000) : audiences sans place d'une soirée à venir. */
export interface NightTargetAudience {
  key: TargetAudience;
  n: number; email: number; sms: number;
  family?: string;
  status?: FamilyStatus['status'];
  availability?: FamilyStatus['availability'];
  gain?: number;
  moment: 'now' | 'week' | 'eve';
  send_at: string;
  params?: { series?: string | null; editions?: number; artists?: { name: string; n: number }[]; genres?: string[] };
}

export interface NightTargets {
  ok: boolean;
  error?: 'event_not_found' | 'not_upcoming';
  event?: { id: string; title: string; start_at: string; series: string | null; genres: string[] };
  days_left?: number;
  has_ticket?: number;
  computed?: boolean;
  union?: { n: number; email: number; sms: number };
  audiences?: NightTargetAudience[];
}

export function useNightTargets(eventId: string | null) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'night-targets', eventId],
    queryFn: () => rpc<NightTargets>('crm_night_targets', { ...args, p_event_id: eventId }),
    enabled: !!eventId,
    staleTime: 2 * 60_000,
  });
}

export function useArtistsAnalysis(enabled = true, limit = 40) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'artists-analysis', limit],
    queryFn: () => rpc<ArtistsAnalysis>('crm_artists_analysis', { ...args, p_limit: limit }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Droit d'opposition : exclure (ou réintégrer) un contact du profilage. */
export function useProfileOptout() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { email: string; on: boolean }) =>
      rpc<{ email: string; excluded: boolean }>('crm_profile_optout', { ...args, p_email: p.email, p_on: p.on }),
    onSuccess: (_d, p) => { qc.invalidateQueries({ queryKey: ['crm', qk, 'client-analysis', p.email] }); },
  });
}

export interface LearningContrib { learning_contrib: boolean; global_enabled: boolean; demo: boolean; holder: boolean }

export function useLearningContrib() {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'learning-contrib'],
    queryFn: () => rpc<LearningContrib>('crm_learning_contrib_get', args),
    staleTime: 5 * 60_000,
  });
}

export function useSetLearningContrib() {
  const { rpc: args, qk } = useCrmScope();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => rpc<{ learning_contrib: boolean }>('crm_learning_contrib_set', { ...args, p_on: on }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm', qk, 'learning-contrib'] }); },
  });
}
