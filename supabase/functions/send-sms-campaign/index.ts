// Edge function: send-sms-campaign
// Bulk-sends an SMS campaign via Twilio to all resolved recipients.
// Uses the existing credit system (consume_sms_credits RPC per message).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { z } from "npm:zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

const BodySchema = z.object({
  campaign_id: z.string().uuid(),
  venue_id: z.string().min(1),
  message_body: z.string().min(1).max(1600),
  segment_type: z.enum(["all", "event", "vip"]),
  event_id: z.string().uuid().optional().nullable(),
  // Multi-langue par destinataire (variante générée par l'IA appliquée dans les
  // 3 langues) : chacun reçoit sa langue, message_body reste le fallback.
  body_i18n: z.object({
    en: z.string().min(1).max(1600).optional(),
    fr: z.string().min(1).max(1600).optional(),
    es: z.string().min(1).max(1600).optional(),
  }).optional().nullable(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      throw new Error("Twilio credentials not configured");
    }

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // Parse input
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid input", details: parsed.error.flatten() }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const input = parsed.data;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Verify ownership
    const { data: venue } = await admin
      .from("venues").select("id, owner_id").eq("id", input.venue_id).maybeSingle();
    if (!venue) {
      return new Response(JSON.stringify({ error: "Venue not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (venue.owner_id !== userId && !isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark campaign as sending
    await admin.from("sms_campaigns")
      .update({ status: "sending" })
      .eq("id", input.campaign_id);

    // Resolve recipients
    const { data: recipients, error: recipientsErr } = await admin.rpc(
      "resolve_sms_campaign_recipients",
      {
        p_venue_id: input.venue_id,
        p_segment_type: input.segment_type,
        p_event_id: input.event_id ?? null,
      }
    );
    if (recipientsErr) throw new Error(`Recipients error: ${recipientsErr.message}`);
    if (!recipients || recipients.length === 0) {
      await admin.from("sms_campaigns").update({
        status: "sent", sent_at: new Date().toISOString(), sent_count: 0,
      }).eq("id", input.campaign_id);
      return new Response(
        JSON.stringify({ success: true, sent: 0, failed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Get or create balance
    const { data: balanceId, error: balErr } = await admin.rpc("get_or_create_sms_balance", {
      p_venue_id: input.venue_id,
      p_organizer_id: null,
    });
    if (balErr || !balanceId) throw new Error(`Balance error: ${balErr?.message}`);

    // Check balance has enough credits
    const { data: balanceRow } = await admin
      .from("sms_credit_balances").select("balance").eq("id", balanceId).single();
    if (!balanceRow || balanceRow.balance < recipients.length) {
      await admin.from("sms_campaigns").update({ status: "failed" }).eq("id", input.campaign_id);
      return new Response(
        JSON.stringify({
          error: "INSUFFICIENT_CREDITS",
          message: `Solde insuffisant: ${balanceRow?.balance ?? 0} crédits, ${recipients.length} destinataires`,
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const twilioBasicAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const statusCallback = `${SUPABASE_URL}/functions/v1/sms-twilio-status-webhook`;

    // Multi-langue : la langue de chaque destinataire vient de son profil
    // (fallback 'fr', même convention que les push automations). Les
    // destinataires sans compte (phone seul) reçoivent le message composé.
    const i18n = input.body_i18n ?? null;
    const userLang = new Map<string, string>();
    if (i18n) {
      const userIds = recipients
        .map((r: { user_id?: string | null }) => r.user_id)
        .filter((id: string | null | undefined): id is string => !!id);
      for (let i = 0; i < userIds.length; i += 500) {
        const { data: profs } = await admin
          .from("profiles").select("id, preferred_language").in("id", userIds.slice(i, i + 500));
        for (const p of profs ?? []) userLang.set(p.id, p.preferred_language || "fr");
      }
    }
    // Mention d'opposition, obligatoire dans CHAQUE message de prospection
    // (art. L34-5 al. 4 CPCE : « chaque fois qu'un [message] de prospection lui
    // est adressé »). Cumulative avec le consentement, pas alternative : la
    // CNIL a sanctionné ACCOR sur ce seul fondement (SAN-2022-017, 100 k€ de
    // la sanction). Ajoutée ici, côté serveur, et pas dans l'éditeur de
    // campagne : un owner ne doit pas pouvoir l'oublier ni la retirer.
    const STOP_SUFFIX: Record<string, string> = {
      fr: "\nSTOP pour ne plus recevoir",
      en: "\nReply STOP to opt out",
      es: "\nResponde STOP para darte de baja",
    };
    // Le suffixe peut faire basculer un message de 1 à 2 segments SMS alors
    // qu'un seul crédit est décompté. C'est assumé : la conformité prime sur
    // le coût, et l'écart est d'environ 30 caractères.
    const withStop = (body: string, lang: string): string => {
      const suffix = STOP_SUFFIX[lang] ?? STOP_SUFFIX.fr;
      // Idempotent : si l'owner a déjà écrit STOP lui-même, on ne double pas.
      return /\bSTOP\b/i.test(body) ? body : body + suffix;
    };

    const bodyFor = (userId: string | null | undefined): string => {
      const lang = (userId && userLang.get(userId)) || "fr";
      if (!i18n) return withStop(input.message_body, lang);
      const localized = (i18n as Record<string, string | undefined>)[lang] || input.message_body;
      return withStop(localized, lang);
    };

    let sentCount = 0;
    let failedCount = 0;

    for (const recipient of recipients) {
      // Atomic credit consume
      const { data: consumed } = await admin.rpc("consume_sms_credits", {
        p_balance_id: balanceId,
        p_amount: 1,
      });
      if (!consumed) {
        failedCount++;
        continue;
      }

      const localizedBody = bodyFor(recipient.user_id);

      // Insert log
      const { data: log } = await admin.from("sms_logs").insert({
        venue_id: input.venue_id,
        organizer_id: null,
        target_user_id: recipient.user_id ?? null,
        to_phone: recipient.phone_e164,
        body: localizedBody,
        status: "queued",
        purpose: "campaign",
        campaign_id: input.campaign_id,
        credits_consumed: 1,
      }).select("id").single();

      if (!log) { failedCount++; continue; }

      // Send via Twilio
      const twilioParams = new URLSearchParams({
        To: recipient.phone_e164,
        From: TWILIO_PHONE_NUMBER,
        Body: localizedBody,
        StatusCallback: statusCallback,
      });
      const twilioRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${twilioBasicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: twilioParams.toString(),
        }
      );
      const twilioData = await twilioRes.json();

      if (!twilioRes.ok) {
        await admin.from("sms_logs").update({
          status: "failed",
          error_code: String(twilioData.code ?? twilioRes.status),
          error_message: twilioData.message ?? "Twilio error",
        }).eq("id", log.id);
        await admin.rpc("refund_sms_credits", {
          p_balance_id: balanceId, p_amount: 1, p_sms_log_id: log.id,
          p_notes: `Twilio error ${twilioRes.status}`,
        });
        failedCount++;
      } else {
        await admin.from("sms_logs").update({
          twilio_sid: twilioData.sid,
          status: "sent",
          sent_at: new Date().toISOString(),
        }).eq("id", log.id);
        sentCount++;
      }
    }

    await admin.from("sms_campaigns").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_count: sentCount,
      failed_count: failedCount,
    }).eq("id", input.campaign_id);

    return new Response(
      JSON.stringify({ success: true, sent: sentCount, failed: failedCount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[send-sms-campaign]", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
