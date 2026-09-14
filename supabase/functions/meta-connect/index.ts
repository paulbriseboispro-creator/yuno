// Meta (Facebook / Instagram) — connexion d'un club, d'un organisateur ou de la
// plateforme au Pixel + Conversions API. Phase 1 : mode MANUEL (le pro colle
// son identifiant de pixel et un jeton généré dans Events Manager).
// Design : docs/designs/META_ADS_INTEGRATION_PLAN.md.
//
// Actions (POST JSON, JWT obligatoire) :
//   save        { scope, pixelId, token?, testEventCode? }  crée/met à jour
//   test        { scope, testEventCode }                    envoie un Purchase de test
//   update      { scope, eventsEnabled?, testEventCode? }   interrupteurs
//   disconnect  { scope }                                   supprime tout (jeton compris)
// `scope` = { venueId } | { organizerUserId } | {} (plateforme, super admin).
//
// Le jeton ne ressort JAMAIS de cette fonction : il entre dans le Vault via
// store_meta_capi_token et n'en sort que pour le drainer (service_role).
// Surface identité/argent : refusée en session support (accès assisté).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { isSupportSessionToken } from "../_shared/support-session.ts";
import { checkMetaToken, sendMetaTestEvent } from "../_shared/meta-capi.ts";

const PIXEL_RE = /^[0-9]{6,32}$/;
const TEST_CODE_RE = /^[A-Za-z0-9_-]{4,40}$/;
const TEST_CODE_TTL_MS = 7 * 24 * 3600 * 1000;

type Scope = { venueId: string | null; organizerUserId: string | null };

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

function parseScope(raw: unknown): Scope | null {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const venueId = typeof s.venueId === "string" && s.venueId.trim() ? s.venueId.trim() : null;
  const organizerUserId = typeof s.organizerUserId === "string" && /^[0-9a-f-]{36}$/i.test(s.organizerUserId) ? s.organizerUserId : null;
  if (venueId && organizerUserId) return null;
  return { venueId, organizerUserId };
}

Deno.serve(async (req) => {
  const cors = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

  try {
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

    // Droit sur la portée : owner du club / l'organisateur lui-même / super
    // admin (seul autorisé sur la portée plateforme). Évalué sous le JWT du
    // demandeur, comme les RPC de lecture.
    const { data: allowed, error: allowErr } = await userClient.rpc("meta_scope_allowed", {
      p_venue_id: scope.venueId,
      p_organizer_user_id: scope.organizerUserId,
    });
    if (allowErr || allowed !== true) return json({ error: "forbidden" }, 403, cors);

    const findExisting = async () => {
      let q = admin.from("meta_connections").select("id, pixel_id, vault_secret_id, test_event_code, test_event_code_expires_at, status");
      q = scope.venueId ? q.eq("venue_id", scope.venueId) : q.is("venue_id", null);
      q = scope.organizerUserId ? q.eq("organizer_user_id", scope.organizerUserId) : q.is("organizer_user_id", null);
      const { data } = await q.maybeSingle();
      return data as { id: string; pixel_id: string; vault_secret_id: string | null; test_event_code: string | null; test_event_code_expires_at: string | null; status: string } | null;
    };

    const sourceUrl = "https://yunoapp.eu/";

    // ── save ────────────────────────────────────────────────────────────────
    if (action === "save") {
      const pixelId = typeof body.pixelId === "string" ? body.pixelId.trim() : "";
      if (!PIXEL_RE.test(pixelId)) return json({ error: "invalid_pixel_id" }, 400, cors);
      const token = typeof body.token === "string" ? body.token.trim() : "";
      const testEventCode = typeof body.testEventCode === "string" ? body.testEventCode.trim() : "";
      if (testEventCode && !TEST_CODE_RE.test(testEventCode)) return json({ error: "invalid_test_code" }, 400, cors);

      const existing = await findExisting();
      if (!token && !existing?.vault_secret_id) return json({ error: "token_required" }, 400, cors);
      if (token && (token.length < 20 || token.length > 600 || /\s/.test(token))) return json({ error: "invalid_token" }, 400, cors);

      // Refus immédiat d'un jeton que Meta déclare invalide (code 190). Un
      // jeton qui ne peut pas LIRE le dataset mais pourrait écrire passe : la
      // vérité viendra du premier événement (verified_at).
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
          .insert({
            venue_id: scope.venueId,
            organizer_user_id: scope.organizerUserId,
            mode: "manual",
            pixel_id: pixelId,
            created_by: user.id,
          })
          .select("id")
          .single();
        if (insErr || !inserted) return json({ error: "insert_failed", detail: insErr?.message ?? null }, 500, cors);
        connectionId = inserted.id as string;
      } else {
        const patch: Record<string, unknown> = { pixel_id: pixelId };
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
        const { data: t } = await admin.rpc("get_meta_capi_token", { p_connection_id: connectionId });
        if (typeof t === "string" && t) test = await sendMetaTestEvent(pixelId, t, testEventCode, sourceUrl);
      }
      return json({ ok: true, connectionId, datasetName: datasetName ?? null, test }, 200, cors);
    }

    // ── test ────────────────────────────────────────────────────────────────
    if (action === "test") {
      const existing = await findExisting();
      if (!existing?.vault_secret_id) return json({ error: "not_connected" }, 404, cors);
      const testEventCode = typeof body.testEventCode === "string" ? body.testEventCode.trim() : "";
      if (!TEST_CODE_RE.test(testEventCode)) return json({ error: "invalid_test_code" }, 400, cors);
      await admin.from("meta_connections").update({
        test_event_code: testEventCode,
        test_event_code_expires_at: new Date(Date.now() + TEST_CODE_TTL_MS).toISOString(),
      }).eq("id", existing.id);
      const { data: t } = await admin.rpc("get_meta_capi_token", { p_connection_id: existing.id });
      if (typeof t !== "string" || !t) return json({ error: "token_missing" }, 500, cors);
      const result = await sendMetaTestEvent(existing.pixel_id, t, testEventCode, sourceUrl);
      if (result.ok) {
        await admin.from("meta_connections").update({ last_ok_at: new Date().toISOString(), last_error: null, last_error_at: null, status: "active" }).eq("id", existing.id);
      } else if (result.code === 190) {
        await admin.from("meta_connections").update({ status: "token_invalid", last_error: result.message ?? "190", last_error_at: new Date().toISOString() }).eq("id", existing.id);
      }
      return json({ ok: result.ok, test: result }, 200, cors);
    }

    // ── update (interrupteurs, fin du mode test) ────────────────────────────
    if (action === "update") {
      const existing = await findExisting();
      if (!existing) return json({ error: "not_connected" }, 404, cors);
      const patch: Record<string, unknown> = {};
      if (body.eventsEnabled && typeof body.eventsEnabled === "object") {
        const src = body.eventsEnabled as Record<string, unknown>;
        const keys = ["pixel", "view_content", "initiate_checkout", "purchase", "lead"];
        const next: Record<string, boolean> = {};
        for (const k of keys) next[k] = src[k] !== false;
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
      const existing = await findExisting();
      if (!existing) return json({ ok: true }, 200, cors);
      // Le trigger AFTER DELETE détruit le secret Vault ; la file part en cascade.
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
