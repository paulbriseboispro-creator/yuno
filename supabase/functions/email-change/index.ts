import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { type EmailLanguage } from "../_shared/email-branding.ts";
import { buildSecureLink } from "../_shared/email-templates.ts";

// Unified email-change dispatcher.
// Replaces: request-email-change, submit-new-email, verify-email-change.
// Route via body.action: "request" | "submit" | "verify".
// verify_jwt = false (config.toml): "verify" is token-only (email link);
// "request"/"submit" re-validate the user JWT internally below.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = { "Content-Type": "application/json", ...corsHeaders };

function emailFrom(): string {
  const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
  return rawFrom
    ? rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`
    : "Yuno <noreply@yunoapp.eu>";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const body = await req.json().catch(() => ({}));
  const action: string = body.action;

  // ───────────────────────────────────────────────────────────────────────────
  // action: "verify"  (← verify-email-change — token only, no auth)
  // ───────────────────────────────────────────────────────────────────────────
  if (action === "verify") {
    try {
      const { token } = body;
      if (!token) throw new Error("Missing token");

      const { data: request, error } = await supabaseAdmin
        .from("email_change_requests")
        .select("*")
        .eq("token", token)
        .single();

      if (error || !request) {
        return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 400, headers: jsonHeaders });
      }

      if (new Date(request.expires_at) < new Date()) {
        await supabaseAdmin
          .from("email_change_requests")
          .update({ status: "expired" })
          .eq("id", request.id);
        return new Response(JSON.stringify({ error: "Token expired" }), { status: 400, headers: jsonHeaders });
      }

      if (request.status === "pending_old_verification") {
        await supabaseAdmin
          .from("email_change_requests")
          .update({
            status: "pending_new_email",
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          })
          .eq("id", request.id);

        return new Response(
          JSON.stringify({ success: true, status: "pending_new_email", request_id: request.id }),
          { headers: jsonHeaders },
        );
      }

      if (request.status === "pending_new_verification") {
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(request.user_id, {
          email: request.new_email,
        });
        if (updateError) throw updateError;

        await supabaseAdmin
          .from("profiles")
          .update({ email: request.new_email })
          .eq("id", request.user_id);

        await supabaseAdmin
          .from("email_change_requests")
          .update({ status: "completed" })
          .eq("id", request.id);

        return new Response(
          JSON.stringify({ success: true, status: "completed" }),
          { headers: jsonHeaders },
        );
      }

      return new Response(JSON.stringify({ error: "Invalid request status" }), { status: 400, headers: jsonHeaders });
    } catch (error: any) {
      console.error("Error in email-change verify:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: jsonHeaders });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // action: "request"  (← request-email-change — requires auth)
  // ───────────────────────────────────────────────────────────────────────────
  if (action === "request") {
    try {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) throw new Error("Not authenticated");

      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
      );

      const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
      if (userError || !user) throw new Error("Not authenticated");

      const { origin } = body;

      await supabaseAdmin
        .from("email_change_requests")
        .update({ status: "expired" })
        .eq("user_id", user.id)
        .in("status", ["pending_old_verification", "pending_new_email", "pending_new_verification"]);

      const { data: request, error: insertError } = await supabaseAdmin
        .from("email_change_requests")
        .insert({
          user_id: user.id,
          old_email: user.email,
          status: "pending_old_verification",
        })
        .select("id, token")
        .single();

      if (insertError) throw insertError;

      let lang: EmailLanguage = "fr";
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("preferred_language")
        .eq("id", user.id)
        .single();
      if (profile?.preferred_language && ["en", "es", "fr"].includes(profile.preferred_language)) {
        lang = profile.preferred_language as EmailLanguage;
      }

      const verifyUrl = `${origin}/settings?email_change_token=${request.token}`;

      const subjects: Record<EmailLanguage, string> = {
        fr: "Vérification du changement d'email",
        en: "Email change verification",
        es: "Verificación de cambio de email",
      };
      const messages: Record<EmailLanguage, string> = {
        fr: "Tu as demandé à changer ton adresse email. Confirme que c'est bien toi ci-dessous. Ce lien expire dans 15 minutes.",
        en: "You requested to change your email address. Confirm it's you below. This link expires in 15 minutes.",
        es: "Has solicitado cambiar tu dirección de email. Confirma que eres tú abajo. Este enlace caduca en 15 minutos.",
      };
      const ctaLabels: Record<EmailLanguage, string> = { fr: "Confirmer", en: "Confirm", es: "Confirmar" };
      const footnotes: Record<EmailLanguage, string> = {
        fr: "Si tu n'as pas fait cette demande, ignore cet email.",
        en: "If you didn't make this request, ignore this email.",
        es: "Si no hiciste esta solicitud, ignora este email.",
      };

      const mail = buildSecureLink({
        lang,
        title: subjects[lang],
        message: messages[lang],
        ctaLabel: ctaLabels[lang],
        ctaUrl: verifyUrl,
        footnote: footnotes[lang],
      });

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({ from: emailFrom(), to: [user.email], subject: mail.subject, html: mail.html }),
      });

      if (!emailRes.ok) {
        const err = await emailRes.text();
        throw new Error(`Resend error: ${err}`);
      }

      return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
    } catch (error: any) {
      console.error("Error in email-change request:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: jsonHeaders });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // action: "submit"  (← submit-new-email — requires auth)
  // ───────────────────────────────────────────────────────────────────────────
  if (action === "submit") {
    try {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) throw new Error("Not authenticated");

      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
      );

      const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
      if (userError || !user) throw new Error("Not authenticated");

      const { request_id, new_email, origin } = body;
      if (!request_id || !new_email) throw new Error("Missing fields");

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(new_email)) throw new Error("Invalid email format");

      const { data: request, error: fetchError } = await supabaseAdmin
        .from("email_change_requests")
        .select("*")
        .eq("id", request_id)
        .eq("user_id", user.id)
        .eq("status", "pending_new_email")
        .single();

      if (fetchError || !request) {
        return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers: jsonHeaders });
      }

      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
      const emailInUse = existingUsers?.users?.some(
        (u) => u.email?.toLowerCase() === new_email.toLowerCase() && u.id !== user.id,
      );
      if (emailInUse) {
        return new Response(JSON.stringify({ error: "Email already in use" }), { status: 400, headers: jsonHeaders });
      }

      const newToken = crypto.randomUUID();

      await supabaseAdmin
        .from("email_change_requests")
        .update({
          new_email,
          token: newToken,
          status: "pending_new_verification",
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        })
        .eq("id", request_id);

      let lang: EmailLanguage = "fr";
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("preferred_language")
        .eq("id", user.id)
        .single();
      if (profile?.preferred_language && ["en", "es", "fr"].includes(profile.preferred_language)) {
        lang = profile.preferred_language as EmailLanguage;
      }

      const verifyUrl = `${origin}/settings?email_change_token=${newToken}`;

      const subjects: Record<EmailLanguage, string> = {
        fr: "Confirme ta nouvelle adresse email",
        en: "Confirm your new email address",
        es: "Confirma tu nueva dirección de email",
      };
      const messages: Record<EmailLanguage, string> = {
        fr: "Confirme ta nouvelle adresse email ci-dessous. Ce lien expire dans 15 minutes.",
        en: "Confirm your new email address below. This link expires in 15 minutes.",
        es: "Confirma tu nueva dirección de email abajo. Este enlace caduca en 15 minutos.",
      };
      const ctaLabels: Record<EmailLanguage, string> = { fr: "Confirmer", en: "Confirm", es: "Confirmar" };
      const footnotes: Record<EmailLanguage, string> = {
        fr: "Si tu n'as pas fait cette demande, ignore cet email.",
        en: "If you didn't make this request, ignore this email.",
        es: "Si no hiciste esta solicitud, ignora este email.",
      };

      const mail = buildSecureLink({
        lang,
        title: subjects[lang],
        message: messages[lang],
        ctaLabel: ctaLabels[lang],
        ctaUrl: verifyUrl,
        footnote: footnotes[lang],
      });

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({ from: emailFrom(), to: [new_email], subject: mail.subject, html: mail.html }),
      });

      if (!emailRes.ok) {
        const err = await emailRes.text();
        throw new Error(`Resend error: ${err}`);
      }

      return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
    } catch (error: any) {
      console.error("Error in email-change submit:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: jsonHeaders });
    }
  }

  return new Response(JSON.stringify({ error: `Unknown or missing action: ${action ?? "(none)"}` }), { status: 400, headers: jsonHeaders });
});
