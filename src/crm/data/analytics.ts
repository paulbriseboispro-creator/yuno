/**
 * Données de l'écran Analyses (migration 20261005090000) : une lecture par
 * onglet, avec les mêmes filtres (période OU soirée, segment). Les montants
 * arrivent à null pour un rôle sans accès au chiffre d'affaires.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';

export type AnaPeriod = '24h' | '48h' | '7d' | '30d' | '90d' | '12m';
export type AnaSeg = 'all' | 'hab' | 'occ' | 'nou' | 'end';
export type AnaTab = 'sales' | 'traffic' | 'community';
/**
 * Famille de la source d'une vente, miroir de `_crm_ticket_source` (SQL,
 * migration 20261006210000) : lue dans `utm_source`, le seul champ de suivi
 * que l'API Tickets de Shotgun rend tel quel.
 */
export type SourceKey = 'yl' | 'em' | 'sm' | 'dm' | 'so' | 'sg' | 'au' | 'di' | 'of';
export const SOURCE_KEYS: SourceKey[] = ['yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of'];

export interface AnaFilters { period: AnaPeriod; event: string | null; seg: AnaSeg; cmp: boolean }

export interface AnaEventRef { id: string; title: string; start_at: string; night: string; upcoming?: boolean; days_left?: number }

export interface AnaMeta {
  mode: 'hour' | 'day' | 'month' | 'event';
  n: number;
  period: AnaPeriod;
  seg: AnaSeg;
  tz: string;
  night_end_hour: number;
  today: string;
  now: string;
  /** Début de chaque case : instant (heures) ou date (jours, mois, soirée). */
  labels: string[];
  start: string;
  event: AnaEventRef | null;
  prev_event: AnaEventRef | null;
}

export interface AnaSend { i: number; at: string; name: string; channel: 'email' | 'sms'; id: string }

export interface AnaCurve {
  id: string; title: string; start_at: string; night: string; upcoming: boolean;
  sold: number; cap: number | null; days_left: number;
  /** Billets cumulés de J-21 au jour J ; null après aujourd'hui. */
  curve: (number | null)[];
}

export interface AnaSales {
  meta: AnaMeta;
  series: { revenue: number | null; tickets: number; prev_revenue: number | null; prev_tickets: number }[];
  totals: {
    revenue: number | null; tickets: number; buyers: number; prev_revenue: number | null; prev_tickets: number;
    has_prev: boolean | null; refund_pct: number | null; prev_refund_pct: number | null;
    /** Soirée encore en vente : la précédente est comptée jusqu'au même J-k. */
    prev_same_day?: boolean;
    refunds: { amount: number | null; revenue: number | null };
  };
  msg: { share: number | null; revenue: number | null; tickets: number; by: { em: number; sm: number; dm: number } } | null;
  tariffs: { deal: string; price: number | null; tickets: number; revenue: number | null }[];
  /** Remplissage des soirées tenues dans la fenêtre (ou de la soirée choisie). */
  fill: { sold: number | null; cap: number | null; nights: number; prev_sold: number | null; prev_cap: number | null };
  seg_share: number | null;
  goal: { target: AnaCurve; refs: AnaCurve[]; week_sold: number } | null;
  heat: { cells: { n: number; amount: number | null }[][]; outside: number; days30: boolean };
  events: {
    id: string; title: string; start_at: string; night: string; upcoming: boolean; state: 'tonight' | 'presale' | 'past';
    tickets: number; revenue: number | null; sold: number; cap: number | null; prev_sold: number | null;
  }[];
  events_other: { count: number; tickets: number; revenue: number | null } | null;
  sends: AnaSend[];
  has_any: boolean;
}

export interface AnaTraffic {
  meta: AnaMeta;
  series: { revenue: Record<SourceKey, number> | null; tickets: Record<SourceKey, number>; clicks: number; new_buyers: number }[];
  sources: { k: SourceKey; orders: number; tickets: number; buyers: number; new_buyers: number; revenue: number | null; prev_tickets: number }[];
  clicks: { total: number; prev: number };
  buyers: { buyers: number; new: number; prev_buyers: number; prev_new: number };
  gained: { total: number; series: number[] };
  events: { id: string; title: string; start_at: string; night: string; upcoming: boolean; state: 'tonight' | 'presale' | 'past'; buyers: number; new_buyers: number; clicks: number }[];
  sends: AnaSend[];
  has_any: boolean;
}

export type Life = 'hab' | 'occ' | 'nou' | 'end' | 'none';

export interface AnaCommunity {
  meta: AnaMeta;
  rules: { min_nights: number; window_months: number; lapse_months: number };
  series: { total: number; new: number; prev_new: number; prev_total?: number }[];
  base: number;
  lifecycle: Record<Life, number>;
  reach: { total: number; email_sms: number; email: number; sms: number; none: number };
  stats: { came: number; returning: number; avg_nights: number | null; spent: number | null };
  spark: { returning_pct: number | null; avg_nights: number | null; spent: number | null }[];
  cohort: { id: string; title: string; night: string; buyers: number; back: (number | null)[] }[];
  hist: { n1: number; n2: number; n3: number; n5: number; n10: number };
  audience: { buyers: number; groups: Record<'nou' | 'occ' | 'hab' | 'end', { buyers: number; revenue: number | null }> };
  age: { known: number; total: number; b: number[] };
  city: { known: number; total: number; top: { city: string; n: number }[] };
  top: { email: string; first_name: string | null; last_name: string | null; nights: number; spent: number | null; last_night: string | null }[];
  wake: {
    end: { n: number; reachable: number };
    once: { n: number; reachable: number };
    hab_no_ticket: { event_id: string; title: string; n: number; reachable: number } | null;
  };
  has_any: boolean;
}

function args(f: AnaFilters) {
  return { p_period: f.period, p_event: f.event };
}

export function useAnaSales(f: AnaFilters, enabled = true) {
  const { rpc: a, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'ana', 'sales', f.period, f.event, f.seg],
    queryFn: () => rpc<AnaSales>('crm_ana_sales', { ...a, ...args(f), p_seg: f.seg === 'end' ? 'all' : f.seg }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}

export function useAnaTraffic(f: AnaFilters, enabled = true) {
  const { rpc: a, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'ana', 'traffic', f.period, f.event],
    queryFn: () => rpc<AnaTraffic>('crm_ana_traffic', { ...a, ...args(f) }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}

export function useAnaCommunity(f: AnaFilters, enabled = true) {
  const { rpc: a, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'ana', 'community', f.period, f.event, f.seg],
    queryFn: () => rpc<AnaCommunity>('crm_ana_community', { ...a, ...args(f), p_seg: f.seg }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}
