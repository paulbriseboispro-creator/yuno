// admin-account-recovery — recovery pro déclenché par un super admin.
// Action 'reset-password' : génère un lien de réinitialisation (GoTrue admin) et
// l'envoie par email au pro verrouillé. Le reset MFA se fait via la RPC
// admin_reset_user_mfa ; la suspension via admin_set_user_suspended.
//
// NB déploiement : occupe le slot edge libéré par l'ancienne fonction superseded
// `db-cleanup` (le cap edge limite le NOMBRE de fonctions, pas les mises à jour).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { wrapEmailWithBranding } from "../_shared/email-branding.ts";
import { restrictedCorsHeaders } from "../_shared/cors.ts";

const APP_URL = "https://yunoapp.eu";

type Lang = "en" | "fr" | "es";

const COPY: Record<Lang, { subject: string; title: string; body: string; cta: string; ignore: string }> = {
  fr: {
    subject: "Réinitialisation de votre mot de passe Yuno",
    title: "Réinitialisez votre mot de passe",
    body: "L'équipe Yuno a initié une réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.",
    cta: "Choisir un nouveau mot de passe",
    ignore: "Si vous n'avez rien demandé, contactez support@yunoapp.eu.",
  },
  en: {
    subject: "Reset your Yuno password",
    title: "Reset your password",
    body: "The Yuno team initiated a password reset for your account. Click the button below to choose a new one.",
    cta: "Choose a new password",
    ignore: "If you didn't request this, contact support@yunoapp.eu.",
  },
  es: {
    subject: "Restablece tu contraseña de Yuno",
    title: "Restablece tu contraseña",
    body: "El equipo de Yuno inició un restablecimiento de tu contraseña. Haz clic en el botón para elegir una nueva.",
    cta: "Elegir una nueva contraseña",
    ignore: "Si no lo solicitaste, contacta support@yunoapp.eu.",
  },
};

serve(async (req) => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) throw new Error("Not authenticated");

    // Garde : seul un super admin peut déclencher une recovery.
    const { data: adminRole } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!adminRole) throw new Error("Admin role required");

    const { action, userId } = await req.json();
    if (!userId) throw new Error("userId is required");
    if (action !== "reset-password") throw new Error("Invalid action");

    const { data: target } = await supabaseAdmin
      .from("profiles").select("email, preferred_language").eq("id", userId).maybeSingle();
    if (!target?.email) throw new Error("Target user not found");

    const lang: Lang = (["en", "es", "fr"].includes(target.preferred_language) ? target.preferred_language : "fr") as Lang;
    const copy = COPY[lang];

    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: target.email,
      options: { redirectTo: `${APP_URL}/auth` },
    });
    if (linkErr) throw linkErr;
    const actionLink = linkData?.properties?.action_link;
    if (!actionLink) throw new Error("Could not generate recovery link");

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@yunoapp.eu";
    let emailSent = false;
    if (resendApiKey) {
      const content = `
        <div style="padding: 32px 24px;">
          <h1 style="color:#fff;font-size:22px;margin:0 0 16px;">${copy.title}</h1>
          <p style="color:#ccc;font-size:14px;line-height:1.6;margin:0 0 24px;">${copy.body}</p>
          <a href="${actionLink}" style="display:inline-block;background:#E8192C;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px;">${copy.cta}</a>
          <p style="color:#888;font-size:12px;line-height:1.6;margin:24px 0 0;">${copy.ignore}</p>
        </div>`;
      const html = wrapEmailWithBranding(content, lang);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}` },
        body: JSON.stringify({ from: `Yuno <${fromEmail}>`, to: [target.email], subject: copy.subject, html }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("[ADMIN-ACCOUNT-RECOVERY] Resend send failed:", res.status, body);
        return new Response(
          JSON.stringify({ error: "Échec de l'envoi de l'email de récupération" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 }
        );
      }
      emailSent = true;
    }

    // Journal d'audit
    await supabaseAdmin.from("admin_audit_log").insert({
      admin_id: user.id,
      action: "password_reset_sent",
      entity_type: "profile",
      entity_id: userId,
      metadata: { email: target.email },
    });

    return new Response(JSON.stringify({ success: true, emailSent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[ADMIN-ACCOUNT-RECOVERY] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
