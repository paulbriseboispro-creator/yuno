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
//   select_assets { scope, pixelId, adAccountId?, pageId? }
//   health        { scope }                          debug_token + qualité dataset
//   save          { scope, pixelId, token?, testEventCode? }
//   test          { scope, testEventCode }
//   update        { scope, eventsEnabled?, clearTestCode? }
//   disconnect    { scope }
// Sans JWT (appelées par Meta) :
//   GET  /oauth/callback?code&state
//   POST /data-deletion   (signed_request)  → efface les connexions de ce compte Meta
//   POST /deauthorize     (signed_request)  → idem (l'app a été retirée côté Meta)
//
// `scope` = { venueId } | { organizerUserId } | {} (plateforme, super admin).
// Surface identité/argent : refusée en session support (accès assisté).

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { isSupportSessionToken } from "../_shared/support-session.ts";
import { checkMetaToken, sendMetaTestEvent } from "../_shared/meta-capi.ts";
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
  let q = admin.from("meta_connections").select("id, mode, pixel_id, vault_secret_id, test_event_code, test_event_code_expires_at, status, token_kind, assets, meta_user_id");
  q = scope.venueId ? q.eq("venue_id", scope.venueId) : q.is("venue_id", null);
  q = scope.organizerUserId ? q.eq("organizer_user_id", scope.organizerUserId) : q.is("organizer_user_id", null);
  const { data } = await q.maybeSingle();
  return (data ?? null) as ConnRow | null;
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

      const single = disc.assets.pixels.length === 1 ? disc.assets.pixels[0] : null;
      const existing = await findConnection(admin, scope);
      const base = {
        mode: "oauth" as const,
        token_kind: disc.kind,
        meta_user_id: disc.metaUserId,
        business_id: disc.businessId,
        assets: disc.assets,
        token_expires_at: expiresAt,
        ad_account_id: disc.assets.ad_accounts[0]?.id ?? null,
        page_id: disc.assets.pages[0]?.id ?? null,
        created_by: state.userId,
      };
      let connectionId = existing?.id ?? null;
      if (!connectionId) {
        const { data: ins, error } = await admin.from("meta_connections").insert({
          venue_id: scope.venueId, organizer_user_id: scope.organizerUserId,
          pixel_id: single?.id ?? "pending", ...base,
        }).select("id").single();
        if (error || !ins) return back(returnTo, `meta=error&reason=${encodeURIComponent(error?.message ?? "insert_failed")}`);
        connectionId = ins.id as string;
      } else {
        const { error } = await admin.from("meta_connections").update({
          pixel_id: single?.id ?? (PIXEL_RE.test(existing!.pixel_id) && disc.assets.pixels.some((p) => p.id === existing!.pixel_id) ? existing!.pixel_id : "pending"),
          verified_at: null, ...base,
        }).eq("id", connectionId);
        if (error) return back(returnTo, `meta=error&reason=${encodeURIComponent(error.message)}`);
      }
      const { error: storeErr } = await admin.rpc("store_meta_capi_token", { p_connection_id: connectionId, p_token: token });
      if (storeErr) return back(returnTo, `meta=error&reason=${encodeURIComponent(storeErr.message)}`);
      // store_* remet status=active : on repasse en attente si le pixel n'est pas choisi.
      const { data: after } = await admin.from("meta_connections").select("pixel_id").eq("id", connectionId).single();
      const pixelChosen = !!after && PIXEL_RE.test(String(after.pixel_id));
      await admin.from("meta_connections").update({ status: pixelChosen ? "active" : "pending_assets" }).eq("id", connectionId);
      return back(returnTo, pixelChosen ? "meta=connected" : "meta=choose");
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
      if (!existing || existing.mode !== "oauth" || !existing.assets) return json({ error: "not_connected" }, 404, cors);
      const pixelId = typeof body.pixelId === "string" ? body.pixelId.trim() : "";
      if (!existing.assets.pixels.some((p) => p.id === pixelId)) return json({ error: "invalid_pixel_id" }, 400, cors);
      const adAccountId = typeof body.adAccountId === "string" && existing.assets.ad_accounts.some((a) => a.id === body.adAccountId) ? body.adAccountId : undefined;
      const pageId = typeof body.pageId === "string" && existing.assets.pages.some((p) => p.id === body.pageId) ? body.pageId : undefined;
      const { error } = await admin.from("meta_connections").update({
        pixel_id: pixelId, status: "active", verified_at: null, last_error: null, last_error_at: null,
        ...(adAccountId ? { ad_account_id: adAccountId } : {}),
        ...(pageId ? { page_id: pageId } : {}),
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
      } else {
        health.note = "oauth_not_configured";
      }
      await admin.from("meta_connections").update({ last_health: health, last_health_at: new Date().toISOString() }).eq("id", existing.id);
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

      let connectionId = existing?.id ?? null;
      if (!connectionId) {
        const { data: inserted, error: insErr } = await admin
          .from("meta_connections")
          .insert({ venue_id: scope.venueId, organizer_user_id: scope.organizerUserId, mode: "manual", token_kind: "capi", pixel_id: pixelId, created_by: user.id })
          .select("id")
          .single();
        if (insErr || !inserted) return json({ error: "insert_failed", detail: insErr?.message ?? null }, 500, cors);
        connectionId = inserted.id as string;
      } else {
        const patch: Record<string, unknown> = { pixel_id: pixelId, mode: "manual", token_kind: "capi", token_expires_at: null, assets: null, meta_user_id: null };
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
      return json({ ok: true, connectionId, datasetName: datasetName ?? null, test }, 200, cors);
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
