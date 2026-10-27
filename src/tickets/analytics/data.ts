/**
 * Données des Analyses de Yuno Tickets — les mêmes formes que les Analyses de
 * Yuno CRM (src/crm/data/analytics.ts, guestlist.ts, journey.ts), lues par les
 * RPC `tix_*` (migration 20261109300000) sur les ventes Yuno de la portée :
 * billets, tables VIP, guest list. Les montants arrivent à null pour un rôle
 * sans accès au chiffre d'affaires.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { rpc } from '@/crm/lib/rpc';
import type { Lifecycle } from '@/crm/data/clients';
import { useTixScope } from './scope';

export interface TixNights {
  now: string;
  money?: boolean;
  /** Règles d'habitué de la portée (crm_scope_rules) : textes des segments. */
  rules?: { regular_min_nights: number; regular_window_months: number; lapse_months: number };
  nights: { id: string; title: string; start_at: string; upcoming: boolean; sold: number; cap: number | null }[];
}

// ── Ventes, Trafic, Communauté ──

export type AnaPeriod = '24h' | '48h' | '7d' | '30d' | '90d' | '12m';
export type AnaSeg = 'all' | 'hab' | 'occ' | 'nou' | 'end';
/** `live` = En direct (Live View de Yuno Tickets, src/components/live-view) : pas d'équivalent dans le CRM. */
export type AnaTab = 'sales' | 'traffic' | 'partners' | 'community' | 'guestlist' | 'live';
/**
 * Famille de la source d'une vente Yuno, miroir de `_tix_source` (SQL,
 * migration 20261109300000) : l'attribution figée sur la vente (lien suivi,
 * promoteur, partenaire, e-mail, code promo, pages Yuno, réseaux…).
 */
export type SourceKey = 'ys' | 'yb' | 'yt' | 'wa' | 'yl' | 'pr' | 'pa' | 'em' | 'sm' | 'ad' | 'pc' | 'mk' | 'so' | 'se' | 'au' | 'di' | 'of';
export const SOURCE_KEYS: SourceKey[] = ['ys', 'yb', 'yt', 'wa', 'yl', 'pr', 'pa', 'em', 'sm', 'ad', 'pc', 'mk', 'so', 'se', 'au', 'di', 'of'];

/**
 * Pilier de l'onglet Ventes (lot 1 du plan combiné, 20261109310000) : `all` =
 * tout, `tickets` / `tables` / `guestlist` restreignent l'écran au pilier,
 * `refunds` lit les remboursements à leur date.
 */
export type AnaPillar = 'all' | 'tickets' | 'tables' | 'guestlist' | 'refunds';
export const PILLARS: AnaPillar[] = ['all', 'tickets', 'tables', 'guestlist', 'refunds'];

/** `compare` : la soirée comparée à la soirée choisie (« Comparer avec », lot 2), sinon la précédente de la série. */
export interface AnaFilters { period: AnaPeriod; event: string | null; seg: AnaSeg; cmp: boolean; pillar: AnaPillar; compare: string | null }

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
  /** Accès aux montants (Yuno Tickets : porte de la Console). */
  money?: boolean;
  event: AnaEventRef | null;
  prev_event: AnaEventRef | null;
  /** Ventes : le pilier lu. */
  pillar?: AnaPillar;
}

export interface AnaSend { i: number; at: string; name: string; channel: 'email' | 'sms' | 'push'; id: string }

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
    /** Tables VIP vendues (Yuno Tickets) : une vente sans place de billetterie. */
    tables?: number; prev_tables?: number; table_money?: { revenue: number | null; prev_revenue: number | null };
  };
  /** `basis` : la part se lit en euros, ou en ventes (guest list, portée sans l'argent). */
  msg: { share: number | null; basis?: 'amount' | 'count'; revenue: number | null; tickets: number; by: { em: number; sm: number; dm: number } } | null;
  tariffs: { deal: string; price: number | null; tickets: number; revenue: number | null; units?: number; pillar?: 'tickets' | 'tables' | 'guestlist' }[];
  /** Remplissage des soirées tenues dans la fenêtre (ou de la soirée choisie). */
  fill: { sold: number | null; cap: number | null; nights: number; prev_sold: number | null; prev_cap: number | null };
  seg_share: number | null;
  goal: { target: AnaCurve; refs: AnaCurve[]; week_sold: number } | null;
  heat: { cells: { n: number; amount: number | null }[][]; outside: number; days30: boolean };
  events: {
    id: string; title: string; start_at: string; night: string; upcoming: boolean; state: 'tonight' | 'presale' | 'past';
    tickets: number; paid?: number; free?: number; tables?: number; revenue: number | null; sold: number; cap: number | null; prev_sold: number | null;
    /** Pilier Tables VIP : tables réservées et tables en vente de la soirée. */
    tables_fill?: { sold: number; cap: number | null } | null;
    /** Porte d'une soirée passée, en personnes ; `measured` = _crm_door_measured. */
    door?: { entered: number; expected: number; measured: boolean } | null;
    /** Bilan de toute la soirée (tous piliers) : CA − cachets DJ. */
    balance?: { revenue: number | null; fees: { amount: number | null }; rest: { amount: number | null } };
  }[];
  events_other: { count: number; tickets: number; revenue: number | null } | null;
  /** « Ce que vous touchez » (pilier Tout) : volume brut − remboursements − Stripe = net. */
  payout?: TixPayout | null;
  tables_block?: TixTablesBlock | null;
  gl_block?: TixGlBlock | null;
  refunds_block?: TixRefundsBlock | null;
  sends: AnaSend[];
  has_any: boolean;
}

export interface TixPayout {
  gross: { amount: number | null; n: number };
  refunds: { amount: number | null; n: number };
  stripe: { amount: number | null; n: number };
  net: { amount: number | null };
  /** Reste des tables VIP à régler au club le soir même. */
  on_site: { amount: number | null };
  /** Co-soirées : la part de la portée d'après le contrat ; `unknown` = soirées au décompte (barème, co-organisation). */
  share: { amount: number | null; nights: number; unknown: number } | null;
}

export interface TixTablesBlock {
  n: number; prev_n: number;
  guests: number | null;
  min_spend: { amount: number | null };
  engaged: { amount: number | null };
  deposits: { amount: number | null };
  online_n: number; on_site_n: number;
  fill: { sold: number | null; cap: number | null; nights: number };
  prev_fill: { sold: number | null; cap: number | null };
}

export interface TixGlBlock {
  nights: number; nights_measured: number; signups_measured: number; came: number; per_night: number | null;
}

export interface TixRefundsBlock {
  series: { revenue: number | null; tickets: number; prev_revenue: number | null; prev_tickets: number }[];
  totals: {
    revenue: number | null; n: number; full: number; prev_revenue: number | null; prev_n: number;
    tickets_n: number; tables_n: number; has_prev: boolean | null;
  };
  reasons: { reason: string | null; n: number; revenue: number | null }[];
  events: { id: string; title: string; start_at: string; upcoming: boolean; state: 'tonight' | 'presale' | 'past'; n: number; revenue: number | null; sales: number }[];
}

export interface AnaTraffic {
  meta: AnaMeta;
  series: { revenue: Record<SourceKey, number> | null; tickets: Record<SourceKey, number>; clicks: number; new_buyers: number }[];
  sources: { k: SourceKey; orders: number; tickets: number; buyers: number; new_buyers: number; revenue: number | null; prev_tickets: number }[];
  clicks: { total: number; prev: number };
  buyers: { buyers: number; new: number; prev_buyers: number; prev_new: number };
  gained: { total: number; series: number[] };
  events: { id: string; title: string; start_at: string; night: string; upcoming: boolean; state: 'tonight' | 'presale' | 'past'; buyers: number; new_buyers: number; clicks: number; visits?: number }[];
  /** Visites de la page de vente et passage vers l'achat (ce que Yuno mesure). */
  visits?: TixVisits;
  sends: AnaSend[];
  has_any: boolean;
}

export interface TixVisits {
  visits: number; carts: number; checkouts: number; orders: number;
  prev_visits: number | null; prev_orders: number | null;
  series: number[];
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
  const { rpc: a, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-ana', qk, 'ana', 'sales', f.period, f.event, f.seg, f.pillar, f.event ? f.compare : null],
    queryFn: () => rpc<AnaSales>('tix_ana_sales', { ...a, ...args(f), p_seg: f.seg === 'end' ? 'all' : f.seg, p_pillar: f.pillar, p_compare: f.event ? f.compare : null }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: enabled && ready,
  });
}

export function useAnaTraffic(f: AnaFilters, enabled = true) {
  const { rpc: a, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-ana', qk, 'ana', 'traffic', f.period, f.event],
    queryFn: () => rpc<AnaTraffic>('tix_ana_traffic', { ...a, ...args(f) }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: enabled && ready,
  });
}

export function useAnaCommunity(f: AnaFilters, enabled = true) {
  const { rpc: a, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-ana', qk, 'ana', 'community', f.period, f.event, f.seg],
    queryFn: () => rpc<AnaCommunity>('tix_ana_community', { ...a, ...args(f), p_seg: f.seg }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: enabled && ready,
  });
}

// ── Trafic : le détail (lot 4, migration 20261109340000) ──

/** La page publique du club / de l'organisateur (pas dans la vue d'une soirée). */
export interface TixPageTraffic {
  kind: 'venue' | 'organizer';
  visits: number; prev_visits: number; visitors: number; returning: number; ordered: number;
  series: number[];
  /** `k` = referrer_category (direct, social, paid_social, search, paid_search, email, affiliate, internal, referral, qr). */
  sources: { k: string; visits: number; ordered: number }[];
  /** Trafic (tix_ana_visits) : la soirée ouverte ensuite depuis la page, dans les 30 minutes. */
  next?: { id: string; title: string; start_at: string; n: number }[];
  next_total?: number;
}

export interface TixTrafficLink {
  id: string; src: SourceKey; label: string | null; code: string; archived: boolean;
  network: string | null; placement: string | null; target: string | null;
  event_id: string | null; event_title: string | null; event_start: string | null;
  clicks: number; prev_clicks: number; orders: number; prev_orders: number;
  tickets: number; tables: number; guests: number; revenue: number | null;
}

/** Un e-mail (campagne ou recette d'automatisation) ou un push, et ce qui s'est vendu dans les 7 jours après un clic. */
export interface TixTrafficMessage {
  channel: 'email' | 'push'; id: string; name: string | null; at: string | null;
  /** Recette d'automatisation (e-mail) ou `auto` (push automatique de Yuno). */
  recipe: string | null;
  sent: number; opened: number; clicked: number; buyers: number; orders: number; revenue: number | null;
}

export interface AnaTrafficDetail {
  meta: AnaMeta;
  page: TixPageTraffic | null;
  links: TixTrafficLink[];
  messages: TixTrafficMessage[];
  messages_total: Record<'email' | 'push', { orders: number; buyers: number; revenue: number | null }>;
}

export function useAnaTrafficDetail(f: AnaFilters, enabled = true) {
  const { rpc: a, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-ana', qk, 'ana', 'traffic-detail', f.period, f.event],
    queryFn: () => rpc<AnaTrafficDetail>('tix_ana_traffic_detail', { ...a, ...args(f) }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: enabled && ready,
  });
}

// ── Trafic : les visites, en personnes (plan Trafic, migration 20261110100000) ──

/**
 * Famille d'une visite, miroir de `_tix_visit_family` (SQL) : vos liens suivis,
 * e-mails et push, Instagram et réseaux, Yuno, recherche, autres sites, direct.
 */
export type VisitFam = 'lk' | 'ms' | 'so' | 'yu' | 'se' | 'ot' | 'di';
export const VISIT_FAMS: VisitFam[] = ['so', 'lk', 'di', 'yu', 'se', 'ms', 'ot'];

export interface VisitStats {
  visits: number; visitors: number; measured: number;
  /** Médianes (secondes, % de la page) des visites mesurées ; null sans mesure. */
  median_s: number | null; median_scroll?: number | null;
  /** Visites qui ont fini par une commande payée. */
  orders: number;
}

export interface VisitKid extends VisitStats {
  /** `l:<lien>`, `d:<domaine>`, `u:<utm_source>`, `c:<campagne>`. */
  key: string; label: string | null; link: boolean; net: string | null; med: string | null;
}

export interface VisitSource extends VisitStats {
  k: VisitFam; short: number; prev_visits: number; prev_orders: number; kids: VisitKid[];
}

export interface VisitLink {
  id: string; label: string | null; net: string | null; med: string | null; target: string | null;
  event_id: string | null; event_title: string | null; event_start: string | null; created_at: string;
  clicks: number; people: number; mobile: number; dev_known: number; orders: number;
  visits: number; measured: number; median_s: number | null;
}

export interface VisitNight extends VisitStats {
  id: string; title: string; start_at: string; upcoming: boolean; state: 'tonight' | 'presale' | 'past';
  /** Visites arrivées une fois la billetterie fermée (« Complet »), null tant que la soirée n'est pas complète. */
  after_full?: number | null;
}

export interface TixVisitsKeep { k: 'top' | 'best_conv' | 'short' | 'after_full'; fam?: VisitFam; top?: VisitFam; pct?: number; conv?: number; top_conv?: number; ratio?: number; fams?: VisitFam[]; n?: number; title?: string }

export interface AnaVisits {
  meta: AnaMeta;
  totals: {
    visits: number; visitors: number; new_visitors: number; measured: number; median_s: number | null; pages: number | null; orders: number;
    prev_visits: number; prev_visitors: number; prev_new: number; prev_measured: number; prev_median_s: number | null; prev_orders: number;
  };
  /** Période : visites (`v`) et visiteurs (`u`) par case et par famille. */
  series: { v: Partial<Record<VisitFam, number>>; u: Partial<Record<VisitFam, number>>; visitors: number }[] | null;
  /** Une soirée : visites cumulées de J-n à J (null après aujourd'hui), et la soirée comparée. */
  curve: { cur: (number | null)[]; prev: number[] | null } | null;
  sources: VisitSource[];
  engagement: {
    measured: number;
    /** < 10 s, 10 s à 1 min, 1 à 3 min, 3 à 10 min, plus de 10 min. */
    dur: [number, number, number, number, number];
    /** Visites mesurées, puis ≥ 25 %, 50 %, 75 %, 90 % de la page. */
    scroll: [number, number, number, number, number];
    artist_clicks: number; shares: number;
    /** Ouvertures mesurées sur la page d'une soirée (line-up, plan, vidéo) : null tant que rien n'est mesuré. */
    opened?: { lineup: number; plan: number; video: number; measured: number } | null;
  };
  funnel: {
    viewed: number; selected: number; checkout: number; details: number; purchased: number;
    failed: number; failed_open: number; shared: number; waitlist: number;
    reasons: { reason: string; n: number }[];
    unpaid: { pillar: 'tickets' | 'tables'; n: number; name: string | null } | null;
  };
  heat: number[][];
  devices: { mobile: number; desktop: number; tablet: number; unknown: number };
  in_app: { instagram: number; facebook: number; tiktok: number; visits: number; orders: number; other_visits: number; other_orders: number };
  langs: { known: number; top: { l: string; n: number }[] };
  cities: { known: number; france: number; top: { city: string; n: number }[]; abroad: { cc: string; n: number }[] };
  nights: VisitNight[] | null;
  page: TixPageTraffic | null;
  links: VisitLink[];
  hours: number[] | null;
  distance: { known: number; near: number; mid: number; far: number } | null;
  artists: { id: string; name: string; photo: string | null; clicks: number }[];
  known_before: { connected: number; came: number } | null;
  /** Le seul pont vers l'argent : les ventes nées de ces visites ; `revenue` à null sans l'accès. */
  bridge: { orders: number; revenue: number | null };
  sends: AnaSend[];
  /** Mesures neuves (lot T6) : demande non servie d'une soirée. */
  demand?: { sold_out_at: string | null; after_full: number | null; soldout_seen: number | null } | null;
  keep: TixVisitsKeep[];
  has_any: boolean;
}

export function useAnaVisits(f: AnaFilters, enabled = true) {
  const { rpc: a, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-ana', qk, 'ana', 'visits', f.period, f.event, f.event ? f.compare : null],
    queryFn: () => rpc<AnaVisits>('tix_ana_visits', { ...a, ...args(f), p_compare: f.event ? f.compare : null }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: enabled && ready,
  });
}

// ── Partenaires (lot 3, migration 20261109330000) ──

/** Montants : `null` pour qui ne voit pas l'argent (enveloppe de la portée). */
export interface AnaPartnerTotals {
  sales: number; prev_sales: number; tickets: number; tables: number; guests: number;
  sellers: number; promoters: number;
  revenue: number | null; prev_revenue: number | null;
  commission: { amount: number | null; prev: { amount: number | null } };
  clicks: number; prev_clicks: number; paid: number; prev_paid: number;
  rate: number | null; prev_rate: number | null;
  /** Ventes attribuées par euro de commission. */
  yield: { revenue: number | null; prev_revenue: number | null };
}

export interface AnaPartnerPromoter {
  id: string; name: string | null; code: string | null; avatar_url: string | null; active: boolean;
  sales: number; prev_sales: number; tickets: number; tables: number; guests: number;
  revenue: number | null; prev_revenue: number | null;
  commission: { amount: number | null };
  clicks: number; rate: number | null;
  yield: { revenue: number | null };
}

/** `partner` = lien d'une personne (page /stats/), `guest` = invité d'une soirée, `party` = lien de co-soirée. */
export type PartnerLinkKind = 'partner' | 'guest' | 'party';

export interface AnaPartnerLink {
  id: string; kind: PartnerLinkKind; name: string | null; role: string | null; code: string; archived: boolean;
  event_id: string; event_title: string; event_start: string;
  clicks: number; sales: number; prev_sales: number; tickets: number; tables: number; guests: number;
  revenue: number | null;
}

export interface AnaSharedNight {
  id: string; title: string; start_at: string; upcoming: boolean; parties: number; guests: number; sales: number;
}

export interface AnaPartners {
  meta: AnaMeta & { has_promoters: boolean };
  series: { sales: number; revenue: number | null; commission: { amount: number | null }; clicks: number; prev_sales: number; prev_revenue: number | null; prev_clicks: number }[];
  totals: AnaPartnerTotals;
  promoters: AnaPartnerPromoter[];
  links: AnaPartnerLink[];
  shared: AnaSharedNight[];
}

export function useAnaPartners(f: AnaFilters, enabled = true) {
  const { rpc: a, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-ana', qk, 'ana', 'partners', f.period, f.event],
    queryFn: () => rpc<AnaPartners>('tix_ana_partners', { ...a, ...args(f) }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: enabled && ready,
  });
}

/** « Qui fait vendre ? » d'une soirée partagée : get_collab_party_breakdown, gardée par la soirée. */
export interface CollabPartyRow {
  clicks: number; tickets: number; tables: number; table_guests: number; guests: number; entered: number; revenue: number | null;
}
export interface CollabBreakdown {
  ok: boolean; reason?: string; money?: boolean;
  parties?: (CollabPartyRow & { party: string; name: string; kind: string; role: string; avatar_url: string | null; mine: boolean })[];
  guests?: (CollabPartyRow & { id: string; name: string; kind: string; photo_url: string | null })[];
  unattributed?: CollabPartyRow; totals?: CollabPartyRow; yuno?: CollabPartyRow; direct?: CollabPartyRow;
}

export function useCollabBreakdown(eventId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['tix-ana', 'collab-breakdown', eventId],
    queryFn: () => rpc<CollabBreakdown>('get_collab_party_breakdown', { p_event_id: eventId }),
    staleTime: 60_000,
    enabled: enabled && !!eventId,
  });
}

// ── Gratuits : le détail (lot 6, migration 20261109350000) ──

export interface FreeQuotaNight {
  id: string; title: string; start_at: string; upcoming: boolean;
  lists: number; quota: number; entries: number; full_lists: number; fill: number | null;
}
/** `type` : club, organizer, promoter, dj, guest (invité d'une soirée), custom. */
export interface FreeHolder {
  key: string; type: string; label: string | null; lists: number; nights: number; quota: number;
  entries: number; upcoming: number; k_entries: number; came: number; noshow: number; showup: number | null;
  eligible: number; converted: number; conv_pct: number | null;
}
export interface AnaFreeDetail {
  meta: { period: AnaPeriod; days: number; from: string; to: string; event: string | null; money: boolean };
  quotas: { lists: number; capped: number; quota: number; filled: number; full_lists: number; fill: number | null; nights: FreeQuotaNight[] };
  holders: FreeHolder[];
  /** Montants sous `amount` / `revenue` : null pour qui ne voit pas l'argent, ou sous 10 personnes. */
  worth: { guests: number; payers: number; guest_night: { amount: number | null }; paid_night: { amount: number | null }; guest_later: { amount: number | null }; revenue: number | null };
  noshow: { noshow: number; k_entries: number; held_full: number; unmeasured: number; rate: number | null; lost: { amount: number | null } };
}

export function useAnaFreeDetail(period: AnaPeriod, event: string | null, enabled = true) {
  const { rpc: a, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-ana', qk, 'ana', 'free-detail', period, event],
    queryFn: () => rpc<AnaFreeDetail>('tix_ana_free_detail', { ...a, p_period: period, p_event: event }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: enabled && ready,
  });
}

// ── Guest list ──

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
  const { rpc: args, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-ana', qk, 'night-gl', id],
    queryFn: () => rpc<NightGuestList>('tix_night_guestlist', { ...args, p_event_id: id }),
    enabled: !!id && enabled && ready,
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
  const { rpc: args, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-ana', qk, 'ana', 'guestlist', period],
    queryFn: () => rpc<AnaGuestList>('tix_ana_guestlist', { ...args, p_period: period }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: enabled && ready,
  });
}

// ── Parcours client ──

export type JrPeriod = '7d' | '30d' | '90d' | '12m';
/** Yuno Tickets : e-mail et push (lot 7, 20261109360000) ; le SMS marketing n'est pas encore ouvert. */
export type JrChannel = 'all' | 'email' | 'push' | 'sms';
export type JrSeg = 'all' | Lifecycle;

export const JR_PERIODS: JrPeriod[] = ['7d', '30d', '90d', '12m'];
export const JR_CHANNELS: JrChannel[] = ['all', 'email', 'push', 'sms'];
export const JR_SEGS: JrSeg[] = ['all', 'nou', 'occ', 'hab', 'end', 'none'];

export interface JrFilters {
  period: JrPeriod;
  event: string | null;
  campaign: string | null;
  channel: JrChannel;
  seg: JrSeg;
  cmp: boolean;
}

export type SegCounts = Record<Lifecycle, number>;

export interface JrStep {
  k: 0 | 1 | 2 | 3;
  lost: number;
  reach: number;
  by_campaign: { id: string; name: string; n: number }[];
  by_seg: SegCounts;
  /** Audience exacte de « Relancer » (rôle qui écrit, 2 000 au plus). */
  emails: string[] | null;
}

export type JrPathKey = 'm_click' | 'mm_click' | 'm_noclick' | `src_${SourceKey}`;

export interface JrCampaign {
  id: string; name: string; sent_at: string; event_id: string | null; event_title: string | null;
  channel: 'email' | 'push';
  received: number; opened: number; clicked: number; ticket_clicks: number; buyers: number; back: number;
  revenue: number | null; within2d: number; buyers_seg: SegCounts;
}

/** `push` = push reçu, `tap` = push touché (il ouvre la page de la soirée). */
export type JrEventKind = 'mail' | 'auto' | 'push' | 'open' | 'click' | 'tap' | 'buy';

export interface JrPerson {
  kind: 'bought' | 'clicked' | 'opened' | 'direct';
  email: string; first_name: string | null; last_name: string | null;
  lifecycle: Lifecycle; nights: number; email_ok: boolean; phone_ok: boolean;
  events: { at: string; t: JrEventKind; s: string | null; amount: number | null; qty: number | null; ev_at: string | null }[];
}

export interface Journey {
  period: JrPeriod; from: string; to: string; days: number; seg: JrSeg; channel: JrChannel;
  campaign: { id: string; sent_at: string } | null;
  /** Reçu, ouvert, clic, achat, retour — par personne. */
  funnel: [number, number, number, number, number];
  prev: [number, number, number, number, number] | null;
  /** Personnes touchées sur 14 cases ; null quand une campagne est choisie. */
  spark: number[] | null;
  /** Acheteurs sur 6 cases ; null quand une campagne est choisie. */
  bars: number[] | null;
  steps: JrStep[];
  delays: { n: number; b: [number, number, number, number]; median_h: number | null; prev_median_h: number | null; touches: number | null };
  paths: { total: number; with_msg: number; without_msg: number; list: { key: JrPathKey; n: number }[] } | null;
  cover: { buyers: number; attributed: number } | null;
  campaigns: JrCampaign[];
  examples: JrPerson[];
  options: { campaigns: { id: string; name: string; sent_at: string; event_id: string | null; channel: 'email' | 'push' }[] };
  thanks_auto: boolean;
  has_campaigns: boolean;
  has_connection: boolean;
}

export function useJourney(f: JrFilters) {
  const { rpc: a, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-ana', qk, 'journey', f.period, f.event, f.campaign, f.channel, f.seg],
    queryFn: () => rpc<Journey>('tix_journey', {
      ...a, p_period: f.period, p_event: f.event, p_campaign: f.campaign, p_channel: f.channel, p_seg: f.seg,
    }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled: ready,
  });
}

// ── La porte d'une soirée (lot 2, migration 20261109320000) ──

/** Entrées et attendus en personnes (règle de _door_headcount), arrivées par demi-heure. */
export interface TixNightDoor {
  event_id: string; tz: string; start_at: string; end_at: string;
  upcoming: boolean; started: boolean;
  entered: number; expected: number;
  /** Porte mesurée (_crm_door_measured) : sinon « porte non mesurée », jamais 0 %. */
  measured: boolean;
  pillars: Record<'tickets' | 'tables' | 'guestlist', { entered: number; expected: number }>;
  /** Entrées scannées sans heure (hors des demi-heures). */
  undated: number;
  arrivals: { at: string; n: number }[];
  /** CA de la soirée et par personne entrée : null sans l'accès à l'argent. */
  money: { revenue: number | null; per_head: { revenue: number | null } };
}

export function useNightDoor(eventId: string | null) {
  const { rpc: a, qk, ready } = useTixScope();
  return useQuery({
    queryKey: ['tix-ana', qk, 'night-door', eventId],
    queryFn: () => rpc<TixNightDoor>('tix_night_door', { ...a, p_event: eventId }),
    staleTime: 60_000,
    enabled: ready && !!eventId,
  });
}

