// Meta (Facebook / Instagram) — connexion d'un club, d'un organisateur ou de la
// plateforme au Pixel + Conversions API.
// Design : docs/designs/META_ADS_INTEGRATION_PLAN.md ; mise en service de la
// connexion en un clic : docs/META_GO_LIVE_GUIDE.md.
//
// Deux façons de se connecter, un seul rangement (jeton dans le Vault) :
//   - Un clic (phase 2, Facebook Login for Business) : `oauth_start` rend l'URL
//     du dialogue Meta ; Meta renvoie le navigateur sur GET /oauth/callback avec
//     un `code` ; on l'échange côté serveur, on découvre pixels / comptes pub /
//     Pages, on range le jeton, et si le pro n'a qu'un pixel la connexion est
//     active tout de suite (sinon `select_assets`).
//   - Manuel (phase 1, « mode avancé ») : `save` avec Pixel ID + jeton collés.
//
// Actions POST (JSON, JWT vérifié ICI — verify_jwt=false au niveau fonction) :
//   oauth_start   { scope, returnTo }
//   select_assets { scope, pixelId, adAccountId?, pageId? }   (aussi sur une connexion active)
//   health        { scope }                          debug_token + qualité dataset
//   save          { scope, pixelId, token?, testEventCode? }
//   test          { scope, testEventCode }
//   update        { scope, eventsEnabled?, clearTestCode? }
//   disconnect    { scope }
//   Publicité (phases 3-4) : ads_search_geo, ads_search (intérêts / langues),
//   ads_reach_estimate, ads_account_status, audience_create / audience_lookalike /
//   audience_sync / audience_delete, campaign_create (toujours PAUSED ; une à six
//   créations image / carrousel / vidéo = autant de pubs dans le même ensemble),
//   campaign_set_status / campaign_refresh / campaign_delete, leads_subscribe.
// Sans JWT (appelées par Meta) :
//   GET  /oauth/callback?code&state
//   POST /data-deletion   (signed_request)  → efface les connexions de ce compte Meta
//   POST /deauthorize     (signed_request)  → idem (l'app a été retirée côté Meta)
//   GET/POST /webhook     (hub.* / X-Hub-Signature-256) → leads
//
// `scope` = { venueId } | { organizerUserId } | {} (plateforme, super admin).
// Surface identité/argent : refusée en session support (accès assisté).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { isSupportSessionToken } from "../_shared/support-session.ts";
import { checkMetaToken, sendMetaTestEvent } from "../_shared/meta-capi.ts";
import {
  PUBLIC_BASE as ADS_PUBLIC_BASE, searchGeo, createFullCampaign, setCampaignStatus, syncMetaInsights, syncMetaAudiences,
  processMetaLeads, pageAccessToken, pageInstagramAccount, subscribePageToLeads, adAccountInfo,
  webhookVerifyToken, verifyHubSignature, graphPost, ensureAppWebhookSubscription,
  searchInterests, searchLocales, searchDetailed, reachEstimate, listInstagramMedia, updateAdSet, setAdStatus,
  buildTargeting, deliveryParams, scheduleParams, isRuleAudienceKind,
  type CampaignTargeting, type CampaignCreative, type CampaignPlacements, type CreativeFormat, type Delivery, type CampaignObjective, type GeoPlace, type DetailedCriterion,
} from "../_shared/meta-ads.ts";
import {
  readMetaAppConfig, signState, verifyState, safeReturnTo, buildDialogUrl,
  exchangeCode, exchangeLongLived, discoverAssets, debugToken, datasetQuality,
  graphDelete, parseSignedRequest, type MetaAssets,
} from "../_shared/meta-oauth.ts";

const PIXEL_RE = /^[0-9]{6,32}$/;
const TEST_CODE_RE = /^[A-Za-z0-9_-]{4,40}$/;
const TEST_CODE_TTL_MS = 7 * 24 * 3600 * 1000;
const PUBLIC_BASE = "https://yunoapp.eu";

type Scope = { venueId: string | null; organizerUserId: string | null };

/** Garde le choix déjà fait du pro s'il existe toujours chez Meta, sinon rien. */
const keep = (prev: string | null | undefined, list: Array<{ id: string }>) => (prev && list.some((x) => x.id === prev) ? prev : null);

interface ConnRow {
  id: string;
  mode: "manual" | "oauth";
  pixel_id: string;
  vault_secret_id: string | null;
  test_event_code: string | null;
  test_event_code_expires_at: string | null;
  status: string;
  token_kind: "capi" | "bisu" | "user";
  assets: MetaAssets | null;
  meta_user_id: string | null;
  ad_account_id: string | null;
  page_id: string | null;
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

function parseScope(raw: unknown): Scope | null {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const venueId = typeof s.venueId === "string" && s.venueId.trim() ? s.venueId.trim() : null;
  const organizerUserId = typeof s.organizerUserId === "string" && /^[0-9a-f-]{36}$/i.test(s.organizerUserId) ? s.organizerUserId : null;
  if (venueId && organizerUserId) return null;
  return { venueId, organizerUserId };
}

async function findConnection(admin: SupabaseClient, scope: Scope): Promise<ConnRow | null> {
  let q = admin.from("meta_connections").select("id, mode, pixel_id, vault_secret_id, test_event_code, test_event_code_expires_at, status, token_kind, assets, meta_user_id, ad_account_id, page_id");
  q = scope.venueId ? q.eq("venue_id", scope.venueId) : q.is("venue_id", null);
  q = scope.organizerUserId ? q.eq("organizer_user_id", scope.organizerUserId) : q.is("organizer_user_id", null);
  const { data } = await q.maybeSingle();
  return (data ?? null) as ConnRow | null;
}

const GEO_RE = /^[A-Za-z0-9:_-]{1,40}$/;
function parseGeo(list: unknown, max = 25): GeoPlace[] {
  if (!Array.isArray(list)) return [];
  return list.filter((x) => x && typeof x.key === "string" && GEO_RE.test(x.key) && typeof x.name === "string").slice(0, max)
    .map((x) => ({ key: x.key as string, name: String(x.name).slice(0, 80), radius_km: Number(x.radius_km) || 25, type: x.type === "region" ? "region" : "city" }));
}

/** Ciblage : on ne garde que ce qu'on sait envoyer à Meta, borné. `null` = incohérent. */
function parseTargeting(t: CampaignTargeting): CampaignTargeting | null {
  const validId = (id: unknown) => /^[0-9]{3,30}$/.test(String(id));
  const detailed = Array.isArray(t.detailed) ? t.detailed.slice(0, 5).map((g) => ({
    items: (Array.isArray(g?.items) ? g.items : []).filter((i) => i && validId(i.id)).slice(0, 50)
      .map((i): DetailedCriterion => ({ id: String(i.id), name: String(i.name ?? "").slice(0, 80), type: /^[a-z_]{2,40}$/.test(String(i.type)) ? String(i.type) : "interests" })),
  })).filter((g) => g.items.length) : [];
  const out: CampaignTargeting = {
    countries: Array.isArray(t.countries) ? t.countries.filter((x) => typeof x === "string" && /^[A-Z]{2}$/.test(x)).slice(0, 10) : [],
    cities: parseGeo(t.cities),
    excluded_cities: parseGeo(t.excluded_cities),
    zips: Array.isArray(t.zips) ? t.zips.filter((z) => z && typeof z.key === "string" && GEO_RE.test(z.key)).slice(0, 100).map((z) => ({ key: z.key, name: String(z.name ?? z.key).slice(0, 40) })) : [],
    custom_locations: Array.isArray(t.custom_locations) ? t.custom_locations.filter((c) => c && Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude))).slice(0, 25)
      .map((c) => ({ latitude: Number(c.latitude), longitude: Number(c.longitude), radius_km: Math.min(80, Math.max(1, Number(c.radius_km) || 10)), name: typeof c.name === "string" ? c.name.slice(0, 120) : undefined })) : [],
    location_types: Array.isArray(t.location_types) ? t.location_types.filter((x): x is "home" | "recent" | "travel_in" => x === "home" || x === "recent" || x === "travel_in").slice(0, 3) : [],
    age_min: Math.max(18, Math.min(65, Math.round(Number(t.age_min) || 18))),
    age_max: Math.max(18, Math.min(65, Math.round(Number(t.age_max) || 40))),
    genders: Array.isArray(t.genders) ? t.genders.filter((g) => g === 1 || g === 2).slice(0, 1) : [],
    audience_ids: Array.isArray(t.audience_ids) ? t.audience_ids.filter((x) => typeof x === "string") : [],
    exclude_audience_ids: Array.isArray(t.exclude_audience_ids) ? t.exclude_audience_ids.filter((x) => typeof x === "string") : [],
    interests: Array.isArray(t.interests) ? t.interests.filter((i) => i && validId(i.id)).slice(0, 25).map((i) => ({ id: String(i.id), name: String(i.name ?? "").slice(0, 80) })) : [],
    detailed,
    locales: Array.isArray(t.locales) ? t.locales.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50) : [],
    audience_mode: t.audience_mode === "full" || t.audience_mode === "strict" ? t.audience_mode : "relaxed",
    advantage: t.audience_mode !== "strict",
  };
  if (out.age_max! < out.age_min!) return null;
  return out;
}

function parsePlacements(raw: unknown): CampaignPlacements {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strs = (v: unknown, max = 10) => Array.isArray(v) ? v.filter((x) => typeof x === "string" && /^[a-z_]{2,30}$/.test(x)).slice(0, max) as string[] : [];
  const pos = (p.positions && typeof p.positions === "object" ? p.positions : {}) as Record<string, unknown>;
  const out: CampaignPlacements = { facebook: p.facebook !== false, instagram: p.instagram !== false };
  const fb = strs(pos.facebook); const ig = strs(pos.instagram);
  if (fb.length || ig.length) out.positions = { facebook: fb, instagram: ig };
  const devices = strs(p.devices, 2).filter((d): d is "mobile" | "desktop" => d === "mobile" || d === "desktop");
  if (devices.length) out.devices = devices;
  return out;
}

function parseDelivery(raw: unknown, objective: CampaignObjective): Delivery {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Delivery = {};
  if (objective === "OUTCOME_SALES" && (d.conversion_event === "INITIATED_CHECKOUT" || d.conversion_event === "CONTENT_VIEW" || d.conversion_event === "PURCHASE")) out.conversion_event = d.conversion_event;
  if (typeof d.optimization_goal === "string" && ["LINK_CLICKS", "LANDING_PAGE_VIEWS", "REACH", "IMPRESSIONS", "OFFSITE_CONVERSIONS"].includes(d.optimization_goal)) out.optimization_goal = d.optimization_goal;
  const bid = (d.bid && typeof d.bid === "object" ? d.bid : null) as Record<string, unknown> | null;
  if (bid && ["cost_cap", "bid_cap", "min_roas"].includes(String(bid.strategy))) {
    out.bid = { strategy: bid.strategy as Delivery["bid"] extends infer B ? B extends { strategy: infer S } ? S : never : never };
    const amount = Math.round(Number(bid.amount_cents)); if (Number.isFinite(amount) && amount >= 10) out.bid.amount_cents = amount;
    const floor = Number(bid.roas_floor); if (Number.isFinite(floor) && floor > 0 && floor < 100) out.bid.roas_floor = floor;
  }
  if (Array.isArray(d.schedule)) {
    out.schedule = d.schedule.slice(0, 14).map((sl) => (sl && typeof sl === "object" ? sl : {}) as Record<string, unknown>).map((sl) => ({
      days: Array.isArray(sl.days) ? sl.days.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : [],
      start_hour: Math.max(0, Math.min(23, Math.round(Number(sl.start_hour) || 0))),
      end_hour: Math.max(1, Math.min(24, Math.round(Number(sl.end_hour) || 24))),
    })).filter((sl) => sl.days.length && sl.end_hour > sl.start_hour);
    if (!out.schedule.length) delete out.schedule;
  }
  const fq = (d.frequency && typeof d.frequency === "object" ? d.frequency : null) as Record<string, unknown> | null;
  if (objective === "OUTCOME_AWARENESS" && fq && Number(fq.max) >= 1 && Number(fq.days) >= 1) out.frequency = { max: Math.min(90, Math.round(Number(fq.max))), days: Math.min(90, Math.round(Number(fq.days))) };
  if (typeof d.url_tags === "string" && d.url_tags.trim()) {
    const tags = d.url_tags.trim().replace(/^[?&]+/, "").slice(0, 500);
    if (/^[A-Za-z0-9_\-=&%.{}]+$/.test(tags)) out.url_tags = tags;
  }
  return out;
}

async function tokenOf(admin: SupabaseClient, connectionId: string): Promise<string | null> {
  const { data } = await admin.rpc("get_meta_capi_token", { p_connection_id: connectionId });
  return typeof data === "string" && data ? data : null;
}

Deno.serve(async (req) => {
  const cors = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const cfg = readMetaAppConfig(SUPABASE_URL);
  const path = new URL(req.url).pathname;

  try {
    // ── Retour du dialogue Meta (navigateur, pas de JWT) ────────────────────
    if (req.method === "GET" && path.endsWith("/oauth/callback")) {
      const url = new URL(req.url);
      const back = (to: string, q: string) => redirect(`${PUBLIC_BASE}${to}?${q}`);
      if (!cfg) return back("/owner/integrations", "meta=error&reason=oauth_not_configured");
      const state = await verifyState(cfg.appSecret, url.searchParams.get("state"));
      if (!state) return back("/owner/integrations", "meta=error&reason=state_invalid");
      const returnTo = safeReturnTo(state.returnTo);
      if (url.searchParams.get("error")) {
        return back(returnTo, `meta=error&reason=${encodeURIComponent(url.searchParams.get("error_reason") ?? url.searchParams.get("error") ?? "denied")}`);
      }
      const code = url.searchParams.get("code");
      if (!code) return back(returnTo, "meta=error&reason=no_code");
      const scope: Scope = { venueId: state.venueId, organizerUserId: state.organizerUserId };

      const ex = await exchangeCode(cfg, code);
      if (!ex.ok) return back(returnTo, `meta=error&reason=${encodeURIComponent(ex.error.message ?? "exchange_failed")}`);
      let token = ex.data.access_token;
      let expiresAt: string | null = null;

      const disc = await discoverAssets(token, cfg.appSecret);
      if (!disc.ok) return back(returnTo, `meta=error&reason=${encodeURIComponent(disc.error ?? "discover_failed")}`);
      if (disc.kind === "user") {
        // Jeton utilisateur : longue durée (~60 j), on garde la date pour
        // prévenir avant l'expiration.
        const ll = await exchangeLongLived(cfg, token);
        if (ll.ok) {
          token = ll.data.access_token;
          if (ll.data.expires_in) expiresAt = new Date(Date.now() + ll.data.expires_in * 1000).toISOString();
        } else if (ex.data.expires_in) {
          expiresAt = new Date(Date.now() + ex.data.expires_in * 1000).toISOString();
        }
      }

      const a = disc.assets;
      const existing = await findConnection(admin, scope);
      // Un choix déjà fait (reconnexion) est conservé s'il figure encore dans
      // les actifs autorisés ; un actif unique est retenu d'office ; dès
      // qu'une liste laisse le choix, le pro tranche lui-même (`meta=choose`).
      const pixelId = a.pixels.length === 1 ? a.pixels[0].id : (keep(existing?.pixel_id, a.pixels) ?? "pending");
      const adAccountId = keep(existing?.ad_account_id, a.ad_accounts) ?? (a.ad_accounts.length === 1 ? a.ad_accounts[0].id : null);
      const pageId = keep(existing?.page_id, a.pages) ?? (a.pages.length === 1 ? a.pages[0].id : null);
      const needsChoice = pixelId === "pending" || (a.ad_accounts.length > 1 && !adAccountId) || (a.pages.length > 1 && !pageId);
      const base = {
        mode: "oauth" as const,
        token_kind: disc.kind,
        meta_user_id: disc.metaUserId,
        business_id: disc.businessId,
        assets: a,
        token_expires_at: expiresAt,
        ad_account_id: adAccountId,
        page_id: pageId,
        ig_user_id: pageId ? (a.instagram?.find((i) => i.page_id === pageId)?.id ?? null) : null,
        created_by: state.userId,
      };
      let connectionId = existing?.id ?? null;
      if (!connectionId) {
        const { data: ins, error } = await admin.from("meta_connections").insert({
          venue_id: scope.venueId, organizer_user_id: scope.organizerUserId,
          pixel_id: pixelId, ...base,
        }).select("id").single();
        if (error || !ins) return back(returnTo, `meta=error&reason=${encodeURIComponent(error?.message ?? "insert_failed")}`);
        connectionId = ins.id as string;
      } else {
        const { error } = await admin.from("meta_connections").update({
          pixel_id: pixelId,
          ...(existing!.pixel_id !== pixelId ? { verified_at: null } : {}),
          ...base,
        }).eq("id", connectionId);
        if (error) return back(returnTo, `meta=error&reason=${encodeURIComponent(error.message)}`);
      }
      const { error: storeErr } = await admin.rpc("store_meta_capi_token", { p_connection_id: connectionId, p_token: token });
      if (storeErr) return back(returnTo, `meta=error&reason=${encodeURIComponent(storeErr.message)}`);
      // store_* remet status=active : on repasse en attente tant que le pro n'a pas tranché.
      await admin.from("meta_connections").update({ status: needsChoice ? "pending_assets" : "active" }).eq("id", connectionId);
      return back(returnTo, needsChoice ? "meta=choose" : "meta=connected");
    }

    // ── Rappels signés de Meta (suppression de données, désautorisation) ────
    if (req.method === "POST" && (path.endsWith("/data-deletion") || path.endsWith("/deauthorize"))) {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const form = await req.formData().catch(() => null);
      const sr = await parseSignedRequest(cfg.appSecret, form?.get("signed_request")?.toString() ?? null);
      if (!sr?.user_id) return json({ error: "bad_signature" }, 400, cors);
      const kind = path.endsWith("/data-deletion") ? "deletion" : "deauthorize";
      const { data: rows } = await admin.from("meta_connections").select("id").eq("meta_user_id", sr.user_id);
      const ids = (rows ?? []).map((r) => r.id as string);
      if (ids.length > 0) await admin.from("meta_connections").delete().in("id", ids);
      const confirmation = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      await admin.from("meta_data_requests").insert({ kind, meta_user_id: sr.user_id, confirmation_code: confirmation, connections_affected: ids.length });
      return json({ url: `${PUBLIC_BASE}/legal/confidentialite?meta_request=${confirmation}`, confirmation_code: confirmation }, 200, cors);
    }

    // ── Webhook Lead Ads (Meta, sans JWT) ───────────────────────────────────
    if (path.endsWith("/webhook")) {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const url = new URL(req.url);
      if (req.method === "GET") {
        const mode = url.searchParams.get("hub.mode");
        const verify = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge") ?? "";
        if (mode === "subscribe" && verify === await webhookVerifyToken(cfg.appSecret)) {
          return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
        }
        return json({ error: "verify_failed" }, 403, cors);
      }
      if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
      // Signature calculée sur les OCTETS BRUTS, avant tout parse.
      const raw = await req.text();
      if (!(await verifyHubSignature(cfg.appSecret, raw, req.headers.get("x-hub-signature-256")))) {
        return json({ error: "bad_signature" }, 401, cors);
      }
      let payload: { object?: string; entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> } = {};
      try { payload = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400, cors); }
      let inserted = 0;
      if (payload.object === "page") {
        for (const entry of payload.entry ?? []) {
          for (const ch of entry.changes ?? []) {
            if (ch.field !== "leadgen" || !ch.value) continue;
            const v = ch.value as { leadgen_id?: string | number; page_id?: string | number; form_id?: string | number; ad_id?: string | number; created_time?: number };
            if (!v.leadgen_id) continue;
            const pageId = String(v.page_id ?? entry.id ?? "");
            const { data: conn } = await admin.from("meta_connections").select("id").eq("page_id", pageId).eq("status", "active").maybeSingle();
            const { error } = await admin.from("meta_leads").upsert({
              leadgen_id: String(v.leadgen_id), connection_id: (conn as { id: string } | null)?.id ?? null,
              page_id: pageId, form_id: v.form_id ? String(v.form_id) : null, ad_id: v.ad_id ? String(v.ad_id) : null,
              received_at: v.created_time ? new Date(v.created_time * 1000).toISOString() : new Date().toISOString(),
            }, { onConflict: "leadgen_id", ignoreDuplicates: true });
            if (!error) inserted++;
          }
        }
      }
      // Réponse immédiate (Meta réessaie 36 h sinon) ; traitement en arrière-plan.
      if (inserted > 0) {
        const p = processMetaLeads(admin, cfg.appSecret).catch(() => undefined);
        const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
        if (rt?.waitUntil) rt.waitUntil(p);
      }
      return json({ ok: true, inserted }, 200, cors);
    }

    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);

    // ── Actions du pro (JWT vérifié ici) ────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401, cors);
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "unauthorized" }, 401, cors);
    if (await isSupportSessionToken(admin as unknown as Parameters<typeof isSupportSessionToken>[0], authHeader.slice(7))) {
      return json({ error: "support_session_forbidden" }, 403, cors);
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const scope = parseScope(body.scope);
    if (!scope) return json({ error: "invalid_scope" }, 400, cors);

    const { data: allowed, error: allowErr } = await userClient.rpc("meta_scope_allowed", {
      p_venue_id: scope.venueId,
      p_organizer_user_id: scope.organizerUserId,
    });
    if (allowErr || allowed !== true) return json({ error: "forbidden" }, 403, cors);

    const sourceUrl = `${PUBLIC_BASE}/`;

    // ── oauth_start ─────────────────────────────────────────────────────────
    if (action === "oauth_start") {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const state = await signState(cfg.appSecret, {
        v: 1, venueId: scope.venueId, organizerUserId: scope.organizerUserId,
        userId: user.id, returnTo: safeReturnTo(body.returnTo), nonce: crypto.randomUUID(), ts: Date.now(),
      });
      return json({ ok: true, url: buildDialogUrl(cfg, state) }, 200, cors);
    }

    // ── select_assets ───────────────────────────────────────────────────────
    if (action === "select_assets") {
      const existing = await findConnection(admin, scope);
      // Manual ou oauth : ce qui compte est d'avoir des actifs découverts.
      if (!existing?.assets) return json({ error: "not_connected" }, 404, cors);
      const pixelId = typeof body.pixelId === "string" ? body.pixelId.trim() : "";
      if (!existing.assets.pixels.some((p) => p.id === pixelId)) return json({ error: "invalid_pixel_id" }, 400, cors);
      const adAccountId = typeof body.adAccountId === "string" && existing.assets.ad_accounts.some((a) => a.id === body.adAccountId) ? body.adAccountId : undefined;
      const pageId = typeof body.pageId === "string" && existing.assets.pages.some((p) => p.id === body.pageId) ? body.pageId : undefined;
      // Autorisé aussi sur une connexion active (« Changer les actifs ») : le
      // pixel ne perd sa vérification que s'il change, et l'identité Instagram
      // suit toujours la Page retenue.
      const { error } = await admin.from("meta_connections").update({
        pixel_id: pixelId, status: "active", last_error: null, last_error_at: null,
        ...(pixelId !== existing.pixel_id ? { verified_at: null } : {}),
        ...(adAccountId ? { ad_account_id: adAccountId } : {}),
        ...(pageId ? { page_id: pageId, ig_user_id: existing.assets.instagram?.find((i) => i.page_id === pageId)?.id ?? null } : {}),
      }).eq("id", existing.id);
      if (error) return json({ error: "update_failed", detail: error.message }, 500, cors);
      return json({ ok: true }, 200, cors);
    }

    // ── health ──────────────────────────────────────────────────────────────
    if (action === "health") {
      const existing = await findConnection(admin, scope);
      if (!existing?.vault_secret_id) return json({ error: "not_connected" }, 404, cors);
      const token = await tokenOf(admin, existing.id);
      if (!token) return json({ error: "token_missing" }, 500, cors);
      const health: Record<string, unknown> = { checked_at: new Date().toISOString() };
      if (cfg) {
        const dbg = await debugToken(cfg, token);
        if (dbg.ok && dbg.data.data) {
          const d = dbg.data.data;
          health.is_valid = d.is_valid ?? null;
          health.scopes = d.scopes ?? null;
          health.expires_at = d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null;
          health.type = d.type ?? null;
          if (d.is_valid === false) {
            await admin.from("meta_connections").update({ status: "token_invalid", last_error: d.error?.message ?? "token invalid", last_error_at: new Date().toISOString() }).eq("id", existing.id);
          }
        } else if (!dbg.ok) {
          health.debug_error = dbg.error.message ?? null;
        }
        if (PIXEL_RE.test(existing.pixel_id)) {
          const q = await datasetQuality(existing.pixel_id, token, cfg.appSecret);
          health.dataset_quality = q.ok ? q.data : { error: q.error.message ?? null };
        }
        // Portée plateforme (super admin) : état de l'abonnement webhook de l'app.
        if (!scope.venueId && !scope.organizerUserId) {
          const wh = await ensureAppWebhookSubscription(cfg, `${SUPABASE_URL}/functions/v1/meta-connect/webhook`);
          health.app_webhook = { registered: wh.registered, error: wh.error ?? null };
        }
      } else {
        health.note = "oauth_not_configured";
      }
      // « Check now » relit aussi les ACTIFS, et c'est la moitié utile du
      // bouton : la liste écrite à la connexion ne bougeait plus jamais. Un
      // Instagram relié à la Page le lendemain, une Page ou un pixel créés
      // depuis, n'existaient nulle part pour Yuno — le pro voyait « aucun
      // compte Instagram » devant une Page qui en affichait un chez Meta.
      // Le choix du pro est conservé tant qu'il figure encore dans les actifs
      // autorisés ; le pixel n'est jamais changé ici, il porte la vérification.
      const assetPatch: Record<string, unknown> = {};
      if (cfg) {
        const disc = await discoverAssets(token, cfg.appSecret);
        if (disc.ok) {
          const a = disc.assets;
          const pageId = keep(existing.page_id, a.pages) ?? (a.pages.length === 1 ? a.pages[0].id : null);
          assetPatch.assets = a;
          assetPatch.token_kind = disc.kind;
          assetPatch.page_id = pageId;
          assetPatch.ad_account_id = keep(existing.ad_account_id, a.ad_accounts) ?? (a.ad_accounts.length === 1 ? a.ad_accounts[0].id : null);
          assetPatch.ig_user_id = pageId ? (a.instagram?.find((i) => i.page_id === pageId)?.id ?? null) : null;
          health.assets_refreshed_at = new Date().toISOString();
        }
      }
      await admin.from("meta_connections").update({ ...assetPatch, last_health: health, last_health_at: new Date().toISOString() }).eq("id", existing.id);
      return json({ ok: true, health }, 200, cors);
    }

    // ── save (mode manuel / avancé) ─────────────────────────────────────────
    if (action === "save") {
      const pixelId = typeof body.pixelId === "string" ? body.pixelId.trim() : "";
      if (!PIXEL_RE.test(pixelId)) return json({ error: "invalid_pixel_id" }, 400, cors);
      const token = typeof body.token === "string" ? body.token.trim() : "";
      const testEventCode = typeof body.testEventCode === "string" ? body.testEventCode.trim() : "";
      if (testEventCode && !TEST_CODE_RE.test(testEventCode)) return json({ error: "invalid_test_code" }, 400, cors);

      const existing = await findConnection(admin, scope);
      if (!token && !existing?.vault_secret_id) return json({ error: "token_required" }, 400, cors);
      if (token && (token.length < 20 || token.length > 600 || /\s/.test(token))) return json({ error: "invalid_token" }, 400, cors);

      let datasetName: string | undefined;
      if (token) {
        const check = await checkMetaToken(pixelId, token);
        if (!check.ok) return json({ error: "token_invalid", detail: check.message ?? null }, 400, cors);
        datasetName = check.name;
      }

      // Un jeton collé n'est pas forcément un simple jeton d'événements. Un
      // utilisateur système de Business Manager (Paramètres → Utilisateurs →
      // Utilisateurs système) porte `ads_management` et n'expire pas — et il se
      // crée SANS passer par Facebook Login, ce qui est la seule porte des pros
      // qui gèrent tout depuis Instagram. On regarde donc ce que le jeton sait
      // faire au lieu de le supposer, et on ouvre exactement ça.
      //
      // Le proof reste obligatoire pour piloter les publicités : il est calculé
      // avec le secret de l'app Yuno, donc il n'est valable que pour un jeton
      // émis POUR l'app Yuno. Un jeton d'une autre app est reconnu (découverte
      // sans proof) mais ne débloque pas les pubs : les crons signeraient leurs
      // appels avec un proof faux. Le pro régénère son jeton en choisissant
      // l'app Yuno, c'est un clic dans la fenêtre de Meta.
      let discovered: Awaited<ReturnType<typeof discoverAssets>> | null = null;
      let foreignApp = false;
      if (token && cfg) {
        const withProof = await discoverAssets(token, cfg.appSecret);
        if (withProof.ok) discovered = withProof;
        else {
          const withoutProof = await discoverAssets(token, null);
          if (withoutProof.ok) foreignApp = true;
        }
      }
      const a = discovered?.assets ?? null;
      const soleAdAccount = a && a.ad_accounts.length === 1 ? a.ad_accounts[0].id : null;
      const solePage = a && a.pages.length === 1 ? a.pages[0].id : null;
      const assetFields: Record<string, unknown> = discovered
        ? {
          token_kind: discovered.kind,
          assets: a,
          meta_user_id: discovered.metaUserId,
          business_id: discovered.businessId,
          ad_account_id: keep(existing?.ad_account_id, a!.ad_accounts) ?? soleAdAccount,
          page_id: keep(existing?.page_id, a!.pages) ?? solePage,
          ig_user_id: a!.instagram?.find((i) => i.page_id === (keep(existing?.page_id, a!.pages) ?? solePage))?.id ?? null,
          last_error: null, last_error_at: null,
        }
        : {
          token_kind: "capi", assets: null, meta_user_id: null,
          ...(foreignApp ? { last_error: "token_other_app", last_error_at: new Date().toISOString() } : {}),
        };

      let connectionId = existing?.id ?? null;
      if (!connectionId) {
        const { data: inserted, error: insErr } = await admin
          .from("meta_connections")
          .insert({ venue_id: scope.venueId, organizer_user_id: scope.organizerUserId, mode: "manual", pixel_id: pixelId, created_by: user.id, ...assetFields })
          .select("id")
          .single();
        if (insErr || !inserted) return json({ error: "insert_failed", detail: insErr?.message ?? null }, 500, cors);
        connectionId = inserted.id as string;
      } else {
        const patch: Record<string, unknown> = { pixel_id: pixelId, mode: "manual", token_expires_at: null, ...assetFields };
        if (existing && existing.pixel_id !== pixelId) patch.verified_at = null;
        const { error: updErr } = await admin.from("meta_connections").update(patch).eq("id", connectionId);
        if (updErr) return json({ error: "update_failed", detail: updErr.message }, 500, cors);
      }

      if (token) {
        const { error: storeErr } = await admin.rpc("store_meta_capi_token", { p_connection_id: connectionId, p_token: token });
        if (storeErr) return json({ error: "store_failed", detail: storeErr.message }, 500, cors);
      }
      if (testEventCode) {
        await admin.from("meta_connections").update({
          test_event_code: testEventCode,
          test_event_code_expires_at: new Date(Date.now() + TEST_CODE_TTL_MS).toISOString(),
        }).eq("id", connectionId);
      }
      let test: unknown = null;
      if (testEventCode) {
        const t = await tokenOf(admin, connectionId);
        if (t) test = await sendMetaTestEvent(pixelId, t, testEventCode, sourceUrl);
      }
      return json({
        ok: true, connectionId, datasetName: datasetName ?? null, test,
        discovered: discovered ? { adAccounts: discovered.assets.ad_accounts.length, pages: discovered.assets.pages.length } : null,
        foreignApp,
      }, 200, cors);
    }

    // ── test ────────────────────────────────────────────────────────────────
    if (action === "test") {
      const existing = await findConnection(admin, scope);
      if (!existing?.vault_secret_id || !PIXEL_RE.test(existing.pixel_id)) return json({ error: "not_connected" }, 404, cors);
      const testEventCode = typeof body.testEventCode === "string" ? body.testEventCode.trim() : "";
      if (!TEST_CODE_RE.test(testEventCode)) return json({ error: "invalid_test_code" }, 400, cors);
      await admin.from("meta_connections").update({
        test_event_code: testEventCode,
        test_event_code_expires_at: new Date(Date.now() + TEST_CODE_TTL_MS).toISOString(),
      }).eq("id", existing.id);
      const t = await tokenOf(admin, existing.id);
      if (!t) return json({ error: "token_missing" }, 500, cors);
      const result = await sendMetaTestEvent(existing.pixel_id, t, testEventCode, sourceUrl);
      if (result.ok) {
        await admin.from("meta_connections").update({ last_ok_at: new Date().toISOString(), last_error: null, last_error_at: null, status: "active" }).eq("id", existing.id);
      } else if (result.code === 190) {
        await admin.from("meta_connections").update({ status: "token_invalid", last_error: result.message ?? "190", last_error_at: new Date().toISOString() }).eq("id", existing.id);
      }
      return json({ ok: result.ok, test: result }, 200, cors);
    }

    // ── update ──────────────────────────────────────────────────────────────
    if (action === "update") {
      const existing = await findConnection(admin, scope);
      if (!existing) return json({ error: "not_connected" }, 404, cors);
      const patch: Record<string, unknown> = {};
      if (body.eventsEnabled && typeof body.eventsEnabled === "object") {
        const src = body.eventsEnabled as Record<string, unknown>;
        const next: Record<string, boolean> = {};
        for (const k of ["pixel", "view_content", "initiate_checkout", "purchase", "lead"]) next[k] = src[k] !== false;
        patch.events_enabled = next;
      }
      if (body.clearTestCode === true) {
        patch.test_event_code = null;
        patch.test_event_code_expires_at = null;
      }
      if (Object.keys(patch).length === 0) return json({ ok: true }, 200, cors);
      const { error } = await admin.from("meta_connections").update(patch).eq("id", existing.id);
      if (error) return json({ error: "update_failed", detail: error.message }, 500, cors);
      return json({ ok: true }, 200, cors);
    }

    // ── Publicité : recherche de villes ─────────────────────────────────────
    if (action === "ads_search_geo") {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const existing = await findConnection(admin, scope);
      if (!existing?.vault_secret_id) return json({ error: "not_connected" }, 404, cors);
      const token = await tokenOf(admin, existing.id);
      if (!token) return json({ error: "token_missing" }, 500, cors);
      const q = typeof body.q === "string" ? body.q.trim().slice(0, 60) : "";
      if (q.length < 2) return json({ ok: true, results: [] }, 200, cors);
      const country = typeof body.country === "string" && /^[A-Z]{2}$/.test(body.country) ? body.country : null;
      const results = await searchGeo(q, country, token, cfg.appSecret, body.kind === "zip" ? ["zip"] : ["city", "region"]);
      return json({ ok: true, results }, 200, cors);
    }

    // ── Publicité : état du compte pub (CGU audiences, devise, paiement) ────
    if (action === "ads_account_status") {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const { data: c } = await admin.from("meta_connections").select("id, ad_account_id, page_id, vault_secret_id, last_health").eq("id", (await findConnection(admin, scope))?.id ?? "").maybeSingle();
      const conn = c as { id: string; ad_account_id: string | null; page_id: string | null; vault_secret_id: string | null; last_health: Record<string, unknown> | null } | null;
      if (!conn?.vault_secret_id || !conn.ad_account_id) return json({ error: "no_ad_account" }, 404, cors);
      const token = await tokenOf(admin, conn.id);
      if (!token) return json({ error: "token_missing" }, 500, cors);
      const info = await adAccountInfo(conn.ad_account_id, token, cfg.appSecret);
      if (!info.ok) return json({ error: "meta_error", detail: info.error.message ?? null }, 502, cors);
      const status = {
        currency: info.data.currency ?? null,
        account_status: info.data.account_status ?? null,
        has_funding: !!info.data.funding_source,
        custom_audience_tos: (info.data.tos_accepted?.custom_audience_tos ?? 0) === 1,
        tos_url: `https://business.facebook.com/ads/manage/customaudiences/tos/?act=${conn.ad_account_id.replace(/^act_/, "")}`,
        checked_at: new Date().toISOString(),
      };
      await admin.from("meta_connections").update({ last_health: { ...(conn.last_health ?? {}), ad_account: status } }).eq("id", conn.id);
      return json({ ok: true, status }, 200, cors);
    }

    // ── Publicité : audiences ───────────────────────────────────────────────
    if (action === "audience_create" || action === "audience_lookalike" || action === "audience_sync" || action === "audience_delete") {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const existing = await findConnection(admin, scope);
      if (!existing?.vault_secret_id) return json({ error: "not_connected" }, 404, cors);
      if (action === "audience_create") {
        const kind = typeof body.kind === "string" && (["builtin", "venue_segment", "contact_segment"].includes(body.kind) || isRuleAudienceKind(body.kind)) ? body.kind : null;
        // Audience à règle : la référence est la fenêtre en jours (30 / 90 / 180 / 365).
        const ref = kind && isRuleAudienceKind(kind)
          ? String([30, 90, 180, 365].includes(Number(body.ref)) ? Number(body.ref) : 30)
          : (typeof body.ref === "string" ? body.ref.trim().slice(0, 80) : "");
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
        if (!kind || !ref || !name) return json({ error: "invalid_audience" }, 400, cors);
        // L'unicité (connection_id, kind, ref) est portée par un index PARTIEL
        // (WHERE kind <> 'lookalike') : PostgREST ne sait pas lui passer le
        // prédicat, donc un upsert on_conflict échouerait en 42P10. On relit
        // puis on écrit à la main, et on retombe sur la relecture si deux
        // clics partent en même temps.
        const findAudience = async () => {
          const { data } = await admin.from("meta_audiences").select("id")
            .eq("connection_id", existing.id).eq("kind", kind).eq("ref", ref).maybeSingle();
          return (data as { id: string } | null)?.id ?? null;
        };
        let audienceId = await findAudience();
        if (audienceId) {
          const { error } = await admin.from("meta_audiences")
            .update({ name, status: "pending", last_error: null }).eq("id", audienceId);
          if (error) return json({ error: "insert_failed", detail: error.message }, 500, cors);
        } else {
          const { data: ins, error } = await admin.from("meta_audiences")
            .insert({ connection_id: existing.id, kind, ref, name, created_by: user.id, status: "pending" })
            .select("id").single();
          if (error || !ins) {
            audienceId = error?.code === "23505" ? await findAudience() : null;
            if (!audienceId) return json({ error: "insert_failed", detail: error?.message ?? null }, 500, cors);
          } else {
            audienceId = (ins as { id: string }).id;
          }
        }
        const r = await syncMetaAudiences(admin, cfg.appSecret, { onlyAudienceId: audienceId, force: true });
        return json({ ok: r.failed === 0, audienceId }, 200, cors);
      }
      if (action === "audience_lookalike") {
        const originId = typeof body.audienceId === "string" ? body.audienceId : "";
        const ratio = typeof body.ratio === "number" ? body.ratio : 0.03;
        const country = typeof body.country === "string" && /^[A-Z]{2}$/.test(body.country) ? body.country : "FR";
        const { data: origin } = await admin.from("meta_audiences").select("id, name, connection_id").eq("id", originId).eq("connection_id", existing.id).maybeSingle();
        if (!origin) return json({ error: "not_found" }, 404, cors);
        const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : `${(origin as { name: string }).name} — jumeaux ${Math.round(ratio * 100)} % ${country}`;
        const { data: row, error } = await admin.from("meta_audiences")
          .insert({ connection_id: existing.id, kind: "lookalike", ref: originId, name, lookalike_ratio: ratio, lookalike_country: country, created_by: user.id })
          .select("id").single();
        if (error || !row) return json({ error: "insert_failed", detail: error?.message ?? null }, 500, cors);
        const r = await syncMetaAudiences(admin, cfg.appSecret, { onlyAudienceId: row.id as string, force: true });
        return json({ ok: r.failed === 0, audienceId: row.id }, 200, cors);
      }
      if (action === "audience_sync") {
        const id = typeof body.audienceId === "string" ? body.audienceId : "";
        const { data: a } = await admin.from("meta_audiences").select("id").eq("id", id).eq("connection_id", existing.id).maybeSingle();
        if (!a) return json({ error: "not_found" }, 404, cors);
        const r = await syncMetaAudiences(admin, cfg.appSecret, { onlyAudienceId: id, force: true });
        return json({ ok: r.failed === 0 }, 200, cors);
      }
      const id = typeof body.audienceId === "string" ? body.audienceId : "";
      const { data: a } = await admin.from("meta_audiences").select("id, meta_audience_id").eq("id", id).eq("connection_id", existing.id).maybeSingle();
      if (!a) return json({ ok: true }, 200, cors);
      const metaId = (a as { meta_audience_id: string | null }).meta_audience_id;
      if (metaId) {
        const token = await tokenOf(admin, existing.id);
        if (token) await graphPost(metaId, { method: "delete" }, token, cfg.appSecret).catch(() => undefined);
      }
      await admin.from("meta_audiences").delete().eq("id", id);
      return json({ ok: true }, 200, cors);
    }

    // ── Publicité : centres d'intérêt, langues, estimation d'audience ──────
    if (action === "ads_search") {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const existing = await findConnection(admin, scope);
      if (!existing?.vault_secret_id) return json({ error: "not_connected" }, 404, cors);
      const token = await tokenOf(admin, existing.id);
      if (!token) return json({ error: "token_missing" }, 500, cors);
      const q = typeof body.q === "string" ? body.q.trim().slice(0, 60) : "";
      if (q.length < 2) return json({ ok: true, results: [] }, 200, cors);
      const locale = body.locale === "en" ? "en_GB" : body.locale === "es" ? "es_ES" : "fr_FR";
      const results = body.type === "locale"
        ? await searchLocales(q, token, cfg.appSecret)
        : body.type === "detailed"
          ? await searchDetailed(q, locale, token, cfg.appSecret)
          : await searchInterests(q, locale, token, cfg.appSecret);
      return json({ ok: true, results }, 200, cors);
    }

    // ── Publicité : publications Instagram du compte relié (booster un post) ─
    if (action === "ads_ig_media") {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const { data: c } = await admin.from("meta_connections").select("id, ig_user_id, vault_secret_id").eq("id", (await findConnection(admin, scope))?.id ?? "").maybeSingle();
      const conn = c as { id: string; ig_user_id: string | null; vault_secret_id: string | null } | null;
      if (!conn?.vault_secret_id) return json({ error: "not_connected" }, 404, cors);
      if (!conn.ig_user_id) return json({ ok: true, results: [] }, 200, cors);
      const token = await tokenOf(admin, conn.id);
      if (!token) return json({ error: "token_missing" }, 500, cors);
      return json({ ok: true, results: await listInstagramMedia(conn.ig_user_id, token, cfg.appSecret) }, 200, cors);
    }

    if (action === "ads_reach_estimate") {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const { data: c } = await admin.from("meta_connections").select("id, ad_account_id, vault_secret_id").eq("id", (await findConnection(admin, scope))?.id ?? "").maybeSingle();
      const conn = c as { id: string; ad_account_id: string | null; vault_secret_id: string | null } | null;
      if (!conn?.vault_secret_id || !conn.ad_account_id) return json({ error: "no_ad_account" }, 404, cors);
      const token = await tokenOf(admin, conn.id);
      if (!token) return json({ error: "token_missing" }, 500, cors);
      const targeting = (body.targeting && typeof body.targeting === "object" ? body.targeting : {}) as CampaignTargeting;
      const placements = (body.placements && typeof body.placements === "object" ? body.placements : {}) as CampaignPlacements;
      // Les audiences Yuno sont converties en audiences Meta, comme à la création.
      const mapAud = async (ids: unknown): Promise<string[]> => {
        if (!Array.isArray(ids) || ids.length === 0) return [];
        const { data: rows } = await admin.from("meta_audiences").select("meta_audience_id, status").in("id", ids.filter((x) => typeof x === "string")).eq("connection_id", conn.id);
        return ((rows ?? []) as Array<{ meta_audience_id: string | null; status: string }>).filter((r) => r.meta_audience_id && r.status === "ready").map((r) => r.meta_audience_id!);
      };
      const est = await reachEstimate(conn.ad_account_id, {
        ...targeting, audience_ids: await mapAud(targeting.audience_ids), exclude_audience_ids: await mapAud(targeting.exclude_audience_ids),
      }, placements, token, cfg.appSecret);
      return json({ ok: true, estimate: est }, 200, cors);
    }

    // ── Publicité : campagnes ───────────────────────────────────────────────
    if (action === "campaign_create") {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const { data: c } = await admin.from("meta_connections").select("id, venue_id, organizer_user_id, pixel_id, ad_account_id, page_id, ig_user_id, status, mode, vault_secret_id")
        .eq("id", (await findConnection(admin, scope))?.id ?? "").maybeSingle();
      const conn = c as { id: string; venue_id: string | null; organizer_user_id: string | null; pixel_id: string; ad_account_id: string | null; page_id: string | null; ig_user_id: string | null; status: string; mode: string; vault_secret_id: string | null } | null;
      if (!conn?.vault_secret_id || conn.status !== "active") return json({ error: "not_connected" }, 404, cors);
      if (!conn.ad_account_id || !conn.page_id) return json({ error: "ads_not_ready" }, 400, cors);
      const token = await tokenOf(admin, conn.id);
      if (!token) return json({ error: "token_missing" }, 500, cors);

      const eventId = typeof body.eventId === "string" && /^[0-9a-f-]{36}$/i.test(body.eventId) ? body.eventId : null;
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
      const objective: CampaignObjective = body.objective === "OUTCOME_TRAFFIC" ? "OUTCOME_TRAFFIC" : body.objective === "OUTCOME_AWARENESS" ? "OUTCOME_AWARENESS" : "OUTCOME_SALES";
      const budgetType = body.budgetType === "daily" ? "daily" : "lifetime";
      const budgetCents = Math.round(Number(body.budgetCents));
      const startAt = typeof body.startAt === "string" ? new Date(body.startAt) : new Date();
      const endAt = typeof body.endAt === "string" ? new Date(body.endAt) : null;
      const targetingIn = (body.targeting && typeof body.targeting === "object" ? body.targeting : {}) as CampaignTargeting;
      const placements = parsePlacements(body.placements);
      const delivery = parseDelivery(body.delivery, objective);
      if (!eventId || !name || !Number.isFinite(budgetCents) || budgetCents < 500) return json({ error: "invalid_campaign" }, 400, cors);
      if (Number.isNaN(startAt.getTime()) || (endAt && (Number.isNaN(endAt.getTime()) || endAt <= startAt))) return json({ error: "invalid_dates" }, 400, cors);
      if (budgetType === "lifetime" && !endAt) return json({ error: "invalid_dates" }, 400, cors);
      if (placements.facebook === false && placements.instagram === false) return json({ error: "invalid_placements" }, 400, cors);
      if (delivery.schedule && delivery.schedule.length && budgetType !== "lifetime") return json({ error: "schedule_needs_lifetime" }, 400, cors);

      const isHttps = (u: unknown): u is string => typeof u === "string" && /^https:\/\/[^\s]+$/.test(u) && u.length <= 2000;
      const targeting = parseTargeting(targetingIn);
      if (!targeting) return json({ error: "invalid_targeting" }, 400, cors);

      // Créations : de une à six. `creatives[]` est la forme actuelle ; `creative`
      // (une image) reste acceptée pour les anciens appelants.
      const CTAS = ["BUY_TICKETS", "LEARN_MORE", "BOOK_NOW", "SIGN_UP", "GET_OFFER"];
      const rawCreatives: unknown[] = Array.isArray(body.creatives) ? body.creatives
        : (body.creative && typeof body.creative === "object" ? [{ format: "image", media: [{ kind: "image", url: (body.creative as { image_url?: string }).image_url }], ...(body.creative as object) }] : []);
      const creatives: Array<Omit<CampaignCreative, "link">> = [];
      for (const raw of rawCreatives.slice(0, 6)) {
        const cr = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        const format: CreativeFormat = cr.format === "carousel" ? "carousel" : cr.format === "video" ? "video" : cr.format === "instagram_post" ? "instagram_post" : "image";
        const mediaIn = Array.isArray(cr.media) ? cr.media : [];
        const media = mediaIn.map((m) => (m && typeof m === "object" ? m : {}) as Record<string, unknown>)
          .filter((m) => isHttps(m.url) || (m.kind === "ig_post" && /^[0-9]{5,40}$/.test(String(m.ig_media_id))))
          .map((m) => ({
            url: isHttps(m.url) ? m.url : "",
            kind: m.kind === "video" ? "video" as const : m.kind === "ig_post" ? "ig_post" as const : "image" as const,
            ig_media_id: m.kind === "ig_post" ? String(m.ig_media_id) : null,
            thumbnail_url: isHttps(m.thumbnail_url) ? m.thumbnail_url : null,
            headline: typeof m.headline === "string" && m.headline.trim() ? m.headline.trim().slice(0, 40) : null,
            description: typeof m.description === "string" && m.description.trim() ? m.description.trim().slice(0, 120) : null,
          }));
        const headline = String(cr.headline ?? "").trim().slice(0, 40);
        const bodyText = String(cr.body ?? "").trim().slice(0, 500);
        const description = typeof cr.description === "string" && cr.description.trim() ? cr.description.trim().slice(0, 120) : null;
        const cta = CTAS.includes(String(cr.cta)) ? String(cr.cta) : "LEARN_MORE";
        const images = media.filter((m) => m.kind === "image");
        const videos = media.filter((m) => m.kind === "video");
        const posts = media.filter((m) => m.kind === "ig_post");
        if (format === "instagram_post") {
          // Une publication existante porte déjà son visuel et son texte.
          if (posts.length < 1) return json({ error: "invalid_creative", detail: `creative_${creatives.length + 1}_post` }, 400, cors);
          creatives.push({ format, media: [posts[0]], headline: headline || "Instagram", body: bodyText || "—", cta, description });
          continue;
        }
        if (!headline || !bodyText) return json({ error: "invalid_creative", detail: `creative_${creatives.length + 1}_text` }, 400, cors);
        if (format === "image" && images.length < 1) return json({ error: "invalid_creative", detail: `creative_${creatives.length + 1}_image` }, 400, cors);
        if (format === "carousel" && (images.length < 2 || images.length > 10)) return json({ error: "invalid_creative", detail: `creative_${creatives.length + 1}_carousel` }, 400, cors);
        if (format === "video" && (videos.length < 1 || !videos[0].thumbnail_url)) return json({ error: "invalid_creative", detail: `creative_${creatives.length + 1}_video` }, 400, cors);
        creatives.push({
          format,
          media: format === "image" ? [images[0]] : format === "carousel" ? images.slice(0, 10) : [videos[0]],
          headline, body: bodyText, cta, description,
        });
      }
      if (creatives.length === 0) return json({ error: "invalid_creative" }, 400, cors);

      // La soirée doit appartenir à la portée.
      const { data: ev } = await admin.from("events").select("id, title, venue_id, partner_venue_id, organizer_user_id, partner_organizer_id").eq("id", eventId).maybeSingle();
      const e = ev as { id: string; title: string; venue_id: string | null; partner_venue_id: string | null; organizer_user_id: string | null; partner_organizer_id: string | null } | null;
      const inScope = !!e && ((conn.venue_id && (e.venue_id === conn.venue_id || e.partner_venue_id === conn.venue_id)) || (conn.organizer_user_id && (e.organizer_user_id === conn.organizer_user_id || e.partner_organizer_id === conn.organizer_user_id)));
      if (!inScope) return json({ error: "event_out_of_scope" }, 400, cors);

      // Audiences : ids Yuno → ids Meta, restreints à cette connexion.
      const mapAud = async (ids: string[]): Promise<string[]> => {
        if (ids.length === 0) return [];
        const { data: rows } = await admin.from("meta_audiences").select("id, meta_audience_id, status").in("id", ids).eq("connection_id", conn.id);
        return ((rows ?? []) as Array<{ meta_audience_id: string | null; status: string }>).filter((r) => r.meta_audience_id && r.status === "ready").map((r) => r.meta_audience_id!);
      };
      const metaTargeting: CampaignTargeting = {
        ...targeting,
        audience_ids: await mapAud(targeting.audience_ids ?? []),
        exclude_audience_ids: await mapAud(targeting.exclude_audience_ids ?? []),
      };

      const firstImage = (cr: Omit<CampaignCreative, "link">) => cr.media.find((m) => m.kind === "image")?.url ?? cr.media[0]?.thumbnail_url ?? cr.media[0]?.url ?? "";
      const legacyCreative = { image_url: firstImage(creatives[0]), headline: creatives[0].headline, body: creatives[0].body, cta: creatives[0].cta, description: creatives[0].description ?? null };
      const { data: inserted, error: insErr } = await admin.from("meta_campaigns").insert({
        connection_id: conn.id, venue_id: conn.venue_id, organizer_user_id: conn.organizer_user_id, event_id: eventId,
        name, objective, status: "creating", budget_type: budgetType, budget_cents: budgetCents,
        start_at: startAt.toISOString(), end_at: endAt ? endAt.toISOString() : null,
        targeting, creative: legacyCreative, creatives, placements, delivery, created_by: user.id,
      }).select("id").single();
      if (insErr || !inserted) return json({ error: "insert_failed", detail: insErr?.message ?? null }, 500, cors);
      const campaignRowId = inserted.id as string;

      const { data: code } = await admin.rpc("meta_ads_ensure_tracked_link", { p_campaign_id: campaignRowId });
      const link = typeof code === "string" && code ? `${ADS_PUBLIC_BASE}/l/${code}` : `${ADS_PUBLIC_BASE}/event/${eventId}`;

      let dsa = "";
      if (conn.venue_id) {
        const { data: v } = await admin.from("venues").select("legal_name, name").eq("id", conn.venue_id).maybeSingle();
        dsa = ((v as { legal_name: string | null; name: string } | null)?.legal_name || (v as { name: string } | null)?.name || "").trim();
      } else if (conn.organizer_user_id) {
        const { data: op } = await admin.from("organizer_profiles").select("display_name").eq("user_id", conn.organizer_user_id).maybeSingle();
        dsa = ((op as { display_name: string | null } | null)?.display_name || "").trim();
      }
      if (!dsa) dsa = "Yuno";
      const igActor = placements.instagram === false ? null : (conn.ig_user_id || await pageInstagramAccount(conn.page_id, token, cfg.appSecret));
      if (igActor && !conn.ig_user_id) await admin.from("meta_connections").update({ ig_user_id: igActor }).eq("id", conn.id);

      const result = await createFullCampaign({
        adAccountId: conn.ad_account_id, pageId: conn.page_id, instagramActorId: igActor, pixelId: conn.pixel_id,
        name, objective, budgetType, budgetCents, startAt: startAt.toISOString(), endAt: endAt ? endAt.toISOString() : null,
        targeting: metaTargeting,
        creatives: creatives.map((cr) => ({ ...cr, link })),
        placements, delivery, dsaBeneficiary: dsa, dsaPayor: dsa,
      }, token, cfg.appSecret);

      const patch: Record<string, unknown> = {
        meta_campaign_id: result.campaignId ?? null, meta_adset_id: result.adsetId ?? null,
        meta_creative_id: result.ads[0]?.creative_id ?? null, meta_ad_id: result.ads[0]?.ad_id ?? null,
        meta_ads: result.ads,
        creative: { ...legacyCreative, link },
        creatives: creatives.map((cr) => ({ ...cr, link })),
      };
      // Toujours en pause à la création : l'activation est un clic séparé et
      // confirmé du pro (`campaign_set_status`). Aucun chemin ne dépense sans lui.
      if (result.ok) {
        patch.status = "paused"; patch.last_error = null;
      } else {
        patch.status = "error"; patch.last_error = `${result.step ?? "?"}: ${result.error ?? "unknown"}`.slice(0, 500);
      }
      await admin.from("meta_campaigns").update(patch).eq("id", campaignRowId);
      return json({ ok: result.ok, campaignId: campaignRowId, status: patch.status, error: result.ok ? null : patch.last_error, step: result.ok ? null : (result.step ?? null) }, 200, cors);
    }

    // ── Publicité : modifier une campagne vivante (nom, budget, dates, ciblage, diffusion) ─
    if (action === "campaign_update") {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const { data: c } = await admin.from("meta_connections").select("id, pixel_id, vault_secret_id").eq("id", (await findConnection(admin, scope))?.id ?? "").maybeSingle();
      const conn = c as { id: string; pixel_id: string; vault_secret_id: string | null } | null;
      if (!conn?.vault_secret_id) return json({ error: "not_connected" }, 404, cors);
      const id = typeof body.campaignId === "string" ? body.campaignId : "";
      const { data: row } = await admin.from("meta_campaigns").select("id, name, objective, status, budget_type, budget_cents, start_at, end_at, targeting, placements, delivery, meta_campaign_id, meta_adset_id").eq("id", id).eq("connection_id", conn.id).maybeSingle();
      const camp = row as { id: string; name: string; objective: CampaignObjective; status: string; budget_type: string; budget_cents: number; start_at: string; end_at: string | null; targeting: CampaignTargeting; placements: CampaignPlacements; delivery: Delivery; meta_campaign_id: string | null; meta_adset_id: string | null } | null;
      if (!camp) return json({ error: "not_found" }, 404, cors);
      if (!camp.meta_campaign_id || !camp.meta_adset_id || !["paused", "active"].includes(camp.status)) return json({ error: "not_editable" }, 400, cors);
      const token = await tokenOf(admin, conn.id);
      if (!token) return json({ error: "token_missing" }, 500, cors);
      const patch: Record<string, unknown> = {};
      const adsetPatch: Record<string, unknown> = {};
      if (typeof body.name === "string" && body.name.trim().length >= 3) { patch.name = body.name.trim().slice(0, 120); }
      if (body.budgetCents != null) {
        const cents = Math.round(Number(body.budgetCents));
        if (!Number.isFinite(cents) || cents < 500) return json({ error: "invalid_campaign" }, 400, cors);
        patch.budget_cents = cents;
        adsetPatch[camp.budget_type === "daily" ? "daily_budget" : "lifetime_budget"] = cents;
      }
      const startAt = typeof body.startAt === "string" ? new Date(body.startAt) : null;
      const endAt = typeof body.endAt === "string" ? new Date(body.endAt) : (body.endAt === null ? null : undefined);
      if (startAt && !Number.isNaN(startAt.getTime())) { patch.start_at = startAt.toISOString(); adsetPatch.start_time = startAt.toISOString(); }
      if (endAt instanceof Date && !Number.isNaN(endAt.getTime())) { patch.end_at = endAt.toISOString(); adsetPatch.end_time = endAt.toISOString(); }
      const effStart = new Date((patch.start_at as string) ?? camp.start_at); const effEnd = patch.end_at ? new Date(patch.end_at as string) : (camp.end_at ? new Date(camp.end_at) : null);
      if (effEnd && effEnd <= effStart) return json({ error: "invalid_dates" }, 400, cors);
      let targeting = camp.targeting; let placements = camp.placements;
      if (body.targeting && typeof body.targeting === "object") {
        const parsed = parseTargeting(body.targeting as CampaignTargeting);
        if (!parsed) return json({ error: "invalid_targeting" }, 400, cors);
        targeting = parsed; patch.targeting = parsed;
      }
      if (body.placements && typeof body.placements === "object") { placements = parsePlacements(body.placements); patch.placements = placements; }
      if (body.targeting || body.placements) {
        const mapAud = async (ids: string[]): Promise<string[]> => {
          if (!ids.length) return [];
          const { data: rows } = await admin.from("meta_audiences").select("meta_audience_id, status").in("id", ids).eq("connection_id", conn.id);
          return ((rows ?? []) as Array<{ meta_audience_id: string | null; status: string }>).filter((r) => r.meta_audience_id && r.status === "ready").map((r) => r.meta_audience_id!);
        };
        adsetPatch.targeting = buildTargeting({ ...targeting, audience_ids: await mapAud(targeting.audience_ids ?? []), exclude_audience_ids: await mapAud(targeting.exclude_audience_ids ?? []) }, placements);
      }
      if (body.delivery && typeof body.delivery === "object") {
        const delivery = parseDelivery(body.delivery, camp.objective);
        patch.delivery = delivery;
        Object.assign(adsetPatch, deliveryParams(camp.objective, conn.pixel_id, delivery));
        const sched = scheduleParams(delivery);
        if (camp.budget_type === "lifetime") Object.assign(adsetPatch, sched ?? { pacing_type: ["standard"], adset_schedule: [] });
      }
      if (Object.keys(adsetPatch).length) {
        const r = await updateAdSet(camp.meta_adset_id, adsetPatch, token, cfg.appSecret);
        if (!r.ok) return json({ error: "meta_error", detail: r.error ?? null }, 502, cors);
      }
      if (patch.name) await graphPost(camp.meta_campaign_id, { name: patch.name }, token, cfg.appSecret);
      if (Object.keys(patch).length) await admin.from("meta_campaigns").update({ ...patch, last_error: null }).eq("id", camp.id);
      return json({ ok: true }, 200, cors);
    }

    // ── Publicité : mettre en pause / relancer UNE pub de la campagne ────────
    if (action === "ad_set_status") {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const existing = await findConnection(admin, scope);
      if (!existing?.vault_secret_id) return json({ error: "not_connected" }, 404, cors);
      const id = typeof body.campaignId === "string" ? body.campaignId : "";
      const adId = typeof body.adId === "string" ? body.adId : "";
      const { data: row } = await admin.from("meta_campaigns").select("id, meta_ads").eq("id", id).eq("connection_id", existing.id).maybeSingle();
      const camp = row as { id: string; meta_ads: Array<{ ad_id: string; effective_status?: string | null }> } | null;
      if (!camp || !Array.isArray(camp.meta_ads) || !camp.meta_ads.some((a) => a.ad_id === adId)) return json({ error: "not_found" }, 404, cors);
      const token = await tokenOf(admin, existing.id);
      if (!token) return json({ error: "token_missing" }, 500, cors);
      const wanted = body.status === "active" ? "ACTIVE" : "PAUSED";
      const r = await setAdStatus(adId, wanted, token, cfg.appSecret);
      if (!r.ok) return json({ error: "meta_error", detail: r.error ?? null }, 502, cors);
      await admin.from("meta_campaigns").update({ meta_ads: camp.meta_ads.map((a) => (a.ad_id === adId ? { ...a, effective_status: wanted } : a)) }).eq("id", camp.id);
      return json({ ok: true }, 200, cors);
    }

    if (action === "campaign_set_status" || action === "campaign_refresh" || action === "campaign_delete") {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const existing = await findConnection(admin, scope);
      if (!existing?.vault_secret_id) return json({ error: "not_connected" }, 404, cors);
      const id = typeof body.campaignId === "string" ? body.campaignId : "";
      const { data: row } = await admin.from("meta_campaigns").select("id, meta_campaign_id, meta_adset_id, meta_ad_id, meta_ads, status").eq("id", id).eq("connection_id", existing.id).maybeSingle();
      const camp = row as { id: string; meta_campaign_id: string | null; meta_adset_id: string | null; meta_ad_id: string | null; meta_ads: Array<{ ad_id: string }> | null; status: string } | null;
      if (!camp) return json({ error: "not_found" }, 404, cors);
      const token = await tokenOf(admin, existing.id);
      if (!token) return json({ error: "token_missing" }, 500, cors);
      if (action === "campaign_refresh") {
        await syncMetaInsights(admin, cfg.appSecret, { onlyCampaignId: camp.id, force: true });
        return json({ ok: true }, 200, cors);
      }
      if (action === "campaign_delete") {
        if (camp.meta_campaign_id) await setCampaignStatus({ campaignId: camp.meta_campaign_id }, "ARCHIVED", token, cfg.appSecret);
        await admin.from("meta_campaigns").delete().eq("id", camp.id);
        return json({ ok: true }, 200, cors);
      }
      const wanted = body.status === "active" ? "ACTIVE" : body.status === "archived" ? "ARCHIVED" : "PAUSED";
      if (!camp.meta_campaign_id) return json({ error: "not_on_meta" }, 400, cors);
      const adIds = Array.isArray(camp.meta_ads) && camp.meta_ads.length ? camp.meta_ads.map((a) => a.ad_id) : (camp.meta_ad_id ? [camp.meta_ad_id] : []);
      const r = await setCampaignStatus({ campaignId: camp.meta_campaign_id, adsetId: camp.meta_adset_id, adIds }, wanted, token, cfg.appSecret);
      if (!r.ok) {
        await admin.from("meta_campaigns").update({ last_error: r.error ?? null }).eq("id", camp.id);
        return json({ error: "meta_error", detail: r.error ?? null }, 502, cors);
      }
      await admin.from("meta_campaigns").update({ status: wanted === "ACTIVE" ? "active" : wanted === "ARCHIVED" ? "archived" : "paused", last_error: null }).eq("id", camp.id);
      return json({ ok: true }, 200, cors);
    }

    // ── Publicité : abonner la Page aux leads ───────────────────────────────
    if (action === "leads_subscribe") {
      if (!cfg) return json({ error: "oauth_not_configured" }, 503, cors);
      const { data: c } = await admin.from("meta_connections").select("id, page_id, vault_secret_id, last_health").eq("id", (await findConnection(admin, scope))?.id ?? "").maybeSingle();
      const conn = c as { id: string; page_id: string | null; vault_secret_id: string | null; last_health: Record<string, unknown> | null } | null;
      if (!conn?.vault_secret_id || !conn.page_id) return json({ error: "no_page" }, 404, cors);
      const token = await tokenOf(admin, conn.id);
      if (!token) return json({ error: "token_missing" }, 500, cors);
      const pageToken = await pageAccessToken(conn.page_id, token, cfg.appSecret);
      if (!pageToken) return json({ error: "page_token_missing" }, 502, cors);
      const r = await subscribePageToLeads(conn.page_id, pageToken, cfg.appSecret);
      if (!r.ok) return json({ error: "meta_error", detail: r.error ?? null }, 502, cors);
      await admin.from("meta_connections").update({ last_health: { ...(conn.last_health ?? {}), leads_subscribed_at: new Date().toISOString() } }).eq("id", conn.id);
      return json({ ok: true }, 200, cors);
    }

    // ── disconnect ──────────────────────────────────────────────────────────
    if (action === "disconnect") {
      const existing = await findConnection(admin, scope);
      if (!existing) return json({ ok: true }, 200, cors);
      // Connexion en un clic : on retire aussi l'autorisation côté Meta
      // (best-effort), pour que le pro ne voie plus Yuno dans ses apps.
      if (existing.mode === "oauth" && cfg) {
        const t = await tokenOf(admin, existing.id);
        if (t) await graphDelete("me/permissions", t, cfg.appSecret);
      }
      const { error } = await admin.from("meta_connections").delete().eq("id", existing.id);
      if (error) return json({ error: "delete_failed", detail: error.message }, 500, cors);
      return json({ ok: true }, 200, cors);
    }

    return json({ error: "unknown_action" }, 400, cors);
  } catch (e) {
    console.error("[meta-connect]", e);
    return json({ error: "internal", detail: e instanceof Error ? e.message : String(e) }, 500, cors);
  }
});
