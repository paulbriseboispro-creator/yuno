/**
 * Publicité Meta pilotée depuis Yuno — types et constantes partagés par la
 * page Publicité (club et organisateur) et l'assistant de campagne.
 * Design : docs/designs/META_ADS_INTEGRATION_PLAN.md (phases 3-4).
 *
 * Toute l'écriture passe par l'edge `meta-connect` (actions `campaign_*`,
 * `audience_*`, `ads_*`, `leads_subscribe`) ; toute la lecture par la RPC
 * `get_my_meta_ads`. Le front ne parle jamais à graph.facebook.com.
 */

export type CampaignObjective = 'OUTCOME_SALES' | 'OUTCOME_TRAFFIC' | 'OUTCOME_AWARENESS';
export type CampaignStatus = 'draft' | 'creating' | 'paused' | 'active' | 'ended' | 'error' | 'archived';
export type BudgetType = 'daily' | 'lifetime';

export const CTA_OPTIONS = ['BUY_TICKETS', 'LEARN_MORE', 'BOOK_NOW', 'SIGN_UP', 'GET_OFFER'] as const;
export type CtaType = (typeof CTA_OPTIONS)[number];

export const BUILTIN_AUDIENCES = ['all_consenting', 'buyers_12m', 'vip_tables', 'guest_list', 'regulars_3'] as const;
export type BuiltinAudience = (typeof BUILTIN_AUDIENCES)[number];
/** Audiences à RÈGLE : Meta les remplit seul (pixel, Instagram, Page). `ref` = fenêtre en jours. */
export const RULE_AUDIENCES = ['pixel_visitors', 'pixel_checkout', 'ig_engagers', 'ig_visitors', 'page_engagers'] as const;
export type RuleAudience = (typeof RULE_AUDIENCES)[number];
export const RULE_AUDIENCE_WINDOWS = [30, 90, 180, 365] as const;
export const LOOKALIKE_RATIOS = [0.01, 0.03, 0.05, 0.1] as const;
export type AudienceKind = 'builtin' | 'venue_segment' | 'contact_segment' | 'lookalike' | RuleAudience;
export function isRuleAudience(k: string): k is RuleAudience { return (RULE_AUDIENCES as readonly string[]).includes(k); }

export const MIN_BUDGET_CENTS = 500;
export const DEFAULT_RADIUS_KM = 25;

export interface GeoChoice { key: string; name: string; type?: string; country_code?: string; region?: string; radius_km?: number }
export interface ZipChoice { key: string; name: string; primary_city?: string }
export interface CustomLocation { latitude: number; longitude: number; radius_km: number; name?: string }
export type LocationType = 'home' | 'recent' | 'travel_in';
/** Un critère de ciblage détaillé ; `type` = clé Meta du groupe (interests, behaviors, family_statuses, life_events…). */
export interface DetailedCriterion { id: string; name: string; type: string; size?: number | null; path?: string | null }
export interface DetailedGroup { items: DetailedCriterion[] }
export const INSTAGRAM_POSITIONS = ['stream', 'story', 'reels', 'profile_feed', 'ig_search'] as const;
export const FACEBOOK_POSITIONS = ['feed', 'story', 'facebook_reels', 'marketplace', 'video_feeds', 'search', 'instream_video'] as const;
export type ConversionEvent = 'PURCHASE' | 'INITIATED_CHECKOUT' | 'CONTENT_VIEW';
export type BidStrategy = 'lowest' | 'cost_cap' | 'bid_cap' | 'min_roas';
export interface ScheduleSlot { days: number[]; start_hour: number; end_hour: number }
/** Réglages de diffusion (mode expert). Miroir de `Delivery` dans `_shared/meta-ads.ts`. */
export interface Delivery {
  conversion_event?: ConversionEvent;
  optimization_goal?: string;
  bid?: { strategy: BidStrategy; amount_cents?: number; roas_floor?: number };
  schedule?: ScheduleSlot[];
  frequency?: { max: number; days: number };
  url_tags?: string;
}
export interface CampaignPlacements { facebook?: boolean; instagram?: boolean; positions?: { facebook?: string[]; instagram?: string[] }; devices?: Array<'mobile' | 'desktop'> }
export type PreviewSlot = 'feed' | 'story' | 'reel' | 'fb_feed' | 'fb_story';
export interface IgMedia { id: string; type: string; image: string | null; permalink: string | null; caption: string; at: string | null }

export interface InterestChoice { id: string; name: string; size?: number | null; path?: string | null }
export interface LocaleChoice { key: number; name: string }

export interface CampaignTargeting {
  countries?: string[];
  cities?: GeoChoice[];
  excluded_cities?: GeoChoice[];
  zips?: ZipChoice[];
  custom_locations?: CustomLocation[];
  location_types?: LocationType[];
  /** Groupes de critères : OU dans un groupe, ET entre groupes. Prime sur `interests`. */
  detailed?: DetailedGroup[];
  age_min?: number;
  age_max?: number;
  genders?: number[];
  audience_ids?: string[];
  exclude_audience_ids?: string[];
  /** Centres d'intérêt Meta — facultatif, affine le ciblage. */
  interests?: InterestChoice[];
  /** Langues Meta (clés numériques) — facultatif. */
  locales?: number[];
  /**
   * Jusqu'où Meta peut sortir du ciblage (miroir de `_shared/meta-ads.ts`) :
   * `relaxed` (défaut) = tranche d'âge et zone strictes, audiences / jumeaux /
   * intérêts / genre relâchés ; `full` = Advantage+ audience, tout est
   * suggestion et Meta n'accepte aucun âge maximum ; `strict` = rien de relâché.
   */
  audience_mode?: AudienceMode;
  /** Historique (avant `audience_mode`) : true = full, false = strict. */
  advantage?: boolean;
}

export type AudienceMode = 'relaxed' | 'full' | 'strict';
export const AUDIENCE_MODES: AudienceMode[] = ['relaxed', 'full', 'strict'];
/** En Advantage+ complet, Meta refuse un âge minimum au-dessus de 25. */
export const FULL_MODE_AGE_MIN_CAP = 25;

/** Ancienne forme (une image) — gardée pour les campagnes déjà créées. */
export interface CampaignCreative {
  image_url: string;
  headline: string;
  body: string;
  cta: CtaType;
  description?: string | null;
  link?: string;
}

export type CreativeFormat = 'image' | 'carousel' | 'video' | 'instagram_post';

export interface CreativeMedia {
  url: string;
  kind: 'image' | 'video' | 'ig_post';
  /** Publication Instagram existante : identifiant média Graph. */
  ig_media_id?: string | null;
  /** Vidéo : image de couverture (Meta l'exige). */
  thumbnail_url?: string | null;
  /** Carrousel : titre / description propres à la carte. */
  headline?: string | null;
  description?: string | null;
}

/**
 * Une création = une pub. Plusieurs créations dans une campagne partagent le
 * budget : Meta le déplace vers celle qui obtient les meilleurs résultats.
 */
/** Paramètres du compositeur story / feed : gardés pour rejouer ou dupliquer. */
export interface ComposedDesign {
  template: 'cover' | 'frame' | 'band';
  ratio: '9:16' | '4:5';
  title: string;
  subtitle: string;
  kicker: string;
  cta: string;
  accent: string;
}

export interface AdCreative {
  /** Identifiant local (clé React), jamais envoyé à Meta. */
  id: string;
  format: CreativeFormat;
  media: CreativeMedia[];
  /** Version verticale (9:16) pour stories et reels ; même nature que `media`. */
  vertical_media?: CreativeMedia | null;
  /** Améliorations Advantage+ créa (Meta retouche luminosité, bouton, textes, gabarits). */
  enhancements?: boolean;
  /** Réglages du compositeur, si le visuel a été composé dans Yuno. */
  design?: ComposedDesign | null;
  headline: string;
  body: string;
  description: string;
  cta: CtaType;
  link?: string;
}

export const MAX_CREATIVES = 6;
export const CAROUSEL_MIN = 2;
export const CAROUSEL_MAX = 10;
export const HEADLINE_MAX = 40;
export const BODY_MAX = 500;
export const DESCRIPTION_MAX = 120;

export function newCreative(partial: Partial<AdCreative> = {}): AdCreative {
  return {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    format: 'image', media: [], headline: '', body: '', description: '', cta: 'BUY_TICKETS',
    ...partial,
  };
}

/** Ce qui manque à une création pour partir chez Meta (vide = prête). */
export function creativeIssues(c: AdCreative): Array<'media' | 'carousel' | 'thumbnail' | 'headline' | 'body'> {
  const issues: Array<'media' | 'carousel' | 'thumbnail' | 'headline' | 'body'> = [];
  const images = c.media.filter((m) => m.kind === 'image');
  const video = c.media.find((m) => m.kind === 'video');
  if (c.format === 'image' && images.length < 1) issues.push('media');
  if (c.format === 'carousel' && images.length < CAROUSEL_MIN) issues.push('carousel');
  if (c.format === 'video') {
    if (!video) issues.push('media');
    else if (!video.thumbnail_url) issues.push('thumbnail');
  }
  if (c.format === 'instagram_post') {
    // La publication porte déjà son texte et son visuel.
    if (!c.media.some((m) => m.kind === 'ig_post' && m.ig_media_id)) issues.push('media');
    return issues;
  }
  if (c.headline.trim().length < 3) issues.push('headline');
  if (c.body.trim().length < 10) issues.push('body');
  return issues;
}

/** Image qui représente la création dans une liste (couverture pour une vidéo). */
export function creativeCover(c: Pick<AdCreative, 'media'>): string | null {
  const img = c.media.find((m) => m.kind === 'image');
  if (img) return img.url;
  const video = c.media.find((m) => m.kind === 'video');
  if (video?.thumbnail_url) return video.thumbnail_url;
  return c.media.find((m) => m.kind === 'ig_post')?.url ?? null;
}

export interface BreakdownRow { key: string; spend_cents: number; impressions: number; link_clicks: number; purchases: number }
export interface InsightBreakdowns { age_gender?: Array<BreakdownRow & { age: string; gender: string }>; placements?: Array<BreakdownRow & { platform: string; position: string }> }

export interface MetaAdRef { index: number; format: CreativeFormat; ad_id: string; creative_id: string; video_id?: string | null; effective_status?: string | null; review?: string | null }
export interface AdInsight { ad_id: string; spend_cents: number; impressions: number; reach: number; link_clicks: number; purchases: number; purchase_value_cents: number }

export const WIZARD_STEPS = ['event', 'budget', 'targeting', 'creative', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export interface AdsAudience {
  id: string; kind: AudienceKind; ref: string; name: string;
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
  targeting: CampaignTargeting; creative: CampaignCreative; placements: CampaignPlacements;
  creatives: Array<Omit<AdCreative, 'id'>>; meta_ads: MetaAdRef[]; ad_insights: AdInsight[];
  delivery: Delivery | null; insight_breakdowns: InsightBreakdowns | null;
  meta_campaign_id: string | null; meta_ad_id: string | null; review_feedback: string | null; last_error: string | null;
  last_synced_at: string | null; created_at: string; tracked_code: string | null;
  insights: AdsInsights | null; attributed: AdsAttributed;
}

export interface AdsLead { id: string; name: string | null; email: string | null; received_at: string; processed: boolean; error: string | null }

export interface AdsEvent { id: string; title: string; start_at: string; end_at?: string | null; poster_url: string | null; city: string | null; venue_name?: string | null; price_from?: number | null; lineup?: string[] }

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
