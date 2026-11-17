/**
 * Lectures de la rubrique « Madrid » : deux RPC, aucune agrégation au front.
 * Définitions et pièges : docs/designs/ADMIN_MADRID.md.
 *   admin_madrid_traffic  verdict, clubs et soirées, audience
 *   admin_madrid_offer    ce que Madrid apporte au reste de Yuno, santé du catalogue
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { PeriodRange } from '../context/period';

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data as T;
}

export interface CurPrev { cur: number; prev: number }

export interface MadridClub {
  id: string; name: string; slug: string; active: boolean;
  visitors: number; views: number; exits: number; prev_exits: number; exit_people: number; nights: number;
}

export interface MadridEvent {
  key: string; slug: string | null; name: string | null; date: string | null; club: string | null; recurring: boolean;
  visitors: number; exits: number; exit_people: number; spark: number[] | null;
}

export interface MadridMonth { m: string; exits: number; accounts: number; cost: number | null; hours: number | null; note: string | null }

export interface MadridTraffic {
  days: number;
  night: string;
  since: { platform: string | null; clicks: string | null; consent: string | null };
  kpis: {
    visitors: CurPrev; event_viewers: CurPrev; exits: CurPrev; exit_people: CurPrev; accounts: CurPrev;
    robots: { cur: number; sessions: number };
  };
  reported: { rows: number; rows_cur: number; tickets: number; revenue: number; commission: number; commission_paid: number };
  v28: {
    visitors: CurPrev; exits: CurPrev; exit_people: CurPrev; accounts: CurPrev;
    returning: { base: number; back: number };
  };
  series: Array<{ d: string; visitors: number; exits: number; prev_visitors: number; prev_exits: number }>;
  funnel: { visitors: number; event_viewers: number; exit_people: number; exits: number };
  clubs: MadridClub[];
  unknown_club: { visitors: number; exits: number };
  events: MadridEvent[];
  weekdays: Array<{ dow: number; nights: number; visitors: number; exits: number }>;
  kinds: Record<'recurring' | 'oneoff', { nights: number; visitors: number; exits: number }>;
  pages: { event: number; venue: number; linktree: number };
  sources: Array<{ key: SourceKey; visitors: number; exits: number }>;
  app_web: { app: number; web: number; signed_in: number };
  languages: Array<{ key: string; n: number }>;
  countries: Array<{ key: string; n: number }>;
  hours: number[];
  visit_days: number[];
  returning: { base: number; back: number; multi: number };
  cohorts: Array<{ wk: string; size: number; cells: Array<number | null> }>;
  months: MadridMonth[];
}

export type SourceKey = 'app' | 'instagram' | 'linktree' | 'social' | 'ads' | 'search' | 'yuno' | 'direct' | 'other';

export interface DatedItem { id: string; name: string | null; date: string; club: string | null }

export interface MadridOffer {
  days: number;
  night: string;
  yuno: {
    known: number; clicked_signed_in: number; came: number; came_cur: number; city_madrid: number; favorites: number;
    push: number; push_came: number; app_sessions: number; app_signed_in: number;
    buyers: number; buyers_came: number; orders: number; spend: number; fees: number; spend_came: number; fees_came: number;
    months: Array<{ m: string; accounts: number }>;
  };
  pros: Array<{ club: string; active: boolean; kind: 'venue' | 'signup' | 'lead'; label: string | null; at: string }>;
  madrid_pros: { signups: number; signups_account: number; leads: number; venues: number };
  supply: {
    clubs_active: number; clubs_total: number; upcoming_published: number; upcoming_week: number; clubs_with_upcoming: number;
    weeks: string[];
    clubs: Array<{ id: string; name: string; active: boolean; next: string | null; templates: number; drafts: number; weeks: number[] }>;
    blocked: DatedItem[]; blocked_total: number; inactive_drafts: number; inactive_templates: number;
    no_flyer: DatedItem[];
    templates_idle: Array<{ id: string; name: string; club: string; dow: number | null }>;
    past_published: number; never_clicked: number; never_clicked_list: DatedItem[];
  };
  sync: {
    last: { at: string; trigger: string; links: number; images: number; names: number; one_offs: number; unmatched: Array<{ club?: string; date?: string; name?: string }>; errors: number } | null;
    days: Array<{ d: string; runs: number; links: number; errors: number }>;
    sources: Array<{ account: string; provider: string; priority: number; active: boolean; one_offs: boolean }>;
    seen: number;
  };
}

export function useMadridTraffic(range: PeriodRange, includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'madrid', 'traffic', range.days, includeDemo],
    queryFn: () => rpc<MadridTraffic>('admin_madrid_traffic', { p_days: range.days, p_include_demo: includeDemo }),
    staleTime: 60_000,
  });
}

export function useMadridOffer(range: PeriodRange, includeDemo: boolean) {
  return useQuery({
    queryKey: ['admin', 'madrid', 'offer', range.days, includeDemo],
    queryFn: () => rpc<MadridOffer>('admin_madrid_offer', { p_days: range.days, p_include_demo: includeDemo }),
    staleTime: 60_000,
  });
}

/** Saisie du mois (coût, heures). Tout vide = la ligne disparaît. */
export function useSetMadridInput() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { month: string; cost: number | null; hours: number | null; note: string | null }) =>
      rpc<void>('admin_madrid_input_set', { p_month: v.month, p_cost: v.cost, p_hours: v.hours, p_note: v.note }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'madrid'] }); },
  });
}
