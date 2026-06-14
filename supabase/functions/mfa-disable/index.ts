import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from "npm:resend@2.0.0";
import { wrapEmailWithBranding } from "../_shared/email-branding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action || (body.token ? "confirm" : "request");

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (action === "confirm") {
      const { token } = body;
      if (!token) throw new Error("Token manquant");

      const { data: request, error: findError } = await serviceClient
        .from("mfa_disable_requests")
        .select("*")
        .eq("token", token)
        .eq("used", false)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (findError || !request) throw new Error("Lien invalide ou expiré. Refais une demande de désactivation.");

      const userId = request.user_id;
      await serviceClient.from("mfa_disable_requests").update({ used: true, used_at: new Date().toISOString() }).eq("id", request.id);
      await serviceClient.rpc("delete_mfa_totp_secret", { p_user_id: userId });
      await serviceClient.from("mfa_recovery_codes").delete().eq("user_id", userId);

      const { error: profileError } = await serviceClient
        .from("profiles")
        .update({ mfa_enabled: false, mfa_verified_at: null })
        .eq("id", userId);
      if (profileError) throw profileError;

      await serviceClient.from("security_logs").insert({
        user_id: userId,
        action: "mfa_disabled_via_email",
        ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
        user_agent: req.headers.get("user-agent"),
        success: true,
      });

      // Best-effort alert email
      try {
        const resendApiKey = Deno.env.get("RESEND_API_KEY");
        const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@yunoapp.eu";
        if (resendApiKey && request.email) {
          const resend = new Resend(resendApiKey);
          const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "inconnue";
          const when = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
          const alertContent = `<div style="padding:32px 24px">
            <h1 style="color:#fff;font-size:22px;margin:0 0 16px">⚠️ 2FA désactivée sur ton compte</h1>
            <p style="color:#ccc;font-size:14px;line-height:1.6;margin:0 0 16px">L'authentification à deux facteurs vient d'être désactivée sur ton compte Yuno.</p>
            <div style="background:rgba(255,255,255,0.05);border-radius:8px;padding:16px;margin:0 0 24px">
              <p style="color:#ccc;font-size:13px;margin:0 0 6px">📅 <strong>Date:</strong> ${when} (Paris)</p>
              <p style="color:#ccc;font-size:13px;margin:0">🌐 <strong>IP:</strong> ${ipAddress}</p>
            </div>
            <p style="color:#ccc;font-size:14px;line-height:1.6;margin:0 0 16px">✅ Si c'est bien toi, tu n'as rien à faire.</p>
            <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:16px;margin-top:16px">
              <p style="color:#f87171;font-size:13px;margin:0 0 8px">🚨 <strong>Si ce n'est PAS toi:</strong></p>
              <p style="color:#ccc;font-size:13px;line-height:1.6;margin:0">Change ton mot de passe immédiatement et réactive la 2FA depuis tes paramètres de sécurité.</p>
            </div>
          </div>`;
          await resend.emails.send({
            from: `Yuno Sécurité <${fromEmail}>`,
            to: [request.email],
            subject: "⚠️ 2FA désactivée sur ton compte Yuno",
            html: wrapEmailWithBranding(alertContent, "fr"),
          });
        }
      } catch (emailErr) {
        console.error("Failed to send MFA disable alert (non-blocking):", emailErr);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // action === "request"
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error("Non authentifié");

    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("mfa_enabled, first_name")
      .eq("id", user.id)
      .single();
    if (!profile?.mfa_enabled) throw new Error("La 2FA n'est pas activée sur ce compte");

    const { data: rateOk } = await serviceClient.rpc("check_mfa_disable_rate_limit", { _user_id: user.id });
    if (rateOk === false) throw new Error("Trop de demandes. Réessaye dans une heure.");

    const { data: existing } = await serviceClient
      .from("mfa_disable_requests")
      .select("id")
      .eq("user_id", user.id)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .limit(1);
    if (existing && existing.length > 0) throw new Error("Une demande est déjà en cours. Vérifie tes emails.");

    const token = crypto.randomUUID() + "-" + crypto.randomUUID();
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip");
    const userAgent = req.headers.get("user-agent");

    const { error: insertError } = await serviceClient.from("mfa_disable_requests").insert({
      user_id: user.id,
      token,
      email: user.email!,
      ip_address: ipAddress,
      user_agent: userAgent,
    });
    if (insertError) throw insertError;

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@yunoapp.eu";
    if (!resendApiKey) throw new Error("Configuration email manquante");

    const resend = new Resend(resendApiKey);
    const origin = req.headers.get("origin") || "https://yunoapp.eu";
    const confirmUrl = `${origin}/mfa-disable-confirm?token=${token}`;
    const firstName = profile.first_name || "there";

    const emailContent = `<div style="padding:32px 24px">
      <h1 style="color:#fff;font-size:22px;margin:0 0 16px">🔓 Désactivation de la 2FA</h1>
      <p style="color:#ccc;font-size:14px;line-height:1.6;margin:0 0 8px">Salut ${firstName},</p>
      <p style="color:#ccc;font-size:14px;line-height:1.6;margin:0 0 24px">Tu as demandé à désactiver l'authentification à deux facteurs (2FA) sur ton compte Yuno. Clique sur le bouton ci-dessous pour confirmer cette action :</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px"><tr><td>
        <a href="${confirmUrl}" style="display:inline-block;background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:600;font-size:15px">Confirmer la désactivation →</a>
      </td></tr></table>
      <p style="color:#888;font-size:12px;margin:0 0 8px">⏳ Ce lien expire dans 15 minutes.</p>
      <p style="color:#dc2626;font-size:11px;word-break:break-all;margin:0 0 24px">${confirmUrl}</p>
      <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:16px">
        <p style="color:#666;font-size:11px;margin:0">⚠️ Si tu n'as pas fait cette demande, ignore cet email. Ton compte reste sécurisé.</p>
      </div>
    </div>`;

    await resend.emails.send({
      from: `Yuno Sécurité <${fromEmail}>`,
      to: [user.email!],
      subject: "🔓 Confirme la désactivation de ta 2FA — Yuno",
      html: wrapEmailWithBranding(emailContent, "fr"),
    });

    await serviceClient.from("security_logs").insert({
      user_id: user.id,
      action: "mfa_disable_requested",
      ip_address: ipAddress,
      user_agent: userAgent,
      success: true,
    });

    return new Response(JSON.stringify({ success: true, message: "Email de vérification envoyé" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Erreur mfa-disable:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur inconnue" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
