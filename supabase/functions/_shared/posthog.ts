// PostHog côté serveur — `order_paid_server`, la vérité sur l'argent.
//
// Capturé UNE fois par vente, sous la transition atomique pending→paid des
// `verify-*` (même règle que la Conversions API Meta, `_shared/meta-capi.ts`),
// et à la confirmation d'une inscription guest list / d'une table réglée sur
// place. C'est CET événement qui fait foi pour l'argent dans le dashboard
// PostHog, pas `purchase_completed` (navigateur, soumis au consentement et aux
// bloqueurs).
//
// Garanties :
//  - Ne lève jamais, ne bloque jamais la vente : fire-and-forget
//    (`EdgeRuntime.waitUntil`), toute erreur est avalée et journalisée.
//  - Sans clé (`POSTHOG_PROJECT_KEY`) : no-op.
//  - Consentement : la personne n'est reliée à la vente (distinct_id du
//    navigateur ou compte) QUE si le consentement « mesure d'audience » est
//    connu et accordé (natif = acquis). Sinon : distinct_id anonyme propre à la
//    commande et `$process_person_profile: false`.
//  - Jamais un email, un téléphone ou un nom dans les propriétés.
//  - La démo (`is_demo`) est marquée, jamais retirée : chaque insight la filtre.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { marketCity, marketCountry } from "./geo.ts";

const KEY = (Deno.env.get("POSTHOG_PROJECT_KEY") ?? "").trim();
const HOST = (Deno.env.get("POSTHOG_HOST") ?? "https://eu.i.posthog.com").trim().replace(/\/+$/, "");

export type PurchaseSurface = "web_app" | "pwa" | "ios_app" | "ios_pro" | "unknown";

export type AnalyticsContext = {
  consent: boolean;
  surface: PurchaseSurface;
  distinctId: string | null;
};

const SURFACES = new Set(["web_app", "pwa", "ios_app", "ios_pro"]);
const DISTINCT_RE = /^[A-Za-z0-9_$.:-]{1,120}$/;

/** Lit le contexte `analytics` du corps d'un `create-*` (src/lib/posthog.ts). */
export function parseAnalyticsContext(raw: unknown): AnalyticsContext {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const surface = typeof m.surface === "string" && SURFACES.has(m.surface) ? (m.surface as PurchaseSurface) : "unknown";
  const consent = m.consent === true;
  const did = typeof m.distinctId === "string" && DISTINCT_RE.test(m.distinctId) ? m.distinctId : null;
  return { consent, surface, distinctId: consent ? did : null };
}

/** Sérialise le contexte dans les métadonnées Stripe (`ph_*`). */
export function analyticsContextToStripeMetadata(ctx: AnalyticsContext): Record<string, string> {
  return {
    ph_consent: ctx.consent ? "1" : "0",
    ph_surface: ctx.surface,
    ph_did: ctx.distinctId ?? "",
  };
}

/** Relit le contexte depuis les métadonnées d'une session Stripe (verify-*). */
export function analyticsContextFromStripeMetadata(md: Record<string, string> | null | undefined): AnalyticsContext {
  const m = md ?? {};
  return parseAnalyticsContext({
    consent: m.ph_consent === "1",
    surface: m.ph_surface,
    distinctId: m.ph_did || null,
  });
}

const DEMO_EMAIL_RE = /(@womber\.fr$)|(^vitrine\+.*@yunoapp\.eu$)|(^deleted-.*@deleted\.local$)/i;

export type OrderPaidInput = {
  pillar: "tickets" | "tables" | "guest_list" | "drinks";
  orderId: string;
  /** stripe = payé en ligne, free = gratuit, on_site = réglé au club. */
  payment: "stripe" | "free" | "on_site";
  eventId?: string | null;
  venueId?: string | null;
  /** Montant brut de la commande (le « charged » de utils/fees.ts), en euros. */
  value: number;
  /** CA club (utils/fees.ts : brut − frais de service − assurance / gestion). */
  clubRevenue: number;
  /** Encaissé en ligne maintenant (l'acompte pour une table), en euros. */
  paidOnline?: number;
  currency?: string | null;
  quantity?: number | null;
  hasPromoter?: boolean;
  hasPromoCode?: boolean;
  /** Compte acheteur — utilisé comme distinct_id seulement avec consentement. */
  userId?: string | null;
  /** Email acheteur — SEULEMENT pour détecter la démo, jamais envoyé. */
  buyerEmail?: string | null;
  ctx: AnalyticsContext;
};

type EventRow = {
  title: string | null;
  timezone: string | null;
  location_city: string | null;
  venue_id: string | null;
  partner_venue_id: string | null;
  organizer_user_id: string | null;
  partner_organizer_id: string | null;
};
type VenueRow = { id: string; timezone: string | null; city: string | null };

async function buildProperties(admin: SupabaseClient, input: OrderPaidInput): Promise<Record<string, unknown>> {
  let ev: EventRow | null = null;
  if (input.eventId) {
    const { data } = await admin
      .from("events")
      .select("title, timezone, location_city, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id")
      .eq("id", input.eventId)
      .maybeSingle();
    ev = (data as EventRow | null) ?? null;
  }
  const venueId = input.venueId ?? ev?.venue_id ?? ev?.partner_venue_id ?? null;
  let venue: VenueRow | null = null;
  if (venueId) {
    const { data } = await admin.from("venues").select("id, timezone, city").eq("id", venueId).maybeSingle();
    venue = (data as VenueRow | null) ?? null;
  }
  const tz = ev?.timezone ?? venue?.timezone ?? null;
  const city = ev?.location_city ?? venue?.city ?? null;

  // Démo : soirée ou club de la démo, ou acheteur démo (@womber.fr…).
  let isDemo = !!input.buyerEmail && DEMO_EMAIL_RE.test(input.buyerEmail.trim());
  if (!isDemo) {
    const [dv, de] = await Promise.all([
      admin.rpc("demo_venue_ids"),
      input.eventId ? admin.rpc("demo_event_ids") : Promise.resolve({ data: [] as string[] }),
    ]);
    const venues = (dv.data as string[] | null) ?? [];
    const events = (de.data as string[] | null) ?? [];
    isDemo = (!!venueId && venues.includes(venueId)) || (!!input.eventId && events.includes(input.eventId));
  }

  const props: Record<string, unknown> = {
    pillar: input.pillar,
    payment: input.payment,
    order_id: input.orderId,
    value: Math.round(input.value * 100) / 100,
    club_revenue: Math.round(input.clubRevenue * 100) / 100,
    paid_online: Math.round((input.paidOnline ?? (input.payment === "stripe" ? input.value : 0)) * 100) / 100,
    currency: (input.currency || "eur").toUpperCase(),
    quantity: input.quantity ?? 1,
    has_promoter: !!input.hasPromoter,
    has_promo_code: !!input.hasPromoCode,
    // `surface` = surface d'ACHAT (même vocabulaire que le navigateur) : le
    // filtre « surface » du dashboard s'applique donc aussi à l'argent.
    surface: input.ctx.surface,
    source: "server",
    analytics_consent: input.ctx.consent,
    is_demo: isDemo,
  };
  const country = marketCountry(tz, city);
  const mCity = marketCity(city);
  if (country) props.market_country = country;
  if (mCity) props.market_city = mCity;
  if (input.eventId) props.event_id = input.eventId;
  // Nom public de la soirée (déjà affiché sur sa page) : lisible dans « top soirées ».
  if (ev?.title) props.event_title = ev.title.slice(0, 120);
  if (venueId) props.venue_id = venueId;
  const organizer = ev?.organizer_user_id ?? ev?.partner_organizer_id ?? null;
  if (organizer) props.organizer_user_id = organizer;
  return props;
}

async function send(admin: SupabaseClient, input: OrderPaidInput): Promise<void> {
  const properties = await buildProperties(admin, input);
  const linked = input.ctx.consent ? (input.ctx.distinctId || input.userId || null) : null;
  if (!linked) properties.$process_person_profile = false;
  const body = {
    api_key: KEY,
    event: "order_paid_server",
    distinct_id: linked ?? `order_${input.pillar}_${input.orderId}`,
    properties,
    timestamp: new Date().toISOString(),
  };
  const res = await fetch(`${HOST}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) console.error("[posthog] order_paid_server:", res.status, await res.text().catch(() => ""));
}

/**
 * `order_paid_server`, fire-and-forget. À appeler UNIQUEMENT sous la
 * transition atomique qui a fait passer la commande à payée (ou à la création
 * d'une inscription gratuite) : c'est ce qui garantit une capture par vente.
 */
export function captureOrderPaid(admin: SupabaseClient, input: OrderPaidInput): void {
  if (!KEY) return;
  try {
    const p = send(admin, input).catch((e) => console.error("[posthog] capture failed (non-blocking):", e));
    const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(p);
  } catch {
    // jamais bloquant
  }
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** CA club — miroir de src/utils/fees.ts (ticketRevenue / tableRevenue / orderRevenue). */
export const clubRevenue = {
  ticket: (t: { total_price?: unknown; service_fee?: unknown; insurance_fee?: unknown }) =>
    n(t.total_price) - n(t.service_fee) - n(t.insurance_fee),
  table: (t: { total_price?: unknown; service_fee?: unknown; management_fee?: unknown }) =>
    n(t.total_price) - n(t.service_fee) - n(t.management_fee),
  order: (o: { total?: unknown; service_fee?: unknown }) => n(o.total) - n(o.service_fee),
};
