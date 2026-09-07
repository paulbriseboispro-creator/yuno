// ───────────────────────────────────────────────────────────────────────────
// Envoi de campagne SMS — worker de file, pas boucle monolithique.
//
// Même architecture que send-campaign (email) :
//
//   • test    → un seul SMS vers le téléphone du pro, sans file. Consomme les
//               crédits réels (c'est le seul moyen honnête de tester la chaîne
//               Twilio de bout en bout).
//   • send    → constitue la file (enqueue), vérifie le solde POUR TOUTE LA
//               CAMPAGNE, puis draine une première tranche. Appelé par le pro
//               depuis l'app, ou par le cron pour une campagne planifiée.
//   • drain   → draine une tranche puis se ré-appelle. Appelé par lui-même et
//               par le cron (filet de sécurité si l'auto-chaînage se perd).
//   • resume  → une campagne en pause repart (crédits rechargés, pause levée).
//
// GARANTIES :
//   1. `claim_sms_campaign_recipients` (FOR UPDATE SKIP LOCKED) — deux workers
//      ne réservent jamais le même numéro.
//   2. Un crédit est débité AVANT l'appel Twilio et remboursé si Twilio refuse ;
//      un échec de livraison ultérieur (webhook) rembourse aussi.
//   3. Le solde est vérifié pour la campagne entière avant le premier envoi :
//      on ne démarre pas une campagne qu'on ne peut pas finir. Si malgré tout
//      le solde s'épuise en route (deux campagnes en parallèle), la campagne se
//      met en PAUSE et reprend après rechargement — rien n'est perdu.
//   4. Mention STOP + nom de l'annonceur ajoutés côté serveur, jamais retirables.
//   5. Heures calmes (20 h → 8 h Europe/Paris, dimanche) : opt-out par campagne,
//      le cron reprend au créneau suivant.
// ───────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { composeSmsBody, smsSizing, normalizeLang, cleanSenderName } from "../_shared/sms-text.ts";
import { isSupportSessionToken } from "../_shared/support-session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PUBLIC_URL = Deno.env.get("PUBLIC_APP_URL") || "https://yunoapp.eu";

const SLICE_MS = Number(Deno.env.get("SMS_SLICE_MS") || 40_000);
const BATCH = 20;          // numéros réservés par salve
const CONCURRENCY = 3;     // appels Twilio simultanés (un numéro long débite ~1 msg/s)
const SPACING_MS = 150;    // respiration entre deux vagues
const E164 = /^\+[1-9][0-9]{6,14}$/;

const QUIET_START_HOUR = 20;
const QUIET_END_HOUR = 8;

// deno-lint-ignore no-explicit-any
type Admin = any;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

// ── Twilio ─────────────────────────────────────────────────────────────────

interface TwilioConfig {
  sid: string;
  token: string;
  from: string | null;
  messagingServiceSid: string | null;
}

function twilioConfig(): TwilioConfig | null {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_PHONE_NUMBER") || null;
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") || null;
  if (!sid || !token || (!from && !messagingServiceSid)) return null;
  return { sid, token, from, messagingServiceSid };
}

type TwilioOutcome =
  | { ok: true; sid: string }
  | { ok: false; status: number; code: string; message: string; retryable: boolean; systemic: boolean };

// Codes Twilio qui condamnent TOUTE la campagne (pas seulement ce numéro) :
// identifiants, expéditeur invalide, compte d'essai. Insister brûlerait des
// crédits pour rien — on met la campagne en pause avec le message clair.
const SYSTEMIC_CODES = new Set(["20003", "20005", "20008", "21606", "21608", "21212", "21603", "30034"]);
// Codes transitoires : on remet le numéro en file.
const RETRYABLE_CODES = new Set(["20429", "21611", "30001", "30002", "30022"]);

async function sendTwilio(cfg: TwilioConfig, to: string, body: string, statusCallback: string): Promise<TwilioOutcome> {
  const params = new URLSearchParams({ To: to, Body: body, StatusCallback: statusCallback });
  if (cfg.messagingServiceSid) params.set("MessagingServiceSid", cfg.messagingServiceSid);
  else params.set("From", cfg.from!);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${cfg.sid}:${cfg.token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.sid) return { ok: true, sid: String(data.sid) };
    const code = String(data?.code ?? res.status);
    return {
      ok: false,
      status: res.status,
      code,
      message: String(data?.message ?? `Twilio HTTP ${res.status}`),
      retryable: res.status === 429 || res.status >= 500 || RETRYABLE_CODES.has(code),
      systemic: SYSTEMIC_CODES.has(code) || res.status === 401 || res.status === 403,
    };
  } catch (e) {
    return { ok: false, status: 0, code: "network", message: e instanceof Error ? e.message : String(e), retryable: true, systemic: false };
  }
}

// ── Utilitaires ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bearer(req: Request): string | null {
  const h = req.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

function inQuietHours(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    hour: "numeric", hour12: false, weekday: "short", timeZone: "Europe/Paris",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "12");
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR || weekday.startsWith("dim");
}

/** Auto-chaînage : la tranche suivante démarre sans attendre notre réponse. */
function chainNextSlice(campaignId: string) {
  const p = fetch(`${SUPABASE_URL}/functions/v1/send-sms-campaign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ campaign_id: campaignId, mode: "drain" }),
  }).catch((e) => console.error("chainNextSlice failed:", e instanceof Error ? e.message : e));
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}

async function balanceIdFor(admin: Admin, venueId: string | null, organizerId: string | null): Promise<string> {
  const { data, error } = await admin.rpc("get_or_create_sms_balance", {
    p_venue_id: venueId,
    p_organizer_id: organizerId,
  });
  if (error || !data) throw new Error(`Balance error: ${error?.message ?? "unknown"}`);
  return data as string;
}

async function currentBalance(admin: Admin, balanceId: string): Promise<number> {
  const { data } = await admin.from("sms_credit_balances").select("balance").eq("id", balanceId).single();
  return Number(data?.balance ?? 0);
}

/** Le pro connecté a-t-il la main sur cette portée ? (owner du club, organisateur, ou admin) */
async function userOwnsScope(admin: Admin, userId: string, venueId: string | null, organizerId: string | null): Promise<boolean> {
  if (organizerId && organizerId === userId) return true;
  if (venueId) {
    const { data: ok } = await admin.rpc("can_manage_venue", { _user_id: userId, _venue_id: venueId });
    if (ok === true) return true;
  }
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  return isAdmin === true;
}

async function ensureTrackedLink(admin: Admin, campaign: Record<string, unknown>): Promise<string | null> {
  if (!campaign.event_id) return null;
  if (campaign.tracked_link_id) {
    const { data } = await admin.from("tracked_links").select("code").eq("id", campaign.tracked_link_id).maybeSingle();
    if (data?.code) return `${PUBLIC_URL}/l/${data.code}`;
  }
  const { data, error } = await admin.rpc("ensure_sms_tracked_link", { p_event_id: campaign.event_id });
  if (error) { console.error("ensure_sms_tracked_link:", error.message); return null; }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.code) return null;
  await admin.from("sms_campaigns").update({ tracked_link_id: row.id }).eq("id", campaign.id);
  campaign.tracked_link_id = row.id;
  return `${PUBLIC_URL}/l/${row.code}`;
}

/** Corps final pour une langue donnée. */
function makeBodyResolver(campaign: Record<string, unknown>, linkUrl: string | null) {
  const i18n = (campaign.body_i18n as Record<string, string> | null) || null;
  const sender = cleanSenderName(campaign.sender_name as string);
  return (lang: string | null | undefined): string => {
    const l = normalizeLang(lang);
    const base = (i18n && i18n[l]) || (campaign.body_template as string) || "";
    return composeSmsBody(base, l, sender, linkUrl);
  };
}

/** Segments facturés par message, dans la pire des langues. */
function worstSegments(resolve: (lang: string) => string): number {
  return Math.max(1, ...["fr", "en", "es"].map((l) => smsSizing(resolve(l)).segments));
}

// ── Tranche d'envoi ────────────────────────────────────────────────────────

interface SliceResult {
  sent: number;
  failed: number;
  remaining: number;
  status: string;
  stopped: "done" | "deadline" | "paused" | "quiet" | "credits" | "error";
  detail?: string;
}

interface ClaimedRecipient { id: string; phone_e164: string; full_name: string | null; user_id: string | null; lang: string | null; attempts: number }

async function drainSlice(admin: Admin, campaign: Record<string, unknown>, cfg: TwilioConfig): Promise<SliceResult> {
  const campaignId = campaign.id as string;
  const venueId = (campaign.venue_id as string | null) ?? null;
  const organizerId = (campaign.organizer_id as string | null) ?? null;
  const balanceId = await balanceIdFor(admin, venueId, organizerId);
  const linkUrl = await ensureTrackedLink(admin, campaign);
  const bodyFor = makeBodyResolver(campaign, linkUrl);
  const statusCallback = `${SUPABASE_URL}/functions/v1/sms-twilio-status-webhook`;
  const deadline = Date.now() + SLICE_MS;

  let sent = 0;
  let failed = 0;
  let status = "sending";
  let stopped: SliceResult["stopped"] = "done";
  let detail: string | undefined;

  outer:
  while (true) {
    const { data: live } = await admin.from("sms_campaigns").select("status, paused_reason").eq("id", campaignId).single();
    status = (live?.status as string) || "sending";
    if (status !== "sending") { stopped = "paused"; detail = (live?.paused_reason as string) || status; break; }
    if (Date.now() >= deadline) { stopped = "deadline"; break; }
    if (campaign.quiet_hours === true && inQuietHours()) {
      stopped = "quiet";
      detail = `heures calmes ${QUIET_START_HOUR}h→${QUIET_END_HOUR}h Europe/Paris`;
      break;
    }

    const { data: claimed, error: cErr } = await admin.rpc("claim_sms_campaign_recipients", { p_campaign_id: campaignId, p_limit: BATCH });
    if (cErr) { stopped = "error"; detail = `claim: ${cErr.message}`; break; }
    const rows = (claimed || []) as ClaimedRecipient[];
    if (rows.length === 0) { stopped = "done"; break; }

    const okRows: Array<{ id: string; twilio_sid: string; sms_log_id: string; credits: number }> = [];
    const retryIds: string[] = [];
    const deadIds: Array<{ id: string; code: string; msg: string }> = [];
    // Objet (pas deux `let`) : TypeScript ne sait pas qu'une closure les
    // mute et rétrécirait le type à `never` après la boucle.
    const halt: { credits: boolean; systemic: { code: string; message: string } | null } = { credits: false, systemic: null };

    const handle = async (r: ClaimedRecipient) => {
      if (!E164.test(r.phone_e164)) { deadIds.push({ id: r.id, code: "invalid_phone", msg: "Numéro non E.164" }); return; }
      const text = bodyFor(r.lang);
      const credits = Math.max(1, smsSizing(text).segments);

      const { data: consumed, error: consErr } = await admin.rpc("consume_sms_credits", { p_balance_id: balanceId, p_amount: credits });
      if (consErr || consumed !== true) { halt.credits = true; retryIds.push(r.id); return; }

      const { data: log, error: logErr } = await admin.from("sms_logs").insert({
        venue_id: venueId, organizer_id: organizerId, target_user_id: r.user_id ?? null,
        to_phone: r.phone_e164, body: text, status: "queued", purpose: "campaign",
        campaign_id: campaignId, event_id: (campaign.event_id as string | null) ?? null, credits_consumed: credits,
      }).select("id").single();
      if (logErr || !log) {
        await admin.rpc("refund_sms_credits", { p_balance_id: balanceId, p_amount: credits, p_sms_log_id: null, p_notes: "log insert failed" });
        deadIds.push({ id: r.id, code: "log_error", msg: logErr?.message ?? "log insert failed" });
        return;
      }

      const out = await sendTwilio(cfg, r.phone_e164, text, statusCallback);
      if (out.ok) {
        await admin.from("sms_logs").update({ twilio_sid: out.sid, status: "sent", sent_at: new Date().toISOString() }).eq("id", log.id);
        okRows.push({ id: r.id, twilio_sid: out.sid, sms_log_id: log.id, credits });
        return;
      }
      await admin.from("sms_logs").update({ status: "failed", error_code: out.code, error_message: out.message.slice(0, 500) }).eq("id", log.id);
      await admin.rpc("refund_sms_credits", { p_balance_id: balanceId, p_amount: credits, p_sms_log_id: log.id, p_notes: `Twilio ${out.code}` });
      if (out.systemic) { halt.systemic = { code: out.code, message: out.message }; retryIds.push(r.id); return; }
      if (out.retryable) retryIds.push(r.id);
      else deadIds.push({ id: r.id, code: out.code, msg: out.message });
    };

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      await Promise.all(rows.slice(i, i + CONCURRENCY).map(handle));
      if (halt.credits || halt.systemic) {
        // Les numéros pas encore traités de cette salve retournent en file.
        for (const r of rows.slice(i + CONCURRENCY)) retryIds.push(r.id);
        break;
      }
      await sleep(SPACING_MS);
    }

    if (okRows.length) {
      const { error } = await admin.rpc("mark_sms_campaign_recipients_sent", { p_campaign_id: campaignId, p_rows: okRows });
      if (error) console.error("mark sent failed:", error.message);
      sent += okRows.length;
    }
    if (retryIds.length) {
      await admin.rpc("mark_sms_campaign_recipients_failed", {
        p_campaign_id: campaignId, p_ids: retryIds, p_error: halt.systemic ? `Twilio ${halt.systemic.code}: ${halt.systemic.message}` : (halt.credits ? "Crédits épuisés" : "Refus transitoire"),
        p_error_code: halt.systemic?.code ?? (halt.credits ? "credits" : "retry"),
        p_retry_at: new Date(Date.now() + 120_000).toISOString(),
        // Une pause (crédits / configuration) ne doit pas compter comme tentative :
        // on relève le plafond pour que ces lignes repartent en 'pending'.
        p_max_attempts: (halt.systemic || halt.credits) ? 1_000 : 3,
      });
    }
    if (deadIds.length) {
      // Regroupés par code pour garder un message d'erreur lisible.
      const byCode = new Map<string, { ids: string[]; msg: string }>();
      for (const d of deadIds) {
        const e = byCode.get(d.code) ?? { ids: [], msg: d.msg };
        e.ids.push(d.id); byCode.set(d.code, e);
      }
      for (const [code, e] of byCode) {
        await admin.rpc("mark_sms_campaign_recipients_failed", {
          p_campaign_id: campaignId, p_ids: e.ids, p_error: e.msg, p_error_code: code, p_retry_at: null, p_max_attempts: 3,
        });
      }
      failed += deadIds.length;
    }

    if (halt.credits) {
      await admin.from("sms_campaigns").update({ status: "paused", paused_reason: "credits", error_message: "Crédits SMS épuisés en cours d'envoi — rechargez puis reprenez." })
        .eq("id", campaignId).eq("status", "sending");
      status = "paused"; stopped = "credits"; break outer;
    }
    if (halt.systemic) {
      const s = halt.systemic;
      await admin.from("sms_campaigns").update({ status: "paused", paused_reason: "send_error", error_message: `Twilio ${s.code}: ${s.message}`.slice(0, 500) })
        .eq("id", campaignId).eq("status", "sending");
      status = "paused"; stopped = "error"; detail = s.message; break outer;
    }
  }

  // ── Clôture ───────────────────────────────────────────────────────────────
  const { count: remaining } = await admin
    .from("sms_campaign_recipients").select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId).in("status", ["pending", "sending"]);
  const left = remaining ?? 0;

  if (left === 0 && status === "sending") {
    const { data: totals } = await admin.from("sms_campaigns").select("sent_count").eq("id", campaignId).single();
    const okCount = Number(totals?.sent_count || 0);
    await admin.from("sms_campaigns").update({
      status: okCount > 0 ? "sent" : "failed",
      sent_at: new Date().toISOString(),
      error_message: okCount > 0 ? null : "Aucun envoi n'a abouti",
    }).eq("id", campaignId);
    status = okCount > 0 ? "sent" : "failed";
  } else if (left > 0 && status === "sending" && stopped === "deadline") {
    chainNextSlice(campaignId);
  }

  return { sent, failed, remaining: left, status, stopped, detail };
}

// ── Test : un SMS vers le pro ──────────────────────────────────────────────

interface TestPayload {
  venue_id?: string | null;
  organizer_user_id?: string | null;
  body: string;
  body_i18n?: Record<string, string> | null;
  sender_name?: string | null;
  event_id?: string | null;
  test_phone?: string | null;
  lang?: string | null;
}

async function sendTest(admin: Admin, userId: string, p: TestPayload, cfg: TwilioConfig) {
  const venueId = p.venue_id || null;
  const organizerId = venueId ? null : (p.organizer_user_id || null);
  if (!venueId && !organizerId) return json({ error: "scope required" }, 400);
  if (!(await userOwnsScope(admin, userId, venueId, organizerId))) return json({ error: "Forbidden" }, 403);

  const { data: prof } = await admin.from("profiles").select("phone, preferred_language").eq("id", userId).maybeSingle();
  const raw = (p.test_phone || prof?.phone || "").trim();
  const phone = raw.startsWith("+") ? "+" + raw.replace(/[^0-9]/g, "") : raw.replace(/[^0-9]/g, "");
  if (!E164.test(phone)) return json({ error: "TEST_PHONE_INVALID" }, 400);

  const lang = normalizeLang(p.lang || prof?.preferred_language);
  let link: string | null = null;
  if (p.event_id) {
    const { data } = await admin.rpc("ensure_sms_tracked_link", { p_event_id: p.event_id });
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.code) link = `${PUBLIC_URL}/l/${row.code}`;
  }
  const base = (p.body_i18n && p.body_i18n[lang]) || p.body;
  const text = composeSmsBody(base, lang, cleanSenderName(p.sender_name), link);
  const credits = Math.max(1, smsSizing(text).segments);

  const balanceId = await balanceIdFor(admin, venueId, organizerId);
  const { data: consumed } = await admin.rpc("consume_sms_credits", { p_balance_id: balanceId, p_amount: credits });
  if (consumed !== true) return json({ error: "INSUFFICIENT_CREDITS", needed: credits, balance: await currentBalance(admin, balanceId) }, 402);

  const { data: log } = await admin.from("sms_logs").insert({
    venue_id: venueId, organizer_id: organizerId, target_user_id: userId, to_phone: phone, body: text,
    status: "queued", purpose: "manual", event_id: p.event_id ?? null, credits_consumed: credits,
  }).select("id").single();

  const out = await sendTwilio(cfg, phone, text, `${SUPABASE_URL}/functions/v1/sms-twilio-status-webhook`);
  if (!out.ok) {
    if (log) await admin.from("sms_logs").update({ status: "failed", error_code: out.code, error_message: out.message.slice(0, 500) }).eq("id", log.id);
    await admin.rpc("refund_sms_credits", { p_balance_id: balanceId, p_amount: credits, p_sms_log_id: log?.id ?? null, p_notes: `Test refusé: Twilio ${out.code}` });
    return json({ error: "TWILIO_ERROR", code: out.code, message: out.message }, 502);
  }
  if (log) await admin.from("sms_logs").update({ twilio_sid: out.sid, status: "sent", sent_at: new Date().toISOString() }).eq("id", log.id);
  return json({ success: true, test: true, sid: out.sid, to: phone, body: text, credits });
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const payload = await req.json().catch(() => ({}));
    const mode: string = payload.mode || "send";
    const campaignId: string | undefined = payload.campaign_id;
    const scheduled = payload.scheduled === true;

    const token = bearer(req);
    const internal = !!token && token === SERVICE_KEY;
    const wantsInternal = mode === "drain" || scheduled;
    if (wantsInternal && !internal) return json({ error: "Unauthorized" }, 401);

    let actingUserId: string | null = null;
    if (!internal) {
      if (!token) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data: userData } = await userClient.auth.getUser();
      if (!userData?.user) return json({ error: "Unauthorized" }, 401);
      actingUserId = userData.user.id;
    }

    const cfg = twilioConfig();

    // ── Test ────────────────────────────────────────────────────────────────
    if (mode === "test") {
      if (!actingUserId) return json({ error: "Unauthorized" }, 401);
      if (!cfg) return json({ error: "SMS_NOT_CONFIGURED" }, 503);
      return await sendTest(admin, actingUserId, payload as TestPayload, cfg);
    }

    if (!campaignId) return json({ error: "campaign_id required" }, 400);
    const { data: campaign, error: cErr } = await admin.from("sms_campaigns").select("*").eq("id", campaignId).single();
    if (cErr || !campaign) return json({ error: "Campaign not found" }, 404);

    if (actingUserId && !(await userOwnsScope(admin, actingUserId, campaign.venue_id, campaign.organizer_id))) {
      return json({ error: "Forbidden" }, 403);
    }
    if (!cfg) return json({ error: "SMS_NOT_CONFIGURED" }, 503);

    // ── Reprise après pause ─────────────────────────────────────────────────
    if (mode === "resume") {
      if (campaign.status !== "paused") return json({ error: `Campagne ${campaign.status}, pas en pause` }, 409);
      if (campaign.paused_reason === "credits") {
        // Ne pas repartir pour se re-bloquer trois numéros plus loin.
        const balanceId = await balanceIdFor(admin, campaign.venue_id, campaign.organizer_id);
        const { count } = await admin.from("sms_campaign_recipients").select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId).in("status", ["pending", "sending"]);
        const needed = Number(count || 0) * Number(campaign.segments_per_message || 1);
        const balance = await currentBalance(admin, balanceId);
        if (balance < needed) return json({ error: "INSUFFICIENT_CREDITS", needed, balance, missing: needed - balance }, 402);
      }
      await admin.from("sms_campaigns").update({ status: "sending", paused_reason: null, error_message: null }).eq("id", campaignId);
      campaign.status = "sending";
      const slice = await drainSlice(admin, campaign, cfg);
      return json({ success: true, ...slice });
    }

    // ── Constitution de la file (mode 'send') ───────────────────────────────
    if (mode !== "drain") {
      if (token && !internal && await isSupportSessionToken(admin as unknown as Parameters<typeof isSupportSessionToken>[0], token)) {
        return json({ error: "support_session_forbidden" }, 403);
      }
      if (!["draft", "scheduled", "failed"].includes(campaign.status)) {
        return json({ error: `Campagne déjà ${campaign.status}` }, 409);
      }

      // Coût par message : pire langue, avec un lien de la taille réelle.
      const sampleLink = campaign.event_id ? `${PUBLIC_URL}/l/XXXXXXXX` : null;
      const segments = worstSegments(makeBodyResolver(campaign, sampleLink));

      const { data: enq, error: eErr } = await admin.rpc("enqueue_sms_campaign_recipients", { p_campaign_id: campaignId });
      if (eErr) throw new Error(`Audience resolution failed: ${eErr.message}`);
      const pending = Number(enq?.pending || 0);
      if (pending <= 0) {
        await admin.from("sms_campaigns").update({ status: "failed", error_message: "Aucun destinataire consentant pour cette audience" }).eq("id", campaignId);
        return json({ error: "NO_RECIPIENTS", detail: enq }, 400);
      }

      const balanceId = await balanceIdFor(admin, campaign.venue_id, campaign.organizer_id);
      const balance = await currentBalance(admin, balanceId);
      const needed = pending * segments;
      if (balance < needed) {
        await admin.from("sms_campaigns").update({
          status: "draft", segments_per_message: segments,
          error_message: `Crédits insuffisants : ${needed} nécessaires, ${balance} disponibles`,
        }).eq("id", campaignId);
        return json({ error: "INSUFFICIENT_CREDITS", needed, balance, missing: needed - balance, recipients: pending, segments }, 402);
      }

      await admin.from("sms_campaigns").update({
        status: "sending",
        segments_per_message: segments,
        sender_name: cleanSenderName(campaign.sender_name) || null,
        send_started_at: new Date().toISOString(),
        paused_reason: null,
        error_message: null,
      }).eq("id", campaignId);
      campaign.status = "sending";
      campaign.segments_per_message = segments;

      const slice = await drainSlice(admin, campaign, cfg);
      return json({ success: true, queued: enq, segments, ...slice });
    }

    // ── Tranche suivante (mode 'drain') ─────────────────────────────────────
    if (campaign.status !== "sending") return json({ success: true, skipped: campaign.status });
    const slice = await drainSlice(admin, campaign, cfg);
    return json({ success: true, ...slice });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[send-sms-campaign]", msg);
    return json({ error: msg }, 500);
  }
});
