/**
 * Publicité Meta pilotée depuis Yuno — types et constantes partagés par la
 * page Publicité (club et organisateur) et l'assistant de campagne.
 * Design : docs/designs/META_ADS_INTEGRATION_PLAN.md (phases 3-4).
 *
 * Toute l'écriture passe par l'edge `meta-connect` (actions `campaign_*`,
 * `audience_*`, `ads_*`, `leads_subscribe`) ; toute la lecture par la RPC
 * `get_my_meta_ads`. Le front ne parle jamais à graph.facebook.com.
 */

export type CampaignObjective = 'OUTCOME_SALES' | 'OUTCOME_TRAFFIC';
export type CampaignStatus = 'draft' | 'creating' | 'paused' | 'active' | 'ended' | 'error' | 'archived';
export type BudgetType = 'daily' | 'lifetime';

export const CTA_OPTIONS = ['BUY_TICKETS', 'LEARN_MORE', 'BOOK_NOW', 'SIGN_UP', 'GET_OFFER'] as const;
export type CtaType = (typeof CTA_OPTIONS)[number];

export const BUILTIN_AUDIENCES = ['all_consenting', 'buyers_12m', 'vip_tables', 'guest_list', 'regulars_3'] as const;
export type BuiltinAudience = (typeof BUILTIN_AUDIENCES)[number];

export const MIN_BUDGET_CENTS = 500;
export const DEFAULT_RADIUS_KM = 25;

export interface GeoChoice { key: string; name: string; type?: string; country_code?: string; region?: string; radius_km?: number }

export interface CampaignTargeting {
  countries?: string[];
  cities?: GeoChoice[];
  age_min?: number;
  age_max?: number;
  genders?: number[];
  audience_ids?: string[];
  exclude_audience_ids?: string[];
  advantage?: boolean;
}

export interface CampaignCreative {
  image_url: string;
  headline: string;
  body: string;
  cta: CtaType;
  description?: string | null;
  link?: string;
}

export interface AdsAudience {
  id: string; kind: 'builtin' | 'venue_segment' | 'contact_segment' | 'lookalike'; ref: string; name: string;
  meta_audience_id: string | null; lookalike_ratio: number | null; lookalike_country: string | null;
  size_uploaded: number | null; status: 'pending' | 'syncing' | 'ready' | 'error'; last_sync_at: string | null; last_error: string | null; created_at: string;
}

export interface AdsInsights {
  spend_cents: number; impressions: number; reach: number; clicks: number; link_clicks: number;
  purchases: number; purchase_value_cents: number; leads: number;
  days: { day: string; spend_cents: number; clicks: number; purchases: number }[];
}

export interface AdsAttributed {
  tickets: number; tickets_revenue_cents: number; tables: number; tables_revenue_cents: number;
  orders: number; orders_revenue_cents: number; guest_list: number; clicks: number;
}

export interface AdsCampaign {
  id: string; name: string; status: CampaignStatus; effective_status: string | null; objective: CampaignObjective;
  event_id: string | null; event_title: string | null; event_start_at: string | null; event_poster_url: string | null;
  budget_type: BudgetType; budget_cents: number; currency: string; start_at: string; end_at: string | null;
  targeting: CampaignTargeting; creative: CampaignCreative; placements: { facebook?: boolean; instagram?: boolean };
  meta_campaign_id: string | null; meta_ad_id: string | null; review_feedback: string | null; last_error: string | null;
  last_synced_at: string | null; created_at: string; tracked_code: string | null;
  insights: AdsInsights | null; attributed: AdsAttributed;
}

export interface AdsLead { id: string; name: string | null; email: string | null; received_at: string; processed: boolean; error: string | null }

export interface AdsEvent { id: string; title: string; start_at: string; poster_url: string | null; city: string | null }

export interface AdsPayload {
  connection: {
    id: string; mode: 'manual' | 'oauth'; status: string; pixel_id: string; ad_account_id: string | null; page_id: string | null;
    ig_user_id: string | null; token_kind: string; assets: unknown; ads_ready: boolean;
    last_health: { ad_account?: { currency: string | null; account_status: number | null; has_funding: boolean; custom_audience_tos: boolean; tos_url: string; checked_at: string }; leads_subscribed_at?: string } | null;
  } | null;
  audiences: AdsAudience[];
  campaigns: AdsCampaign[];
  leads: { total: number; last_30d: number; pending: number; recent: AdsLead[] };
  events: AdsEvent[];
  segments: { venue: { id: string; name: string }[]; contact: { id: string; name: string }[] };
  home: { city: string | null; latitude: number | null; longitude: number | null };
}

export function attributedRevenueCents(a: AdsAttributed): number {
  return (a.tickets_revenue_cents ?? 0) + (a.tables_revenue_cents ?? 0) + (a.orders_revenue_cents ?? 0);
}

export function attributedSales(a: AdsAttributed): number {
  return (a.tickets ?? 0) + (a.tables ?? 0) + (a.orders ?? 0);
}

/** Coût par vente attribuée, en centimes ; null sans vente. */
export function costPerSaleCents(spendCents: number, sales: number): number | null {
  return sales > 0 ? Math.round(spendCents / sales) : null;
}
