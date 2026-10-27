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
export type AnaTab = 'sales' | 'traffic' | 'community' | 'guestlist';
/**
 * Famille de la source d'une vente, miroir de `_crm_ticket_source` (SQL,
 * migration 20261018100000) et de `sourceFamily` (src/crm/lib/links.ts) : lue
 * dans `utm_source`, le seul champ de suivi que l'API Tickets de Shotgun rend
 * tel quel.
 */
export type SourceKey = 'ys' | 'yb' | 'yt' | 'yl' | 'em' | 'sm' | 'dm' | 'pa' | 'so' | 'sg' | 'ex' | 'se' | 'au' | 'di' | 'of';
export const SOURCE_KEYS: SourceKey[] = ['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'pa', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of'];

/** `compare` : soirée comparée (`?ce=`), sinon la précédente de la même série. */
export interface AnaFilters { period: AnaPeriod; event: string | null; seg: AnaSeg; cmp: boolean; compare?: string | null }

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
  series: { revenue: number | null; tickets: number; prev_revenue: number | null; prev_tickets: number; paid_tickets?: number; prev_paid_tickets?: number }[];
  totals: {
    revenue: number | null; tickets: number; buyers: number; prev_revenue: number | null; prev_tickets: number;
    /** Billets payants / entrées gratuites (tickets = les deux), 20261020200000. */
    paid_tickets?: number; free_tickets?: number; prev_paid_tickets?: number; prev_free_tickets?: number;
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
    tickets: number; paid?: number; free?: number; revenue: number | null; sold: number; cap: number | null; prev_sold: number | null;
  }[];
  events_other: { count: number; tickets: number; revenue: number | null } | null;
  sends: AnaSend[];
  has_any: boolean;
}

export interface AnaPartner {
  via: 'shotgun' | 'yuno';
  name: string;
  code: string | null;
  event_id: string | null;
  tickets: number;
  paid: number;
  free: number;
  orders: number;
  buyers: number;
  new_buyers: number;
  revenue: number | null;
  nights: number;
  prev_tickets: number;
  clicks: number | null;
  visitors: number | null;
}

export interface AnaTraffic {
  meta: AnaMeta;
  series: { revenue: Record<SourceKey, number> | null; tickets: Record<SourceKey, number>; clicks: number; new_buyers: number }[];
  sources: { k: SourceKey; orders: number; tickets: number; buyers: number; new_buyers: number; revenue: number | null; prev_tickets: number }[];
  /**
   * Partenaires, un par un : un lien de suivi Shotgun nommé (`via: 'shotgun'`,
   * ventes seulement : l'API ne rend aucun clic, `clicks` / `visitors` à null)
   * ou un lien Yuno « partenaire » (`via: 'yuno'`, clics mesurés par Yuno).
   */
  partners?: AnaPartner[];
  clicks: { total: number; prev: number };
  buyers: { buyers: number; new: number; prev_buyers: number; prev_new: number };
  gained: { total: number; series: number[] };
  events: { id: string; title: string; start_at: string; night: string; upcoming: boolean; state: 'tonight' | 'presale' | 'past'; buyers: number; new_buyers: number; clicks: number }[];
  sends: AnaSend[];
  has_any: boolean;
  /** Ventes par lien Yuno de partage (27/10, Ventes › « Ce qui a fait vendre »). */
  links?: AnaSaleLink[];
  /** Ventes par e-mail, recette ou SMS (_crm_email_attrib : clic dans les 7 jours, dernier clic). */
  messages?: AnaSaleMessage[];
  /** Nouveaux clients et part venue d'une source Yuno, par soirée. */
  night_mix?: { id: string; buyers: number; new_buyers: number; tickets: number; yuno_tickets: number | null }[];
}

export interface AnaSaleLink {
  id: string; code: string; name: string; platform: string; placement: string; event_id: string; event_title: string | null;
  src: SourceKey; orders: number; tickets: number; new_buyers: number; revenue: number | null;
}

export interface AnaSaleMessage {
  kind: 'campaign' | 'recipe' | 'sms'; name: string; id: string | null; at: string | null; nights: number;
  buyers: number; tickets: number; sent: number; revenue: number | null;
}

/**
 * Trafic (crm_ana_clicks, migration 20261112110000) : ce qui passe PAR Yuno —
 * clics des liens /go/ et des e-mails, pages d'inscription /j/ — compté en
 * personnes (un visiteur, un jour, un lien). Familles : emplacement du lien.
 */
export type ClickFam = 'ys' | 'yb' | 'yt' | 'pa' | 'em' | 'sm' | 'yl';
export const CLICK_FAMS: ClickFam[] = ['ys', 'yb', 'yt', 'pa', 'em', 'sm', 'yl'];

export interface AnaClickLink {
  kind: 'l' | 'e'; id: string; fam: ClickFam; label: string; platform: string | null; placement: string | null; code: string | null;
  recipe: string | null; child: boolean; event_id: string | null; event_title: string | null; created_at: string | null;
  clicks: number; people: number; ua_known: number; in_app: number; ig: number; peak_dow: number | null; peak_hour: number | null; orders: number;
}

export interface AnaClicks {
  meta: AnaMeta;
  totals: {
    clicks: number; people: number; prev_clicks: number; prev_people: number;
    ig_known: number; ig_in: number; prev_ig_known: number; prev_ig_in: number;
    orders: number; prev_orders: number; revenue: number | null;
    visits: number; prev_visits: number; signups: number; prev_signups: number; click_no_buy: number;
  };
  families: { k: ClickFam; clicks: number; people: number; prev_clicks: number; orders: number }[];
  /** Période : clics (`c`) et personnes (`p`) par case et par famille. */
  series: { c: Record<ClickFam, number>; p: Record<ClickFam, number> }[] | null;
  /** Soirée : clics cumulés de J-span (index 0) à J-0 ; `cur` à null après aujourd'hui. */
  curve: { span: number; today_d: number | null; cur: (number | null)[]; prev: number[] | null; prev_people_total: number } | null;
  marks: { at: string; name: string; channel: 'email' | 'sms' | 'link' | 'page'; i: number | null; d: number | null; fam?: ClickFam }[];
  links: AnaClickLink[];
  links_total: number;
  pages: { id: string; title: string; kind: string; status: string; event_id: string | null; visits: number; signups: number; confirmed: number; took: number }[];
  page_srcs: { src: string; visits: number; signups: number }[];
  messages: {
    email: { sent: number; clickers: number };
    sms: { sent: number; clickers: number };
    rows: { kind: 'campaign' | 'recipe' | 'sms'; id: string | null; name: string; at: string | null; sent: number; clickers: number; nights?: number }[];
  };
  click_no_buy: number;
  heat: number[][];
  hours: number[];
  devices: { mobile: number; desktop: number; tablet: number; known: number };
  countries: { cc: string; n: number }[];
  platform: { all: { app: number; website: number; other: number }; yuno: { app: number; website: number; other: number } };
  nights: { id: string; title: string; start_at: string; night: string; upcoming: boolean; state: 'tonight' | 'presale' | 'past'; clicks: number; people: number; links: number; signups: number; orders: number }[];
  confirmed: boolean;
  has_any: boolean;
  keep: ({ k: 'top'; fam: ClickFam; pct: number } | { k: 'emailConv'; em: number; links: number }
    | { k: 'partner'; name: string; people: number; orders: number } | { k: 'inApp'; pct: number } | { k: 'peak'; dow: number; hour: number })[];
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

export function useAnaClicks(f: AnaFilters, enabled = true) {
  const { rpc: a, qk } = useCrmScope();
  const compare = f.event ? f.compare ?? null : null;
  return useQuery({
    queryKey: ['crm', qk, 'ana', 'clicks', f.period, f.event, compare],
    queryFn: () => rpc<AnaClicks>('crm_ana_clicks', { ...a, ...args(f), p_compare: compare }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}
