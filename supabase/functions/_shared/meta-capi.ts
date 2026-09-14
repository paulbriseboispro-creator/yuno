// Meta Conversions API — porte unique côté serveur.
// Design : docs/designs/META_ADS_INTEGRATION_PLAN.md (2026-09-14).
//
// Trois responsabilités, et rien d'autre :
//   1. Transporter le contexte navigateur (consentement, _fbp, _fbc, UA, IP)
//      jusqu'au moment de l'achat — via les métadonnées de la session Stripe,
//      parce que l'achat est confirmé dans un webhook qui n'a plus de navigateur.
//   2. Mettre en file un événement pour chaque connexion Meta concernée par la
//      vente (club, organisateur, plateforme), DÉJÀ haché, jamais de jeton.
//   3. Drainer la file vers graph.facebook.com, avec retry, sans jamais lever.
//
// Règles intouchables :
//   - Aucun événement ne part sans `consent = true` (CNIL, art. 26 RGPD, termes
//     Business Tools Meta). Le consentement est journalisé pour CHAQUE commande,
//     y compris quand il est refusé : c'est la preuve du pro.
//   - Rien ne part d'une session native en V1 (pas de CMP dans l'app).
//   - `em`, `ph`, `fn`, `ln`, `ct`, `country`, `external_id` : normalisés puis
//     SHA-256 (hex minuscule). `client_ip_address`, `client_user_agent`,
//     `fbp`, `fbc` : jamais hachés (doc Meta).
//   - Une requête par événement : un lot est rejeté en entier si un seul
//     événement est invalide.
//   - `event_time` en SECONDES ; plus de 7 jours = refusé par Meta.
//   - Ce module ne lève jamais vers son appelant : une panne Meta ne coûte pas
//     une vente (même règle que logAiUsage).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

export const META_GRAPH_VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const PARTNER_AGENT = "yuno-capi-1.0";
const MAX_EVENT_AGE_S = 6 * 24 * 3600; // Meta refuse au-delà de 7 j ; on garde une marge.
const RETRY_DELAYS_S = [60, 300, 900, 3600, 4 * 3600, 12 * 3600];

// ── Contexte client ──────────────────────────────────────────────────────────

export type MetaSource = "web" | "native" | "unknown";

export interface MetaClientContext {
  consent: boolean;
  consentVersion: number | null;
  source: MetaSource;
  fbp: string | null;
  fbc: string | null;
  url: string | null;
  ua: string | null;
  ip: string | null;
}

const FBP_RE = /^fb\.[0-2]\.\d{10,16}\.\d{1,20}$/;
const FBC_RE = /^fb\.[0-2]\.\d{10,16}\.[A-Za-z0-9_-]{1,400}$/;

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/** Lit le champ `meta` d'un corps de requête client (checkout, guest list). */
export function parseMetaClientContext(raw: unknown, req?: Request): MetaClientContext {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fbp = str(m.fbp, 80);
  const fbc = str(m.fbc, 500);
  const src = m.src === "web" || m.src === "native" ? m.src : "unknown";
  const url = str(m.url, 480);
  const fwd = req?.headers.get("x-forwarded-for") ?? null;
  const ip = (fwd ? fwd.split(",")[0].trim() : null) || req?.headers.get("cf-connecting-ip") || null;
  const ua = str(req?.headers.get("user-agent"), 480);
  return {
    // Le natif n'a pas de CMP : jamais de consentement pub en V1, quoi que dise
    // le corps de la requête.
    consent: m.consent === true && src === "web",
    consentVersion: typeof m.consentVersion === "number" ? m.consentVersion : null,
    source: src,
    fbp: fbp && FBP_RE.test(fbp) ? fbp : null,
    fbc: fbc && FBC_RE.test(fbc) ? fbc : null,
    url: url && /^https:\/\/([a-z0-9-]+\.)*yunoapp\.eu\//i.test(url) ? url : null,
    ua,
    ip: ip && ip.length <= 64 ? ip : null,
  };
}

/** Sérialise le contexte dans les métadonnées Stripe (≤ 500 caractères par valeur). */
export function metaContextToStripeMetadata(ctx: MetaClientContext): Record<string, string> {
  return {
    meta_consent: ctx.consent ? "1" : "0",
    meta_cv: ctx.consentVersion != null ? String(ctx.consentVersion) : "",
    meta_src: ctx.source,
    meta_fbp: ctx.fbp ?? "",
    meta_fbc: ctx.fbc ?? "",
    meta_url: ctx.url ?? "",
    meta_ua: ctx.ua ?? "",
    meta_ip: ctx.ip ?? "",
  };
}

/** Relit le contexte depuis les métadonnées d'une session Stripe (webhook / verify). */
export function metaContextFromStripeMetadata(md: Record<string, string> | null | undefined): MetaClientContext {
  const m = md ?? {};
  const src: MetaSource = m.meta_src === "web" || m.meta_src === "native" ? m.meta_src : "unknown";
  const cv = m.meta_cv ? Number(m.meta_cv) : NaN;
  return {
    consent: m.meta_consent === "1" && src === "web",
    consentVersion: Number.isFinite(cv) ? cv : null,
    source: src,
    fbp: m.meta_fbp && FBP_RE.test(m.meta_fbp) ? m.meta_fbp : null,
    fbc: m.meta_fbc && FBC_RE.test(m.meta_fbc) ? m.meta_fbc : null,
    url: m.meta_url || null,
    ua: m.meta_ua || null,
    ip: m.meta_ip || null,
  };
}

// ── Normalisation + hachage (doc « customer information parameters ») ────────

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeEmail(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null;
}

/**
 * Téléphone : chiffres seulement, indicatif pays inclus, sans `+` ni zéros de
 * tête. Un numéro national sans indicatif est complété par le pays de la
 * portée (FR par défaut, ES si `defaultCountry = 'ES'`) : un indicatif faux ne
 * fait aucun mal (aucune correspondance), un numéro sans indicatif est perdu.
 */
export function normalizePhone(v: string | null | undefined, defaultCountry: "FR" | "ES" = "FR"): string | null {
  const raw = (v ?? "").trim();
  if (!raw) return null;
  let digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (raw.startsWith("+")) {
    // déjà international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0") && digits.length === 10 && defaultCountry === "FR") {
    digits = "33" + digits.slice(1);
  } else if (digits.length === 9 && /^[67]/.test(digits) && defaultCountry === "ES") {
    digits = "34" + digits;
  } else if (digits.startsWith("0") && digits.length === 10) {
    digits = "33" + digits.slice(1);
  }
  digits = digits.replace(/^0+/, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function normalizeName(v: string | null | undefined): string | null {
  const t = (v ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\d]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length >= 1 ? t : null;
}

export function normalizeCity(v: string | null | undefined): string | null {
  const t = (v ?? "").normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s\d]/gu, "");
  return t.length >= 2 ? t : null;
}

export function normalizeCountry(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().toLowerCase();
  return /^[a-z]{2}$/.test(t) ? t : null;
}

/** Sépare « Prénom Nom » quand on n'a qu'un nom complet. */
export function splitFullName(full: string | null | undefined): { first: string | null; last: string | null } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

async function hashed(v: string | null): Promise<string[] | undefined> {
  return v ? [await sha256Hex(v)] : undefined;
}

// ── Mise en file ─────────────────────────────────────────────────────────────

export type MetaEventName = "Purchase" | "Lead" | "CompleteRegistration" | "InitiateCheckout" | "ViewContent";
export type MetaEventKind = "ticket" | "table" | "order" | "guest_list" | "test";

export interface MetaPerson {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  city?: string | null;
  country?: string | null;
  externalId?: string | null;
}

export interface MetaCustomData {
  valueCents?: number | null;
  currency?: string | null;
  contentIds?: string[];
  contentName?: string | null;
  orderId?: string | null;
  numItems?: number | null;
}

export interface EnqueueMetaEventInput {
  eventName: MetaEventName;
  /** `ticket:<id>` etc. — identique côté pixel navigateur (dédoublonnage). */
  eventId: string;
  eventKind: MetaEventKind;
  /** Identifiant de la commande pour le journal de consentement. */
  orderId: string;
  /** Portées bénéficiaires : club(s) et organisateur(s) de la vente. */
  venueIds: Array<string | null | undefined>;
  organizerUserIds: Array<string | null | undefined>;
  person: MetaPerson;
  custom?: MetaCustomData;
  ctx: MetaClientContext;
  /** Heure de l'action (défaut : maintenant). */
  eventTime?: Date;
  defaultCountry?: "FR" | "ES";
}

interface ConnectionRow {
  id: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  pixel_id: string;
  status: string;
  events_enabled: Record<string, boolean> | null;
  send_native: boolean;
  vault_secret_id: string | null;
  test_event_code: string | null;
  test_event_code_expires_at: string | null;
  token_kind?: string | null;
  token_expires_at?: string | null;
}

const EVENT_FLAG: Record<MetaEventName, string> = {
  Purchase: "purchase",
  Lead: "lead",
  CompleteRegistration: "lead",
  InitiateCheckout: "initiate_checkout",
  ViewContent: "view_content",
};

async function loadConnectionsForScopes(
  admin: SupabaseClient,
  venueIds: string[],
  organizerIds: string[],
): Promise<ConnectionRow[]> {
  const ors: string[] = ["and(venue_id.is.null,organizer_user_id.is.null)"];
  for (const v of venueIds) ors.push(`venue_id.eq.${v}`);
  for (const o of organizerIds) ors.push(`organizer_user_id.eq.${o}`);
  const { data, error } = await admin
    .from("meta_connections")
    .select("id, venue_id, organizer_user_id, pixel_id, status, events_enabled, send_native, vault_secret_id, test_event_code, test_event_code_expires_at")
    .eq("status", "active")
    .not("vault_secret_id", "is", null)
    .or(ors.join(","));
  if (error) {
    console.error("[meta-capi] loadConnections:", error.message);
    return [];
  }
  return (data ?? []) as ConnectionRow[];
}

async function buildServerEvent(input: EnqueueMetaEventInput): Promise<Record<string, unknown>> {
  const { person, ctx, custom } = input;
  const names = person.firstName || person.lastName
    ? { first: person.firstName ?? null, last: person.lastName ?? null }
    : splitFullName(person.fullName);
  const userData: Record<string, unknown> = {};
  const em = await hashed(normalizeEmail(person.email));
  const ph = await hashed(normalizePhone(person.phone, input.defaultCountry));
  const fn = await hashed(normalizeName(names.first));
  const ln = await hashed(normalizeName(names.last));
  const ct = await hashed(normalizeCity(person.city));
  const country = await hashed(normalizeCountry(person.country));
  const ext = await hashed(person.externalId ? person.externalId.trim() : null);
  if (em) userData.em = em;
  if (ph) userData.ph = ph;
  if (fn) userData.fn = fn;
  if (ln) userData.ln = ln;
  if (ct) userData.ct = ct;
  if (country) userData.country = country;
  if (ext) userData.external_id = ext;
  if (ctx.ip) userData.client_ip_address = ctx.ip;
  if (ctx.ua) userData.client_user_agent = ctx.ua;
  if (ctx.fbp) userData.fbp = ctx.fbp;
  if (ctx.fbc) userData.fbc = ctx.fbc;

  const customData: Record<string, unknown> = {};
  if (custom?.valueCents != null && custom.currency) {
    customData.value = Math.round(custom.valueCents) / 100;
    customData.currency = custom.currency.toUpperCase();
  }
  if (custom?.contentIds?.length) {
    customData.content_ids = custom.contentIds;
    customData.content_type = "product";
  }
  if (custom?.contentName) customData.content_name = custom.contentName.slice(0, 200);
  if (custom?.orderId) customData.order_id = custom.orderId;
  if (custom?.numItems != null) customData.num_items = custom.numItems;

  // Un événement `website` exige client_user_agent + event_source_url. Sans
  // eux (ancien client), on déclare `other` : Meta l'accepte, la
  // correspondance est juste moins bonne.
  const website = !!ctx.ua && !!ctx.url;
  const event: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: Math.floor((input.eventTime ?? new Date()).getTime() / 1000),
    event_id: input.eventId,
    action_source: website ? "website" : "other",
    user_data: userData,
    custom_data: customData,
  };
  if (website) event.event_source_url = ctx.url;
  return event;
}

/**
 * Journalise le consentement de la commande, puis met en file l'événement pour
 * chaque connexion active de la portée — seulement si consentement.
 * Ne lève jamais.
 */
export async function enqueueMetaEvent(admin: SupabaseClient, input: EnqueueMetaEventInput): Promise<{ queued: number }> {
  try {
    const venueIds = [...new Set(input.venueIds.filter((v): v is string => !!v))];
    const organizerIds = [...new Set(input.organizerUserIds.filter((v): v is string => !!v))];
    const kindToOrderKind: Record<MetaEventKind, string> = {
      ticket: "ticket", table: "table", order: "order", guest_list: "guest_list", test: "ticket",
    };

    // 1. Preuve de consentement — TOUJOURS, même refusé, même sans connexion.
    if (input.eventKind !== "test") {
      const { error: logErr } = await admin.from("meta_consent_log").upsert({
        order_kind: kindToOrderKind[input.eventKind],
        order_id: input.orderId,
        venue_id: venueIds[0] ?? null,
        organizer_user_id: organizerIds[0] ?? null,
        consent_marketing: input.ctx.consent,
        consent_version: input.ctx.consentVersion,
        source: input.ctx.source,
        fbp: input.ctx.consent ? input.ctx.fbp : null,
        fbc: input.ctx.consent ? input.ctx.fbc : null,
      }, { onConflict: "order_kind,order_id", ignoreDuplicates: true });
      if (logErr) console.error("[meta-capi] consent log:", logErr.message);
    }

    if (!input.ctx.consent) return { queued: 0 };

    // 2. Connexions concernées.
    const connections = await loadConnectionsForScopes(admin, venueIds, organizerIds);
    if (connections.length === 0) return { queued: 0 };

    const flag = EVENT_FLAG[input.eventName];
    const payload = await buildServerEvent(input);
    const rows = connections
      .filter((c) => (c.events_enabled?.[flag] ?? true) !== false)
      .map((c) => ({
        connection_id: c.id,
        event_name: input.eventName,
        event_id: input.eventId,
        event_kind: input.eventKind,
        payload,
        value_cents: input.custom?.valueCents ?? null,
        currency: input.custom?.currency?.toUpperCase() ?? null,
      }));
    if (rows.length === 0) return { queued: 0 };

    const { error } = await admin
      .from("meta_capi_outbox")
      .upsert(rows, { onConflict: "connection_id,event_name,event_id", ignoreDuplicates: true });
    if (error) {
      console.error("[meta-capi] enqueue:", error.message);
      return { queued: 0 };
    }
    return { queued: rows.length };
  } catch (e) {
    console.error("[meta-capi] enqueue threw:", e instanceof Error ? e.message : String(e));
    return { queued: 0 };
  }
}

// ── Envoi ────────────────────────────────────────────────────────────────────

interface GraphError {
  code?: number;
  error_subcode?: number;
  message?: string;
  fbtrace_id?: string;
  error_user_msg?: string;
}

async function postEvents(
  pixelId: string,
  token: string,
  events: Record<string, unknown>[],
  testEventCode?: string | null,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; error: GraphError; retryable: boolean }> {
  const body: Record<string, unknown> = { data: events, partner_agent: PARTNER_AGENT };
  if (testEventCode) body.test_event_code = testEventCode;
  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${pixelId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    return { ok: false, status: 0, error: { message: e instanceof Error ? e.message : "network" }, retryable: true };
  }
  let json: unknown = null;
  try { json = await res.json(); } catch { json = null; }
  if (res.ok) return { ok: true, body: json };
  const err = ((json as { error?: GraphError } | null)?.error ?? { message: `HTTP ${res.status}` }) as GraphError;
  // 190 = jeton invalide/révoqué ; 100 = paramètre invalide (définitif) ;
  // 4/17/32/613 = limite de débit (réessayer) ; 5xx = réessayer.
  const code = err.code ?? 0;
  const retryable = res.status >= 500 || [4, 17, 32, 613, 2].includes(code);
  return { ok: false, status: res.status, error: err, retryable };
}

/** Vérifie qu'un couple (pixel, jeton) est accepté par Meta sans envoyer d'événement. */
export async function checkMetaToken(pixelId: string, token: string): Promise<{ ok: boolean; name?: string; code?: number; message?: string }> {
  try {
    const res = await fetch(`${GRAPH}/${pixelId}?fields=id,name`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json().catch(() => null) as { id?: string; name?: string; error?: GraphError } | null;
    if (res.ok && json?.id === pixelId) return { ok: true, name: json.name };
    const err = json?.error;
    // Un jeton généré dans Events Manager n'a pas toujours le droit de LIRE le
    // dataset (code 100 / 200 / 10) : il peut pourtant écrire des événements.
    // Seul un 190 (jeton invalide) est une vraie erreur.
    if (err?.code === 190) return { ok: false, code: 190, message: err.message };
    return { ok: true, code: err?.code, message: err?.message };
  } catch (e) {
    return { ok: true, message: e instanceof Error ? e.message : "network" };
  }
}

/** Événement de test visible dans Events Manager → « Événements de test ». */
export async function sendMetaTestEvent(
  pixelId: string,
  token: string,
  testEventCode: string,
  sourceUrl: string,
): Promise<{ ok: boolean; message?: string; code?: number; body?: unknown }> {
  const event = {
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000),
    event_id: `test:${crypto.randomUUID()}`,
    action_source: "website",
    event_source_url: sourceUrl,
    user_data: {
      em: [await sha256Hex("test@yunoapp.eu")],
      client_user_agent: "Mozilla/5.0 (Yuno connection test)",
      client_ip_address: "127.0.0.1",
    },
    custom_data: { value: 1, currency: "EUR", content_ids: ["yuno-test"], content_type: "product", order_id: "yuno-test" },
  };
  const r = await postEvents(pixelId, token, [event], testEventCode);
  if (r.ok) return { ok: true, body: r.body };
  return { ok: false, code: r.error.code, message: r.error.error_user_msg || r.error.message };
}

/**
 * Draine la file. Appelé par le cron ET en fire-and-forget après une vente
 * (l'attribution Meta se dégrade au-delà d'une à deux heures). Ne lève jamais.
 */
export async function drainMetaOutbox(
  admin: SupabaseClient,
  opts: { limit?: number; timeBudgetMs?: number } = {},
): Promise<{ claimed: number; sent: number; failed: number; retried: number }> {
  const stats = { claimed: 0, sent: 0, failed: 0, retried: 0 };
  const deadline = Date.now() + (opts.timeBudgetMs ?? 20_000);
  try {
    const { data: rows, error } = await admin.rpc("claim_meta_capi_outbox", { p_limit: opts.limit ?? 50 });
    if (error) {
      console.error("[meta-capi] claim:", error.message);
      return stats;
    }
    const batch = (rows ?? []) as Array<{
      id: string; connection_id: string; event_name: string; event_id: string;
      payload: Record<string, unknown>; attempts: number; created_at: string;
    }>;
    stats.claimed = batch.length;
    if (batch.length === 0) return stats;

    const connCache = new Map<string, { conn: ConnectionRow | null; token: string | null }>();
    const loadConn = async (id: string) => {
      const cached = connCache.get(id);
      if (cached) return cached;
      const { data } = await admin
        .from("meta_connections")
        .select("id, venue_id, organizer_user_id, pixel_id, status, events_enabled, send_native, vault_secret_id, test_event_code, test_event_code_expires_at, token_kind, token_expires_at")
        .eq("id", id)
        .maybeSingle();
      const conn = (data ?? null) as ConnectionRow | null;
      let token: string | null = null;
      const expired = !!conn?.token_expires_at && new Date(conn.token_expires_at) <= new Date();
      if (conn && conn.status === "active" && conn.vault_secret_id && !expired) {
        const { data: t } = await admin.rpc("get_meta_capi_token", { p_connection_id: id });
        token = typeof t === "string" && t ? t : null;
      }
      const entry = { conn, token };
      connCache.set(id, entry);
      return entry;
    };

    for (const row of batch) {
      if (Date.now() > deadline) {
        // Temps épuisé : on rend la ligne à la file sans compter une tentative.
        await admin.from("meta_capi_outbox").update({ status: "queued" }).eq("id", row.id);
        continue;
      }
      const { conn, token } = await loadConn(row.connection_id);
      if (!conn || conn.status !== "active" || !token) {
        await admin.from("meta_capi_outbox").update({
          status: "failed", last_error: conn ? "connection_inactive" : "connection_missing",
        }).eq("id", row.id);
        stats.failed++;
        continue;
      }
      const eventTime = Number(row.payload.event_time ?? 0);
      if (!eventTime || Math.floor(Date.now() / 1000) - eventTime > MAX_EVENT_AGE_S) {
        await admin.from("meta_capi_outbox").update({ status: "failed", last_error: "event_too_old" }).eq("id", row.id);
        stats.failed++;
        continue;
      }
      const testCode = conn.test_event_code && conn.test_event_code_expires_at && new Date(conn.test_event_code_expires_at) > new Date()
        ? conn.test_event_code
        : null;

      const r = await postEvents(conn.pixel_id, token, [row.payload], testCode);
      if (r.ok) {
        await admin.from("meta_capi_outbox").update({
          status: "sent", sent_at: new Date().toISOString(), attempts: row.attempts + 1,
          response: r.body as Record<string, unknown>, last_error: null,
        }).eq("id", row.id);
        await admin.from("meta_connections").update({
          last_ok_at: new Date().toISOString(),
          ...(testCode ? {} : { verified_at: new Date().toISOString() }),
        }).eq("id", conn.id).is("verified_at", null);
        await admin.from("meta_connections").update({ last_ok_at: new Date().toISOString() }).eq("id", conn.id);
        stats.sent++;
        continue;
      }

      const msg = `${r.error.code ?? r.status}: ${r.error.error_user_msg || r.error.message || "unknown"}`.slice(0, 500);
      if (r.error.code === 190) {
        // Jeton révoqué ou régénéré : la connexion s'éteint, le pro et le
        // super admin sont prévenus, la ligne ne sera pas rejouée.
        await admin.from("meta_connections").update({
          status: "token_invalid", last_error: msg, last_error_at: new Date().toISOString(),
        }).eq("id", conn.id);
        connCache.set(conn.id, { conn: { ...conn, status: "token_invalid" }, token: null });
        await admin.from("meta_capi_outbox").update({ status: "failed", last_error: msg, attempts: row.attempts + 1 }).eq("id", row.id);
        stats.failed++;
        await notifyTokenInvalid(admin, conn, msg);
        continue;
      }
      const attempts = row.attempts + 1;
      if (r.retryable && attempts < RETRY_DELAYS_S.length) {
        const next = new Date(Date.now() + RETRY_DELAYS_S[attempts] * 1000).toISOString();
        await admin.from("meta_capi_outbox").update({ status: "queued", attempts, next_attempt_at: next, last_error: msg }).eq("id", row.id);
        stats.retried++;
      } else {
        await admin.from("meta_capi_outbox").update({ status: "failed", attempts, last_error: msg }).eq("id", row.id);
        await admin.from("meta_connections").update({ last_error: msg, last_error_at: new Date().toISOString() }).eq("id", conn.id);
        stats.failed++;
      }
    }
  } catch (e) {
    console.error("[meta-capi] drain threw:", e instanceof Error ? e.message : String(e));
  }
  return stats;
}

async function notifyTokenInvalid(admin: SupabaseClient, conn: ConnectionRow, msg: string): Promise<void> {
  try {
    const scope = conn.venue_id ? `venue:${conn.venue_id}` : conn.organizer_user_id ? `org:${conn.organizer_user_id}` : "platform";
    await admin.rpc("emit_admin_notification", {
      p_type: "admin_meta_token_invalid",
      p_title: "Jeton Meta invalide",
      p_message: `La connexion Meta (${scope}, pixel ${conn.pixel_id}) est coupée : ${msg}`,
      p_priority: "high",
      p_reference_type: "meta_connection",
      p_reference_id: conn.id,
      p_metadata: { scope, pixel_id: conn.pixel_id },
      p_dedup_key: `meta_token_invalid:${conn.id}`,
    });
    if (conn.venue_id) {
      await admin.from("staff_notifications").insert({
        venue_id: conn.venue_id, target_role: "owner", notification_type: "meta_token_invalid",
        title: "Connexion Meta coupée", message: "Le jeton Conversions API a été refusé par Meta. Régénérez-le dans Events Manager et collez-le à nouveau dans Réglages → Intégrations.",
        priority: "high", reference_type: "meta_connection", reference_id: conn.id, metadata: { pixel_id: conn.pixel_id },
      });
    } else if (conn.organizer_user_id) {
      await admin.from("organizer_notifications").insert({
        organizer_user_id: conn.organizer_user_id, notification_type: "meta_token_invalid",
        title: "Connexion Meta coupée", message: "Le jeton Conversions API a été refusé par Meta. Régénérez-le dans Events Manager et collez-le à nouveau dans Réglages → Intégrations.",
        priority: "high", reference_type: "meta_connection", reference_id: conn.id, metadata: { pixel_id: conn.pixel_id },
      });
    }
  } catch (e) {
    console.error("[meta-capi] notify:", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Jetons utilisateur (connexion en un clic sans Business Manager) : ~60 jours.
 * Une semaine avant, le pro est prévenu (une fois) ; passé la date, la
 * connexion s'éteint proprement et l'alerte part. Appelé par le cron.
 */
export async function sweepMetaTokenExpiry(admin: SupabaseClient): Promise<{ warned: number; expired: number }> {
  const out = { warned: 0, expired: 0 };
  try {
    const soon = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const { data } = await admin
      .from("meta_connections")
      .select("id, venue_id, organizer_user_id, pixel_id, status, token_expires_at, last_health")
      .eq("status", "active")
      .not("token_expires_at", "is", null)
      .lte("token_expires_at", soon);
    for (const c of (data ?? []) as Array<{ id: string; venue_id: string | null; organizer_user_id: string | null; pixel_id: string; token_expires_at: string; last_health: Record<string, unknown> | null }>) {
      const isExpired = new Date(c.token_expires_at) <= new Date();
      const title = isExpired ? "Connexion Meta expirée" : "Connexion Meta : reconnexion nécessaire";
      const message = isExpired
        ? "L'autorisation Facebook a expiré. Reconnectez Meta dans Réglages → Intégrations pour reprendre l'envoi des ventes."
        : "L'autorisation Facebook expire dans moins de 7 jours. Cliquez « Reconnecter » dans Réglages → Intégrations.";
      if (isExpired) {
        await admin.from("meta_connections").update({ status: "token_invalid", last_error: "token_expired", last_error_at: new Date().toISOString() }).eq("id", c.id);
        out.expired++;
      } else {
        const warnedAt = c.last_health?.expiry_warned_at as string | undefined;
        if (warnedAt && Date.now() - new Date(warnedAt).getTime() < 3 * 24 * 3600 * 1000) continue;
        await admin.from("meta_connections").update({ last_health: { ...(c.last_health ?? {}), expiry_warned_at: new Date().toISOString() } }).eq("id", c.id);
        out.warned++;
      }
      const row = { notification_type: isExpired ? "meta_token_invalid" : "meta_token_expiring", title, message, priority: "high", reference_type: "meta_connection", reference_id: c.id, metadata: { pixel_id: c.pixel_id, expires_at: c.token_expires_at } };
      if (c.venue_id) await admin.from("staff_notifications").insert({ venue_id: c.venue_id, target_role: "owner", ...row });
      else if (c.organizer_user_id) await admin.from("organizer_notifications").insert({ organizer_user_id: c.organizer_user_id, ...row });
    }
  } catch (e) {
    console.error("[meta-capi] token expiry sweep:", e instanceof Error ? e.message : String(e));
  }
  return out;
}

/** Lance le drain sans bloquer la réponse HTTP (EdgeRuntime.waitUntil si dispo). */
export function drainMetaOutboxInBackground(admin: SupabaseClient): void {
  try {
    const p = drainMetaOutbox(admin, { limit: 20, timeBudgetMs: 12_000 }).catch(() => undefined);
    const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(p);
  } catch {
    // jamais bloquant
  }
}

/**
 * Résout les portées bénéficiaires d'une soirée : club (ou club partenaire) et
 * organisateur (ou organisateur partenaire). Une soirée collab envoie l'achat
 * aux deux pixels.
 */
export async function resolveEventScopes(
  admin: SupabaseClient,
  eventId: string | null | undefined,
): Promise<{ venueIds: string[]; organizerIds: string[]; title: string | null; city: string | null }> {
  if (!eventId) return { venueIds: [], organizerIds: [], title: null, city: null };
  try {
    const { data } = await admin
      .from("events")
      .select("title, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id, location_city")
      .eq("id", eventId)
      .maybeSingle();
    if (!data) return { venueIds: [], organizerIds: [], title: null, city: null };
    const d = data as { title: string | null; venue_id: string | null; partner_venue_id: string | null; organizer_user_id: string | null; partner_organizer_id: string | null; location_city: string | null };
    return {
      venueIds: [d.venue_id, d.partner_venue_id].filter((v): v is string => !!v),
      organizerIds: [d.organizer_user_id, d.partner_organizer_id].filter((v): v is string => !!v),
      title: d.title,
      city: d.location_city,
    };
  } catch {
    return { venueIds: [], organizerIds: [], title: null, city: null };
  }
}
