// Source of truth: Yuno subscription plan features mapping

/**
 * Interrupteur global de l'abonnement clubs — période de lancement.
 *
 * `false` = abonnement coupé : aucun paywall, tout club non-collab est servi
 * comme Pro (sans essai ni facturation), la page Billing ne montre que Stripe
 * Connect, la nav affiche « Paiements », et les articles abonnement du mode
 * d'emploi sont retirés. Le plan `collab` garde sa sémantique (garde-fous
 * lecture seule via useCollabReadOnly, pas d'export CSV).
 *
 * Repasser à `true` pour réactiver la facturation. Pendant l'existence de ce
 * flag, garder en phase la constante homonyme côté edge functions :
 * supabase/functions/_shared/venue-plan.ts (branding + cap staff Core).
 */
export const SUBSCRIPTIONS_ENABLED: boolean = false;

export type PlanCode = 'core' | 'collab' | 'essential' | 'pro' | 'elite';

export type FeatureKey =
  | 'events' | 'entry_qr' | 'guest_list' | 'orders_qr' | 'menu'
  | 'staff_pin' | 'invoices_refunds' | 'analytics_basic'
  // Marketplace junctions split into connect (free, Core) / orchestrate (paid, Pro):
  // connecting (discover, book, be booked, accept a collab) generates GMV → never paywalled;
  // orchestrating (multi-DJ rosters, booking analytics, auto payouts) is growth tooling → Pro.
  | 'djs_connect' | 'djs_orchestrate'
  | 'organizations_connect' | 'organizations_orchestrate'
  | 'promoters' | 'analytics_advanced'
  | 'exports_csv' | 'clients_basic' | 'live_night' | 'vip_tables_basic'
  | 'vip_tables' | 'vip_service' | 'offers_upsell' | 'loyalty_crm'
  | 'hype_analysis' | 'personalization_advanced' | 'client_leaderboard'
  | 'promoters_basic' | 'analytics_tickets' | 'scarcity_tools'
  | 'story_builder' | 'story_builder_advanced'
  | 'email_campaigns_informational' | 'email_campaigns_promotional';

export type BillingCycle = 'monthly' | 'annual';

/**
 * Months billed on the annual plan. The other 2 months are free
 * ("2 mois offerts" — Yuno Pricing GTM v1.0), so annual = monthly × 10.
 */
export const ANNUAL_BILLED_MONTHS = 10;
/** Free trial length (days) for the STANDARD offer — credit card required. */
export const STANDARD_TRIAL_DAYS = 14;
/** Free period (days) for hand-picked EARLY ADOPTERS — no credit card. */
export const EARLY_ADOPTER_FREE_DAYS = 90;
/** Size of the hand-picked early-adopter cohort (Yuno Pricing GTM v1.0). */
export const EARLY_ADOPTER_LIMIT = 15;

export interface PlanInfo {
  code: PlanCode;
  name: string;
  nameKey: string;
  /** Monthly price in EUR. */
  price: number;
  /** Annual price in EUR (monthly × 10 — two months free). */
  priceAnnual: number;
  features: FeatureKey[];
}

// Core (OPÈRE): the club runs its night for free. We never paywall what makes
// GMV — selling (tickets, drinks, basic VIP), urgency, and connecting (book a DJ,
// accept a collab). Each transaction still earns Yuno a commission.
const CORE_FEATURES: FeatureKey[] = [
  'events', 'entry_qr', 'guest_list', 'analytics_tickets',
  'orders_qr', 'menu', 'staff_pin', 'invoices_refunds', 'analytics_basic',
  'vip_tables_basic', 'scarcity_tools',
  'djs_connect', 'organizations_connect',
  'promoters_basic', 'email_campaigns_informational',
];

// Essential ("vraie business"): caps lifted (staff illimité + branding Yuno retiré,
// enforced backend-side) plus the first marketing weapons.
const ESSENTIAL_FEATURES: FeatureKey[] = [
  ...CORE_FEATURES,
  'email_campaigns_promotional', 'clients_basic', 'story_builder', 'promoters',
];

// Pro (GRANDIS — complet): deep analytics, exports, full VIP, DJ/orga
// orchestration, advanced story. Highest tier purchasable at launch.
const PRO_FEATURES: FeatureKey[] = [
  ...ESSENTIAL_FEATURES,
  'analytics_advanced', 'exports_csv', 'vip_tables', 'vip_service',
  'djs_orchestrate', 'organizations_orchestrate',
  'story_builder_advanced', 'live_night', 'offers_upsell',
  // Loyalty/CRM, hype, client leaderboard and advanced personalization are all
  // BUILT — they belong in the highest purchasable tier, not behind the unbuilt Elite.
  'loyalty_crm', 'hype_analysis', 'client_leaderboard', 'personalization_advanced',
];

// Elite (SCALE — "Bientôt"): multi-venue group + API. Both entirely to build →
// no extra FeatureKeys yet (everything built lives in Pro). Not purchasable at launch.
const ELITE_FEATURES: FeatureKey[] = [
  ...PRO_FEATURES,
];

/**
 * COLLAB plan: free "demo" tier auto-granted to clubs that accept a
 * partnership with an organizer.
 *
 * Strategy: full Pro feature parity so the club gets a real, premium
 * experience during the collab night (analytics, hype, CRM, DJs, organisations,
 * factures, remboursements, live, VIP tables, story builder, scarcity, upsells…).
 *
 * Two guard-rails make this sustainable:
 *  1. `useCollabReadOnly` blocks creation/edition on entities the orga manages
 *     (events, tickets, tables, menu, staff, promoters, DJs, scarcity, upsells).
 *  2. `exports_csv` is intentionally EXCLUDED — clubs in collab demo cannot
 *     extract data (CSV, PDF batch). They see everything in-app, but cannot
 *     bulk-export. Real reason to upgrade to a paid plan.
 *
 * Editable in collab: venue identity (logo, photos, address, description),
 * club's own profile, and consultation of every dashboard.
 */
// FROZEN as an explicit static list (was previously derived from PRO_FEATURES).
// Deriving it meant any re-bucket of Pro silently changed this free tier. This
// list captures the intent directly: full management parity for a partnered club
// (it co-runs the event, so it needs both *_connect AND *_orchestrate), minus
// `exports_csv` (no bulk data extraction on a free demo tier). Edit deliberately.
const COLLAB_FEATURES: FeatureKey[] = [
  'events', 'entry_qr', 'guest_list', 'analytics_tickets',
  'orders_qr', 'menu', 'staff_pin', 'invoices_refunds', 'analytics_basic',
  'vip_tables_basic', 'scarcity_tools',
  'djs_connect', 'djs_orchestrate',
  'organizations_connect', 'organizations_orchestrate',
  'promoters_basic', 'promoters', 'email_campaigns_informational',
  'email_campaigns_promotional', 'clients_basic',
  'story_builder', 'story_builder_advanced',
  'analytics_advanced', 'vip_tables', 'vip_service',
  'live_night', 'offers_upsell',
  'loyalty_crm', 'hype_analysis', 'client_leaderboard', 'personalization_advanced',
];

// Stripe price IDs are NOT stored here. The frontend only sends { planCode,
// billingCycle } to the `club-subscription` edge function, which resolves the
// actual Stripe price from Supabase secrets (STRIPE_PRICE_{PLAN}_{MONTHLY,ANNUAL}).
// The current plan shown in the UI comes from the edge function response
// (`subscriptionPlan`), never from a price-id lookup on the client.
export const PLANS: Record<PlanCode, PlanInfo> = {
  core: {
    code: 'core',
    name: 'Yuno Core',
    nameKey: 'plan.core',
    price: 0,
    priceAnnual: 0,
    features: CORE_FEATURES,
  },
  collab: {
    code: 'collab',
    name: 'Yuno Collab',
    nameKey: 'plan.collab',
    price: 0,
    priceAnnual: 0,
    features: COLLAB_FEATURES,
  },
  essential: {
    code: 'essential',
    name: 'Essential',
    nameKey: 'plan.essential',
    price: 49,
    priceAnnual: 49 * ANNUAL_BILLED_MONTHS, // 490€ / an
    features: ESSENTIAL_FEATURES,
  },
  pro: {
    code: 'pro',
    name: 'Pro',
    nameKey: 'plan.pro',
    price: 99,
    priceAnnual: 99 * ANNUAL_BILLED_MONTHS, // 990€ / an
    features: PRO_FEATURES,
  },
  // Elite is DEFINED (for display) but NOT purchasable at launch — its features
  // (loyalty, predictive, multi-venue, API) are unbuilt. The billing UI shows it
  // as "Bientôt" with no CTA, and club-subscription rejects planCode==='elite'.
  elite: {
    code: 'elite',
    name: 'Elite',
    nameKey: 'plan.elite',
    price: 199,
    priceAnnual: 199 * ANNUAL_BILLED_MONTHS, // 1990€ / an
    features: ELITE_FEATURES,
  },
};

/** Price in EUR for a plan on a given billing cycle. */
export function planPrice(code: PlanCode, cycle: BillingCycle): number {
  const p = PLANS[code];
  return cycle === 'annual' ? p.priceAnnual : p.price;
}

/** Annual savings in EUR vs paying 12 monthly installments. */
export function annualSavings(code: PlanCode): number {
  const p = PLANS[code];
  return p.price * 12 - p.priceAnnual;
}

export const PLAN_ORDER: PlanCode[] = ['core', 'collab', 'essential', 'pro', 'elite'];

export const PAID_PLANS: PlanCode[] = ['essential', 'pro', 'elite'];
export function isCollabPlan(plan: PlanCode | null | undefined): boolean {
  return plan === 'collab';
}

/** Check if a plan includes a given feature */
export function hasFeature(plan: PlanCode | null | undefined, feature: FeatureKey): boolean {
  if (!plan) return false;
  const planInfo = PLANS[plan];
  if (!planInfo) return false;
  return planInfo.features.includes(feature);
}

/** Get the minimum plan required for a feature */
export function requiredPlan(feature: FeatureKey): PlanCode {
  for (const code of PLAN_ORDER) {
    if (PLANS[code].features.includes(feature)) return code;
  }
  return 'elite';
}

/** Feature key to route path mapping */
export const FEATURE_ROUTES: Partial<Record<FeatureKey, string[]>> = {
  djs_connect: ['/owner/book-dj'],
  djs_orchestrate: ['/owner/djs'],
  organizations_connect: ['/owner/collaborations'],
  // organizations_orchestrate: reserved for symmetry — no /owner/organizations page yet.
  promoters: ['/owner/promoters'],
  analytics_advanced: ['/owner/analytics'],
  clients_basic: ['/owner/customers'],
  live_night: ['/owner/live'],
  vip_tables: ['/owner/tables'],
  vip_service: ['/owner/vip-service'],
  offers_upsell: ['/owner/upsell'],
  loyalty_crm: ['/owner/loyalty'],
  hype_analysis: ['/owner/hype'],
  scarcity_tools: ['/owner/scarcity'],
  story_builder: ['/owner/story-builder'],
};

/** Feature descriptions for upgrade modal */
export const FEATURE_DESCRIPTIONS: Record<FeatureKey, string> = {
  events: 'plan.feature.events',
  entry_qr: 'plan.feature.entryQr',
  guest_list: 'plan.feature.guestList',
  orders_qr: 'plan.feature.ordersQr',
  menu: 'plan.feature.menu',
  staff_pin: 'plan.feature.staffPin',
  invoices_refunds: 'plan.feature.invoicesRefunds',
  analytics_basic: 'plan.feature.analyticsBasic',
  djs_connect: 'plan.feature.djsConnect',
  djs_orchestrate: 'plan.feature.djsOrchestrate',
  organizations_connect: 'plan.feature.organizationsConnect',
  organizations_orchestrate: 'plan.feature.organizationsOrchestrate',
  promoters: 'plan.feature.promoters',
  analytics_advanced: 'plan.feature.analyticsAdvanced',
  exports_csv: 'plan.feature.exportsCsv',
  clients_basic: 'plan.feature.clientsBasic',
  vip_tables: 'plan.feature.vipTables',
  vip_service: 'plan.feature.vipService',
  offers_upsell: 'plan.feature.offersUpsell',
  loyalty_crm: 'plan.feature.loyaltyCrm',
  hype_analysis: 'plan.feature.hypeAnalysis',
  personalization_advanced: 'plan.feature.personalizationAdvanced',
  live_night: 'plan.feature.liveNight',
  client_leaderboard: 'plan.feature.clientLeaderboard',
  promoters_basic: 'plan.feature.promotersBasic',
  analytics_tickets: 'plan.feature.analyticsTickets',
  scarcity_tools: 'plan.feature.scarcityTools',
  story_builder: 'plan.feature.storyBuilder',
  story_builder_advanced: 'plan.feature.storyBuilderAdvanced',
  vip_tables_basic: 'plan.feature.vipTablesBasic',
  email_campaigns_informational: 'plan.feature.emailCampaignsInfo',
  email_campaigns_promotional: 'plan.feature.emailCampaignsPromo',
};
