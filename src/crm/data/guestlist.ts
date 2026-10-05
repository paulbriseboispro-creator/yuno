/**
 * La guest list Shotgun dans la Console CRM (migration 20261008100000) :
 * l'onglet « Guest list » du tiroir d'une soirée (crm_night_guestlist) et
 * Analyses › Guest list (crm_ana_guestlist). Une entrée de guest list = une
 * invitation Shotgun ou un billet à 0 € (`glKindOf`, src/crm/lib/guestlist.ts).
 * Les montants arrivent à null pour un rôle sans accès au chiffre d'affaires.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import { useCrmScope } from '@/crm/scope';
import type { AnaPeriod } from './analytics';

export type GlKind = 'inv' | 'free' | 'mix';
export type GlPhase = 'upcoming' | 'live' | 'past';
/** Qui est l'invité, d'après ce qu'il a fait chez vous AVANT la soirée. */
export type GlTag = 'first' | 'gl' | 'buyer';

export interface GlSlot { h: number; gl: number; paid: number }
/** Heures médianes d'arrivée, en minutes depuis midi (690 = 23 h 30). */
export interface GlArrivals { slots: GlSlot[]; gl_med: number | null; paid_med: number | null }
export interface GlProfileSide { known: number; female_pct: number | null; age_known: number; age_med: number | null }

export interface NightGlList {
  name: string | null; kind: GlKind; entries: number; came: number;
  showup: number | null; first: number; conv: number | null;
}

export interface NightGlPerson {
  email: string; name: string | null; list: string | null; kind: 'inv' | 'free'; n: number;
  came: boolean; scanned_at: string | null; at: string; tag: GlTag; conv: boolean;
}

export interface NightGuestList {
  error?: 'not_found';
  event: { id: string; title: string; start_at: string; end_at: string; tz: string; phase: GlPhase; url: string | null };
  /** Soirée passée dont la porte a scanné au moins la moitié des billets. */
  scan_known: boolean;
  totals: {
    entries: number; inv: number; free: number; people: number; came: number;
    paid: number; paid_came: number; today: number; pending: number; rejected: number;
    showup: number | null; paid_showup: number | null; free_share: number | null;
  };
  prev: { id: string; title: string; start_at: string; same_series: boolean; entries: number; came: number; same_day: number; showup: number | null } | null;
  /** Inscriptions cumulées, du plus loin au plus près ; d = jours avant la soirée. */
  curve: { d: number; v: number; pv: number | null }[];
  lists: NightGlList[];
  who: { first: number; gl: number; buyers: number };
  /** Soirée passée : invités sans billet payant avant, qui en ont acheté un depuis. */
  after: { eligible: number; converted: number; revenue: number | null; back: number } | null;
  arrivals: GlArrivals;
  profile: Partial<Record<'gl' | 'paid', GlProfileSide>>;
  people: NightGlPerson[];
  synced_at: string | null;
}

export function useNightGuestList(id: string | null, enabled = true) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'night-gl', id],
    queryFn: () => rpc<NightGuestList>('crm_night_guestlist', { ...args, p_event_id: id }),
    enabled: !!id && enabled,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export interface AnaGlNight {
  id: string; title: string; start_at: string; tz: string; live: boolean;
  entries: number; inv: number; came: number; paid_came: number; scan_known: boolean; showup: number | null;
}

export interface AnaGlList {
  name: string | null; kind: GlKind; nights: number; entries: number; showup: number | null;
  eligible: number; conv: number; conv_pct: number | null;
}

export interface AnaGuestList {
  meta: { period: AnaPeriod; days: number; from: string; to: string; today: string };
  has_any: boolean;
  totals: {
    nights: number; gl_nights: number; entries: number; inv: number; came: number; people: number; scan_nights: number;
    showup: number | null; free_share: number | null;
    prev_nights: number; prev_entries: number; prev_people: number; prev_showup: number | null; prev_free_share: number | null;
  };
  conv: { eligible: number; converted: number; revenue: number | null; median_days: number | null };
  nights: AnaGlNight[];
  lists: AnaGlList[];
  arrivals: GlArrivals;
  profile: Partial<Record<'gl' | 'paid', GlProfileSide>>;
  /** Habitués de la guest list (3 soirées ou plus, jamais un billet payant) — filtre Clients `loyal`. */
  loyal: number;
  /** Inscrits non venus 2 fois ou plus (porte scannée) — filtre Clients `noshow`. */
  noshow: number;
  /** Devenus clients sur tout l'historique — filtre Clients `conv`. */
  conv_all: number;
  next: { id: string; title: string; start_at: string; tz: string; entries: number; inv: number; today: number } | null;
}

export function useAnaGuestList(period: AnaPeriod, enabled = true) {
  const { rpc: args, qk } = useCrmScope();
  return useQuery({
    queryKey: ['crm', qk, 'ana', 'guestlist', period],
    queryFn: () => rpc<AnaGuestList>('crm_ana_guestlist', { ...args, p_period: period }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}
