// ───────────────────────────────────────────────────────────────────────────
// Envoi de campagne SMS — worker de file, pas boucle monolithique.
// Fournisseur : Octopush (depuis le 2026-10-08, docs/designs/SMS_PROVIDER_PLAN.md).
//
// Même architecture que send-campaign (email) :
//
//   • test    → un SMS vers le pro, sans file. Suite : consomme ses crédits
//               SMS. Console CRM : gratuit (10 par jour et par compte).
//   • send    → constitue la file (enqueue), vérifie le solde POUR TOUTE LA
//               CAMPAGNE, puis draine une première tranche. Appelé par le pro
//               depuis l'app, ou par le cron pour une campagne planifiée.
//   • drain   → draine une tranche puis se ré-appelle. Appelé par lui-même et
//               par le cron (filet de sécurité si l'auto-chaînage se perd).
//   • resume  → une campagne en pause repart (crédits rechargés, pause levée).
//
// Deux portefeuilles, une mécanique : les crédits SMS de la Suite
// (`sms_credit_balances`) ou les Yunits de la Console CRM (35 par SMS en
// France, 70 vers l'étranger : `crm_sms_rates()`, zone lue sur le numéro).
// La plateforme (Yuno à sa base) ne débite rien.
//
// GARANTIES :
//   1. `claim_sms_campaign_recipients` (FOR UPDATE SKIP LOCKED) — deux workers
//      ne réservent jamais le même numéro.
//   2. Un lot porte un `request_id` posé AVANT l'appel : une ligne reprise
//      repart avec le même, Octopush répond « déjà vu » (182) et rien ne part
//      deux fois.
//   3. Le débit précède l'appel ; un refus du fournisseur rembourse le lot.
//      Un échec de livraison ultérieur (`failed`, webhook) rembourse aussi ;
//      un « non délivré » a été facturé et reste décompté.
//   4. Le solde est vérifié pour la campagne entière avant le premier envoi.
//      S'il s'épuise en route, la campagne se met en PAUSE et reprend après
//      rechargement — rien n'est perdu.
//   5. Nom de l'annonceur en tête, « STOP au 30101 », nom d'expéditeur aux
//      règles des opérateurs, identité de l'annonceur vérifiée : côté serveur,
//      jamais retirables.
//   6. Rien ne part de 21 h 30 à 8 h (Paris) ; heures calmes, dimanche et jours
//      fériés selon les réglages. Le cron reprend au créneau suivant.
// ───────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  composeSmsBody, isFrenchNumber, normalizeLang, resolveSmsVars, senderIdError, smsHoldReason, smsSizing, smsTariffZone, toSenderId,
  cleanSenderName, type SmsQuietRules, type SmsTariffZone,
} from "../_shared/sms-text.ts";
import {
  batchRequestId, OCTOPUSH_BATCH, octopushConfig, octopushErrorLabel, sendOctopushBatch, type OctopushConfig,
} from "../_shared/sms-octopush.ts";
import { isSupportSessionToken } from "../_shared/support-session.ts";
import { demoPreviewGuard, isDemoMarketingScope } from "../_shared/demo-guard.ts";

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
/** Lien court affiché dans un SMS CRM, sans « https:// » (la longueur compte). */
const SHORT_HOST = PUBLIC_URL.replace(/^https?:\/\//, "").replace(/\/+$/, "");

const SLICE_MS = Number(Deno.env.get("SMS_SLICE_MS") || 40_000);
const E164 = /^\+[1-9][0-9]{6,14}$/;
/** Tests gratuits d'un compte CRM par 24 h. */
const CRM_FREE_TESTS_PER_DAY = 10;
/** Prénom d'exemple d'un test (celui du compte s'il est connu). */
const SAMPLE_FIRST_NAME = "Camille";

type Admin = SupabaseClient;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bearer(req: Request): string | null {
  const h = req.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
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

function errorText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

// ── Portée, portefeuille, réglages ─────────────────────────────────────────

interface Scope {
  venueId: string | null;
  organizerId: string | null;
  /** Clé CRM de la portée (`venue:<id>` / `org:<uuid>`), null pour la plateforme. */
  scopeKey: string | null;
  platform: boolean;
  /** SMS de la Console CRM : Yunits, variables, réglages d'envoi du compte. */
  crm: boolean;
  /** Nom du club ou de l'organisation (variable {{nom_club}}, expéditeur par défaut). */
  name: string;
}

async function loadScope(admin: Admin, venueId: string | null, organizerId: string | null, crm: boolean): Promise<Scope> {
  const platform = !venueId && !organizerId;
  let name = "Yuno";
  if (venueId) {
    const { data } = await admin.from("venues").select("name").eq("id", venueId).maybeSingle();
    name = (data?.name as string) || name;
  } else if (organizerId) {
    const [{ data: op }, { data: pr }] = await Promise.all([
      admin.from("organizer_profiles").select("display_name").eq("user_id", organizerId).maybeSingle(),
      admin.from("profiles").select("organization_name").eq("id", organizerId).maybeSingle(),
    ]);
    name = (op?.display_name as string) || (pr?.organization_name as string) || "Organisation";
  }
  return {
    venueId, organizerId, platform, crm: crm && !platform, name,
    scopeKey: venueId ? `venue:${venueId}` : organizerId ? `org:${organizerId}` : null,
  };
}

interface CrmSmsSettings { sender_name: string | null; quiet_from: number | null; quiet_to: number | null; no_sunday: boolean | null; test_phone: string | null }

async function crmSettings(admin: Admin, scope: Scope): Promise<CrmSmsSettings | null> {
  if (!scope.crm || !scope.scopeKey) return null;
  const { data } = await admin.from("crm_sms_settings")
    .select("sender_name, quiet_from, quiet_to, no_sunday, test_phone").eq("scope_key", scope.scopeKey).maybeSingle();
  return (data as CrmSmsSettings | null) ?? null;
}

async function isCrmCampaign(admin: Admin, campaignId: string): Promise<boolean> {
  const { data, error } = await admin.rpc("sms_campaign_is_crm", { p_campaign_id: campaignId });
  if (error) throw new Error(`sms_campaign_is_crm: ${error.message}`);
  return data === true;
}

interface Wallet {
  /** Suite : id du solde de crédits SMS. Null = plateforme ou CRM. */
  balanceId: string | null;
  /** CRM : Yunits par SMS selon la zone du numéro. Null = pas de Yunits (Suite, plateforme). */
  rates: { fr: number; intl: number } | null;
}

async function walletFor(admin: Admin, scope: Scope): Promise<Wallet> {
  if (scope.platform) return { balanceId: null, rates: null };
  if (scope.crm) {
    const { data } = await admin.rpc("crm_sms_rates");
    const r = (data as { fr?: number; intl?: number } | null) ?? {};
    return { balanceId: null, rates: { fr: Math.max(1, Number(r.fr) || 35), intl: Math.max(1, Number(r.intl) || 70) } };
  }
  const { data, error } = await admin.rpc("get_or_create_sms_balance", { p_venue_id: scope.venueId, p_organizer_id: scope.organizerId });
  if (error || !data) throw new Error(`Balance error: ${error?.message ?? "unknown"}`);
  return { balanceId: data as string, rates: null };
}

/**
 * Unités débitées pour `segments` SMS vers une zone : Yunits (CRM, tarif de la
 * zone) ou crédits (Suite, 1 crédit = 1 segment). Zéro pour la plateforme.
 */
function unitsFor(scope: Scope, w: Wallet, segments: number, zone: SmsTariffZone): number {
  if (scope.platform) return 0;
  if (w.rates) return segments * (zone === "fr" ? w.rates.fr : w.rates.intl);
  return segments;
}

/** Solde du portefeuille (Yunits ou crédits). La plateforme n'est jamais bloquée. */
async function unitsAvailable(admin: Admin, scope: Scope, w: Wallet): Promise<number> {
  if (scope.platform) return Number.MAX_SAFE_INTEGER;
  if (scope.crm) {
    const { data } = await admin.rpc("crm_yunits_balance", { p_scope_key: scope.scopeKey });
    return Number(data || 0);
  }
  const { data } = await admin.from("sms_credit_balances").select("balance").eq("id", w.balanceId).single();
  return Number(data?.balance ?? 0);
}

/** Ce que coûtent les numéros encore en file, selon leur zone. */
async function unitsNeeded(admin: Admin, scope: Scope, w: Wallet, campaignId: string, segments: number): Promise<number> {
  const base = () => admin.from("sms_campaign_recipients").select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId).in("status", ["pending", "sending"]);
  const [{ count: all }, { count: fr }] = await Promise.all([base(), base().like("phone_e164", "+33%")]);
  const total = Number(all || 0), french = Number(fr || 0);
  return unitsFor(scope, w, segments, "fr") * french + unitsFor(scope, w, segments, "intl") * (total - french);
}

/** Débite `units` (Yunits ou crédits) ; false = solde insuffisant (rien n'est débité). */
async function debit(admin: Admin, scope: Scope, w: Wallet, units: number, campaignId: string | null, label: string): Promise<boolean> {
  if (units <= 0 || scope.platform) return true;
  if (scope.crm) {
    const { data, error } = await admin.rpc("crm_yunits_debit", {
      p_scope_key: scope.scopeKey, p_amount: units, p_channel: "sms",
      p_ref_type: "sms_campaign", p_ref_id: campaignId, p_label: label, p_meta: {},
    });
    return !error && (data as { ok?: boolean } | null)?.ok === true;
  }
  const { data, error } = await admin.rpc("consume_sms_credits", { p_balance_id: w.balanceId, p_amount: units });
  return !error && data === true;
}

/** Le pro connecté a-t-il la main sur cette portée ? Même porte que la RLS SMS. */
async function userOwnsScope(admin: Admin, userId: string, venueId: string | null, organizerId: string | null): Promise<boolean> {
  if (organizerId && organizerId === userId) return true;
  if (venueId) {
    const { data: ok } = await admin.rpc("can_manage_venue", { _user_id: userId, _venue_id: venueId });
    if (ok === true) return true;
  }
  if (organizerId) {
    const { data: member } = await admin.rpc("is_org_team_member", { _user_id: userId, _organizer_user_id: organizerId, _min_role: "admin" });
    if (member === true) return true;
    // Console CRM : un éditeur du compte écrit et envoie, comme pour l'e-mail.
    const { data: inCrm } = await admin.rpc("crm_user_in_scope", { p_user_id: userId, p_venue_id: venueId, p_organizer_user_id: organizerId });
    if (inCrm === true) return true;
  }
  // La portée plateforme n'appartient qu'au super admin — comme la RLS.
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  return isAdmin === true;
}

/** Identité de l'annonceur (charte AF2M) : raison sociale + SIRET / RNA / TVA. */
async function identityOk(admin: Admin, scope: Scope): Promise<boolean> {
  if (scope.platform) return true;
  const { data, error } = await admin.rpc("get_sms_sender_readiness", { p_venue_id: scope.venueId, p_organizer_user_id: scope.organizerId });
  if (error) throw new Error(`readiness: ${error.message}`);
  return (data as { identity_ok?: boolean } | null)?.identity_ok === true;
}

/**
 * Ce qui s'affiche à la place du numéro (3 à 11 lettres ou chiffres) et le nom
 * écrit en tête du message. Console CRM : le nom d'expéditeur sert aux deux
 * (comme l'aperçu du composeur). Suite : nom libre en tête, identifiant dérivé.
 */
function senderFor(campaign: Record<string, unknown>, scope: Scope, settings: CrmSmsSettings | null): { id: string; prefix: string } {
  if (scope.platform) return { id: "YUNO", prefix: cleanSenderName(campaign.sender_name as string) || "Yuno" };
  if (scope.crm) {
    const id = (campaign.sender_name as string) || settings?.sender_name || toSenderId(scope.name) || "YUNO";
    return { id: id.trim(), prefix: id.trim() };
  }
  const prefix = cleanSenderName(campaign.sender_name as string);
  const id = (campaign.sender_id as string) || toSenderId(prefix) || toSenderId(scope.name) || "YUNO";
  return { id, prefix };
}

function quietFor(campaign: Record<string, unknown>, scope: Scope, settings: CrmSmsSettings | null): SmsQuietRules {
  if (scope.crm) {
    return {
      on: campaign.quiet_hours !== false,
      from: settings?.quiet_from ?? 20, to: settings?.quiet_to ?? 8, noSunday: settings?.no_sunday ?? true,
    };
  }
  return { on: campaign.quiet_hours === true, from: 20, to: 8, noSunday: true };
}

/** Lien de la soirée : court `/go/` ou `/l/` en Console CRM, lien suivi `/l/` complet dans la Suite. */
async function linkFor(admin: Admin, campaign: Record<string, unknown>, scope: Scope): Promise<string | null> {
  if (!campaign.event_id) return null;
  if (scope.crm) {
    const { data, error } = await admin.rpc("ensure_crm_sms_link", { p_campaign_id: campaign.id });
    if (error) { console.error("ensure_crm_sms_link:", error.message); return null; }
    const r = data as { kind?: string; code?: string } | null;
    return r?.code ? `${SHORT_HOST}/${r.kind === "go" ? "go" : "l"}/${r.code}` : null;
  }
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

async function eventTitle(admin: Admin, eventId: string | null): Promise<string> {
  if (!eventId) return "";
  const { data } = await admin.from("events").select("title").eq("id", eventId).maybeSingle();
  return (data?.title as string) || "";
}

interface Composer {
  /** Texte exact d'un destinataire. */
  text: (lang: string | null | undefined, phone: string, firstName: string | null) => string;
}

function makeComposer(campaign: Record<string, unknown>, scope: Scope, prefix: string, link: string | null, title: string): Composer {
  const i18n = (campaign.body_i18n as Record<string, string> | null) || null;
  return {
    text: (lang, phone, firstName) => {
      const l = normalizeLang(lang);
      const base = (i18n && i18n[l]) || (campaign.body_template as string) || "";
      const filled = resolveSmsVars(base, { "prénom": firstName || "", nom_club: scope.name, "soirée": title, lien: link || "" });
      return composeSmsBody(filled, l, prefix, link, { french: isFrenchNumber(phone) });
    },
  };
}

/** Segments par message dans le pire des cas connus (langues, mention STOP, prénom d'exemple). */
function worstSegments(c: Composer): number {
  const samples: Array<[string, string]> = [["fr", "+33600000000"], ["en", "+33600000000"], ["es", "+33600000000"], ["fr", "+34600000000"]];
  return Math.max(1, ...samples.map(([l, p]) => smsSizing(c.text(l, p, SAMPLE_FIRST_NAME)).segments));
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

interface ClaimedRecipient {
  id: string; phone_e164: string; full_name: string | null; first_name: string | null;
  user_id: string | null; lang: string | null; attempts: number; provider_request_id: string | null;
}

interface Prepared { row: ClaimedRecipient; text: string; segments: number; zone: SmsTariffZone }

async function drainSlice(admin: Admin, campaign: Record<string, unknown>, cfg: OctopushConfig): Promise<SliceResult> {
  const campaignId = campaign.id as string;
  const crm = await isCrmCampaign(admin, campaignId);
  const scope = await loadScope(admin, (campaign.venue_id as string | null) ?? null, (campaign.organizer_id as string | null) ?? null, crm);
  const settings = await crmSettings(admin, scope);
  const wallet = await walletFor(admin, scope);
  const sender = senderFor(campaign, scope, settings);
  const quiet = quietFor(campaign, scope, settings);
  const link = await linkFor(admin, campaign, scope);
  const composer = makeComposer(campaign, scope, sender.prefix, link, await eventTitle(admin, (campaign.event_id as string | null) ?? null));
  const label = String(campaign.name || "SMS").slice(0, 120);
  const deadline = Date.now() + SLICE_MS;

  let sent = 0;
  let failed = 0;
  let status = "sending";
  let stopped: SliceResult["stopped"] = "done";
  let detail: string | undefined;

  const pause = async (reason: "credits" | "send_error", message: string) => {
    await admin.from("sms_campaigns").update({ status: "paused", paused_reason: reason, error_message: message.slice(0, 500) })
      .eq("id", campaignId).eq("status", "sending");
    status = "paused";
  };

  /** Remet des lignes en file (crédits, pause, passager) sans les compter comme tentative ratée. */
  const requeue = async (ids: string[], error: string, code: string, countsAsAttempt: boolean, delayMs = 120_000) => {
    if (!ids.length) return;
    await admin.rpc("mark_sms_campaign_recipients_failed", {
      p_campaign_id: campaignId, p_ids: ids, p_error: error, p_error_code: code,
      p_retry_at: new Date(Date.now() + delayMs).toISOString(),
      p_max_attempts: countsAsAttempt ? 3 : 1_000,
    });
  };
  const kill = async (ids: string[], error: string, code: string) => {
    if (!ids.length) return;
    await admin.rpc("mark_sms_campaign_recipients_failed", {
      p_campaign_id: campaignId, p_ids: ids, p_error: error, p_error_code: code, p_retry_at: null, p_max_attempts: 3,
    });
    failed += ids.length;
  };

  /**
   * Un lot au même texte : débit, logs, identifiant d'envoi, appel, marquage.
   * Rend « halt » quand toute la campagne doit s'arrêter.
   */
  const sendGroup = async (items: Prepared[], requestId: string | null): Promise<"ok" | "halt"> => {
    const ids = items.map((p) => p.row.id);
    const segments = items[0].segments;
    // Un lot a un seul texte et une seule zone : un seul prix par SMS.
    const unitsEach = unitsFor(scope, wallet, segments, items[0].zone);
    if (!(await debit(admin, scope, wallet, unitsEach * items.length, campaignId, label))) {
      await requeue(ids, "Crédits épuisés", "credits", false);
      await pause("credits", scope.crm ? "Yunits épuisés en cours d'envoi — rechargez puis reprenez." : "Crédits SMS épuisés en cours d'envoi — rechargez puis reprenez.");
      stopped = "credits";
      return "halt";
    }
    const logs = items.map((p) => ({
      id: crypto.randomUUID(),
      venue_id: scope.venueId, organizer_id: scope.organizerId, target_user_id: p.row.user_id ?? null,
      to_phone: p.row.phone_e164, body: p.text, status: "queued", purpose: "campaign",
      campaign_id: campaignId, event_id: (campaign.event_id as string | null) ?? null,
      credits_consumed: segments, yunits_debited: scope.crm ? unitsEach : 0,
      provider: "octopush", sender_id: sender.id,
    }));
    const logIds = logs.map((l) => l.id);
    const { error: logErr } = await admin.from("sms_logs").insert(logs);
    if (logErr) {
      // Débit sans log : rendu tel quel au portefeuille.
      if (scope.crm) await admin.rpc("crm_yunits_refund", { p_scope_key: scope.scopeKey, p_amount: unitsEach * items.length, p_channel: "sms", p_ref_type: "sms_campaign", p_ref_id: campaignId, p_label: "Journal indisponible" });
      else if (wallet.balanceId) await admin.rpc("refund_sms_credits", { p_balance_id: wallet.balanceId, p_amount: unitsEach * items.length, p_sms_log_id: null, p_notes: "log insert failed" });
      await requeue(ids, logErr.message, "log_error", true);
      return "ok";
    }

    const reqId = requestId ?? await batchRequestId(campaignId, ids);
    if (!requestId) await admin.rpc("set_sms_recipients_request_id", { p_campaign_id: campaignId, p_ids: ids, p_request_id: reqId });

    const args = { phones: items.map((p) => p.row.phone_e164), text: items[0].text, sender: sender.id, requestId: reqId };
    let out = await sendOctopushBatch(cfg, args);
    // Passager : un seul nouvel essai, avec le MÊME identifiant (s'il était
    // passé, Octopush répond « déjà vu »).
    if (!out.ok && out.kind === "retry") { await sleep(1500); out = await sendOctopushBatch(cfg, args); }

    if (out.ok) {
      const ticket = out.ticket;
      await admin.from("sms_logs").update({ status: "sent", provider_message_id: ticket, sent_at: new Date().toISOString() }).in("id", logIds);
      const rows = items.map((p, i) => ({ id: p.row.id, provider_message_id: ticket, sms_log_id: logIds[i], credits: segments }));
      const { error } = await admin.rpc("mark_sms_campaign_recipients_sent", { p_campaign_id: campaignId, p_rows: rows });
      if (error) console.error("mark sent failed:", error.message);
      sent += items.length;
      return "ok";
    }

    // Refus : jamais parti, rendu au portefeuille.
    await admin.from("sms_logs").update({ status: "failed", error_code: out.code, error_message: out.message }).in("id", logIds);
    await admin.rpc("refund_sms_log_batch", { p_log_ids: logIds, p_note: `Octopush ${out.code}` });

    if (out.kind === "campaign") {
      await requeue(ids, `Octopush ${out.code}: ${out.message}`, out.code, false);
      if (out.code === "104" || out.code === "113" || out.code === "401" || out.code === "403") {
        console.error(`[send-sms-campaign] Octopush account problem ${out.code}: ${out.message}`);
      }
      await pause("send_error", octopushErrorLabel(out.code));
      stopped = "error"; detail = out.message;
      return "halt";
    }
    if (out.kind === "batch") {
      // Un numéro refusé fait tomber tout le lot : on renvoie chacun seul.
      if (items.length > 1) {
        await admin.rpc("set_sms_recipients_request_id", { p_campaign_id: campaignId, p_ids: ids, p_request_id: null });
        for (const one of items) {
          if ((await sendGroup([one], null)) === "halt") return "halt";
        }
        return "ok";
      }
      await kill(ids, out.message, out.code);
      return "ok";
    }
    // Passager deux fois de suite : la ligne repart plus tard, même identifiant.
    await requeue(ids, `Octopush ${out.code}: ${out.message}`, "retry", true);
    return "ok";
  };

  outer:
  while (true) {
    const { data: live } = await admin.from("sms_campaigns").select("status, paused_reason").eq("id", campaignId).single();
    status = (live?.status as string) || "sending";
    if (status !== "sending") { stopped = "paused"; detail = (live?.paused_reason as string) || status; break; }
    if (Date.now() >= deadline) { stopped = "deadline"; break; }
    const hold = smsHoldReason(new Date(), quiet);
    if (hold) { stopped = "quiet"; detail = hold; break; }

    const { data: claimed, error: cErr } = await admin.rpc("claim_sms_campaign_recipients", { p_campaign_id: campaignId, p_limit: OCTOPUSH_BATCH });
    if (cErr) { stopped = "error"; detail = `claim: ${cErr.message}`; break; }
    const rows = (claimed || []) as ClaimedRecipient[];
    if (rows.length === 0) { stopped = "done"; break; }

    // Préparation : texte exact de chacun, puis lots au même texte. Une ligne
    // déjà partie dans un lot (reprise) garde son lot et son identifiant.
    const dead = rows.filter((r) => !E164.test(r.phone_e164));
    await kill(dead.map((r) => r.id), "Numéro non E.164", "invalid_phone");
    // +1 : un nom d'expéditeur n'y est pas accepté (jamais mis en file, filet ici).
    const blocked = rows.filter((r) => E164.test(r.phone_e164) && smsTariffZone(r.phone_e164) === "blocked");
    await kill(blocked.map((r) => r.id), "Destination sans nom d'expéditeur (États-Unis, Canada)", "blocked_destination");
    const groups = new Map<string, { items: Prepared[]; requestId: string | null }>();
    for (const r of rows) {
      const zone = smsTariffZone(r.phone_e164);
      if (!E164.test(r.phone_e164) || zone === "blocked") continue;
      const text = composer.text(r.lang, r.phone_e164, r.first_name);
      const segments = Math.max(1, smsSizing(text).segments);
      const key = r.provider_request_id ? `req:${r.provider_request_id}` : `${zone}|txt:${text}`;
      const g = groups.get(key) ?? { items: [], requestId: r.provider_request_id };
      g.items.push({ row: r, text, segments, zone });
      groups.set(key, g);
    }

    const list = [...groups.values()];
    for (let i = 0; i < list.length; i++) {
      if ((await sendGroup(list[i].items, list[i].requestId)) === "halt") {
        // Les lots pas encore traités retournent en file, sans compter de tentative.
        await requeue(list.slice(i + 1).flatMap((g) => g.items.map((p) => p.row.id)), "En attente", "paused", false);
        break outer;
      }
      if (Date.now() >= deadline && i < list.length - 1) {
        await requeue(list.slice(i + 1).flatMap((g) => g.items.map((p) => p.row.id)), "Tranche suivante", "slice", false, 0);
        stopped = "deadline";
        break outer;
      }
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
  /** Console CRM : le test d'une campagne enregistrée (texte, soirée, expéditeur lus en base). */
  campaign_id?: string | null;
  venue_id?: string | null;
  organizer_user_id?: string | null;
  /** Portée plateforme explicite : sans ce drapeau, deux portées à NULL est
   *  une erreur d'appel, pas « écris au nom de Yuno ». */
  platform?: boolean;
  body?: string;
  body_i18n?: Record<string, string> | null;
  sender_name?: string | null;
  event_id?: string | null;
  test_phone?: string | null;
  lang?: string | null;
}

function toPhone(raw: string | null | undefined): string {
  const s = (raw || "").trim();
  if (!s) return "";
  if (s.startsWith("+")) return "+" + s.replace(/[^0-9]/g, "");
  const d = s.replace(/[^0-9]/g, "");
  if (d.startsWith("00")) return `+${d.slice(2)}`;
  if (d.startsWith("0") && d.length === 10) return `+33${d.slice(1)}`;
  return d;
}

async function sendTest(admin: Admin, userId: string, p: TestPayload, cfg: OctopushConfig) {
  // La campagne enregistrée (Console CRM), ou le contenu envoyé par l'éditeur (Suite).
  let campaign: Record<string, unknown>;
  if (p.campaign_id) {
    const { data, error } = await admin.from("sms_campaigns").select("*").eq("id", p.campaign_id).single();
    if (error || !data) return json({ error: "Campaign not found" }, 404);
    campaign = data as Record<string, unknown>;
  } else {
    const venueId = p.venue_id || null;
    const organizerId = venueId ? null : (p.organizer_user_id || null);
    if (!venueId && !organizerId && p.platform !== true) return json({ error: "scope required" }, 400);
    campaign = {
      id: null, venue_id: venueId, organizer_id: organizerId, body_template: p.body || "", body_i18n: p.body_i18n ?? null,
      sender_name: p.sender_name ?? null, event_id: p.event_id ?? null, name: "Test",
    };
  }
  const venueId = (campaign.venue_id as string | null) ?? null;
  const organizerId = (campaign.organizer_id as string | null) ?? null;
  if (!(await userOwnsScope(admin, userId, venueId, organizerId))) return json({ error: "Forbidden" }, 403);
  if (await isDemoMarketingScope(venueId, organizerId)) return json({ error: "demo_no_send", code: "demo_no_send" }, 409);

  const crm = campaign.id ? await isCrmCampaign(admin, campaign.id as string) : false;
  const scope = await loadScope(admin, venueId, organizerId, crm);
  if (!(await identityOk(admin, scope))) return json({ error: "SMS_IDENTITY_REQUIRED", code: "SMS_IDENTITY_REQUIRED" }, 409);
  const settings = await crmSettings(admin, scope);
  const sender = senderFor(campaign, scope, settings);
  if (senderIdError(sender.id)) return json({ error: "SENDER_INVALID", code: "SENDER_INVALID", reason: senderIdError(sender.id) }, 400);

  const { data: prof } = await admin.from("profiles").select("phone, preferred_language, first_name").eq("id", userId).maybeSingle();
  const phone = toPhone(p.test_phone || settings?.test_phone || (prof?.phone as string | null));
  if (!E164.test(phone)) return json({ error: "TEST_PHONE_INVALID", code: "TEST_PHONE_INVALID" }, 400);

  // Console CRM : le test est gratuit, mais pas illimité.
  if (scope.crm) {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    let q = admin.from("sms_logs").select("id", { count: "exact", head: true }).eq("purpose", "manual").gte("created_at", since);
    q = venueId ? q.eq("venue_id", venueId) : q.eq("organizer_id", organizerId!);
    const { count } = await q;
    if ((count ?? 0) >= CRM_FREE_TESTS_PER_DAY) return json({ error: "TEST_LIMIT", code: "TEST_LIMIT", limit: CRM_FREE_TESTS_PER_DAY }, 429);
  }

  const lang = normalizeLang(p.lang || (prof?.preferred_language as string | null));
  let link: string | null = null;
  if (campaign.event_id) {
    if (scope.crm && campaign.id) link = await linkFor(admin, campaign, scope);
    else {
      const { data } = await admin.rpc("ensure_sms_tracked_link", { p_event_id: campaign.event_id });
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.code) link = `${PUBLIC_URL}/l/${row.code}`;
    }
  }
  const composer = makeComposer(campaign, scope, sender.prefix, link, await eventTitle(admin, (campaign.event_id as string | null) ?? null));
  const text = composer.text(lang, phone, ((prof?.first_name as string | null) || SAMPLE_FIRST_NAME).trim());
  const segments = Math.max(1, smsSizing(text).segments);

  const wallet: Wallet = scope.crm ? { balanceId: null, rates: null } : await walletFor(admin, scope);
  const freeTest = scope.crm || scope.platform;
  if (!freeTest && !(await debit(admin, scope, wallet, segments, null, "Test"))) {
    return json({ error: "INSUFFICIENT_CREDITS", needed: segments, balance: await unitsAvailable(admin, scope, wallet) }, 402);
  }

  const logId = crypto.randomUUID();
  await admin.from("sms_logs").insert({
    id: logId, venue_id: venueId, organizer_id: organizerId, target_user_id: userId, to_phone: phone, body: text,
    status: "queued", purpose: "manual", event_id: (campaign.event_id as string | null) ?? null,
    campaign_id: (campaign.id as string | null) ?? null, credits_consumed: freeTest ? 0 : segments,
    provider: "octopush", sender_id: sender.id,
  });

  const out = await sendOctopushBatch(cfg, { phones: [phone], text, sender: sender.id, requestId: `t-${logId}` });
  if (!out.ok) {
    await admin.from("sms_logs").update({ status: "failed", error_code: out.code, error_message: out.message }).eq("id", logId);
    if (!freeTest) await admin.rpc("refund_sms_log_batch", { p_log_ids: [logId], p_note: `Test refusé: Octopush ${out.code}` });
    return json({ error: "PROVIDER_ERROR", code: out.code, message: octopushErrorLabel(out.code) }, 502);
  }
  await admin.from("sms_logs").update({ provider_message_id: out.ticket, status: "sent", sent_at: new Date().toISOString() }).eq("id", logId);
  if (campaign.id) await admin.from("sms_campaigns").update({ test_sent_at: new Date().toISOString() }).eq("id", campaign.id);
  return json({ success: true, test: true, to: phone, body: text, segments, free: freeTest, simulated: cfg.simulation });
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Lien démo : lecture seule garantie côté serveur (_shared/demo-guard.ts).
  const demoRefusal = await demoPreviewGuard(req, corsHeaders);
  if (demoRefusal) return demoRefusal;
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

    const cfg = octopushConfig((k) => Deno.env.get(k));

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
    // Périmètre démo : on compose, on n'envoie jamais (cron compris). Une
    // campagne passée en file retourne en brouillon.
    if (await isDemoMarketingScope(campaign.venue_id as string | null, campaign.organizer_id as string | null)) {
      if (["sending", "scheduled"].includes(String(campaign.status))) {
        await admin.from("sms_campaigns").update({ status: "draft" }).eq("id", campaignId).in("status", ["sending", "scheduled"]);
      }
      return json({ error: "demo_no_send", code: "demo_no_send" }, 409);
    }
    if (!cfg) return json({ error: "SMS_NOT_CONFIGURED" }, 503);

    // ── Reprise après pause ─────────────────────────────────────────────────
    if (mode === "resume") {
      if (campaign.status !== "paused") return json({ error: `Campagne ${campaign.status}, pas en pause` }, 409);
      if (campaign.paused_reason === "credits") {
        // Ne pas repartir pour se re-bloquer trois numéros plus loin.
        const crm = await isCrmCampaign(admin, campaignId);
        const scope = await loadScope(admin, campaign.venue_id, campaign.organizer_id, crm);
        const wallet = await walletFor(admin, scope);
        const needed = await unitsNeeded(admin, scope, wallet, campaignId, Number(campaign.segments_per_message || 1));
        const balance = await unitsAvailable(admin, scope, wallet);
        if (balance < needed) {
          return json(scope.crm
            ? { error: "crm_yunits_insufficient", code: "crm_yunits_insufficient", needed, balance }
            : { error: "INSUFFICIENT_CREDITS", needed, balance, missing: needed - balance }, 402);
        }
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

      const crm = await isCrmCampaign(admin, campaignId);
      const scope = await loadScope(admin, campaign.venue_id, campaign.organizer_id, crm);
      // Un refus avant la file laisse la campagne en brouillon (le cron d'une
      // campagne programmée ne la marque pas « échouée » sur un 400 / 402).
      const backToDraft = (message: string) =>
        admin.from("sms_campaigns").update({ status: "draft", error_message: message }).eq("id", campaignId).in("status", ["draft", "scheduled", "failed"]);

      if (!(await identityOk(admin, scope))) {
        await backToDraft("sms_identity_required");
        return json({ error: "SMS_IDENTITY_REQUIRED", code: "SMS_IDENTITY_REQUIRED" }, 400);
      }
      const settings = await crmSettings(admin, scope);
      const sender = senderFor(campaign, scope, settings);
      const senderErr = senderIdError(sender.id);
      if (senderErr) {
        await backToDraft(`sender_invalid:${senderErr}`);
        return json({ error: "SENDER_INVALID", code: "SENDER_INVALID", reason: senderErr }, 400);
      }

      // Coût par message : pire cas connu, avec un lien de la taille réelle.
      const sampleLink = campaign.event_id ? (scope.crm ? `${SHORT_HOST}/go/XXXXXXXX` : `${PUBLIC_URL}/l/XXXXXXXX`) : null;
      const segments = worstSegments(makeComposer(campaign, scope, sender.prefix, sampleLink, await eventTitle(admin, campaign.event_id)));

      const { data: enq, error: eErr } = await admin.rpc("enqueue_sms_campaign_recipients", { p_campaign_id: campaignId });
      if (eErr) {
        const m = eErr.message || "";
        if (m.includes("crm_paused")) { await backToDraft("crm_paused"); return json({ error: "crm_paused", code: "crm_paused" }, 402); }
        throw new Error(`Audience resolution failed: ${m}`);
      }
      const pending = Number(enq?.pending || 0);
      if (pending <= 0) {
        if (scope.crm) await backToDraft("Aucun destinataire joignable par SMS pour cette audience");
        else await admin.from("sms_campaigns").update({ status: "failed", error_message: "Aucun destinataire consentant pour cette audience" }).eq("id", campaignId);
        return json({ error: "NO_RECIPIENTS", code: "NO_RECIPIENTS", detail: enq }, 400);
      }

      const wallet = await walletFor(admin, scope);
      const balance = await unitsAvailable(admin, scope, wallet);
      const needed = await unitsNeeded(admin, scope, wallet, campaignId, segments);
      if (balance < needed) {
        await admin.from("sms_campaigns").update({
          status: "draft", segments_per_message: segments,
          error_message: scope.crm ? "crm_yunits_insufficient" : `Crédits insuffisants : ${needed} nécessaires, ${balance} disponibles`,
        }).eq("id", campaignId);
        return json(scope.crm
          ? { error: "crm_yunits_insufficient", code: "crm_yunits_insufficient", needed, balance, recipients: pending, segments }
          : { error: "INSUFFICIENT_CREDITS", needed, balance, missing: needed - balance, recipients: pending, segments }, 402);
      }

      const { error: upErr } = await admin.from("sms_campaigns").update({
        status: "sending",
        segments_per_message: segments,
        sender_id: sender.id,
        ...(scope.crm ? {} : { sender_name: cleanSenderName(campaign.sender_name) || null }),
        send_started_at: new Date().toISOString(),
        paused_reason: null,
        error_message: null,
      }).eq("id", campaignId);
      if (upErr) {
        // Envois gelés par Yuno (garde guard_crm_send_frozen).
        if ((upErr.message || "").includes("crm_send_frozen")) { await backToDraft("crm_send_frozen"); return json({ error: "crm_send_frozen", code: "crm_send_frozen" }, 409); }
        throw new Error(upErr.message);
      }
      campaign.status = "sending";
      campaign.segments_per_message = segments;
      campaign.sender_id = sender.id;

      const slice = await drainSlice(admin, campaign, cfg);
      return json({ success: true, queued: enq, segments, ...slice });
    }

    // ── Tranche suivante (mode 'drain') ─────────────────────────────────────
    if (campaign.status !== "sending") return json({ success: true, skipped: campaign.status });
    const slice = await drainSlice(admin, campaign, cfg);
    return json({ success: true, ...slice });
  } catch (e) {
    const msg = errorText(e);
    console.error("[send-sms-campaign]", msg);
    return json({ error: msg }, 500);
  }
});
