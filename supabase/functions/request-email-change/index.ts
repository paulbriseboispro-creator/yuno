import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { wrapEmailWithBranding, type EmailLanguage } from "../_shared/email-branding.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) throw new Error("Not authenticated");

    const { origin } = await req.json();

    // Expire any previous pending requests
    await supabaseAdmin
      .from("email_change_requests")
      .update({ status: "expired" })
      .eq("user_id", user.id)
      .in("status", ["pending_old_verification", "pending_new_email", "pending_new_verification"]);

    // Create new request
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

    // Get user language
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

    const bodies: Record<EmailLanguage, string> = {
      fr: `
        <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Changement d'email</h1>
        </div>
        <div style="padding: 32px;">
          <p style="color: #a0a0a0; line-height: 1.6;">Tu as demandé à changer ton adresse email. Clique sur le bouton ci-dessous pour confirmer que c'est bien toi.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #fff !important; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: bold; font-size: 16px;">
              Confirmer →
            </a>
          </div>
          <p style="color: #666; font-size: 12px;">Ce lien expire dans 15 minutes. Si tu n'as pas fait cette demande, ignore cet email.</p>
        </div>`,
      en: `
        <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Email Change</h1>
        </div>
        <div style="padding: 32px;">
          <p style="color: #a0a0a0; line-height: 1.6;">You requested to change your email address. Click the button below to confirm it's you.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #fff !important; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: bold; font-size: 16px;">
              Confirm →
            </a>
          </div>
          <p style="color: #666; font-size: 12px;">This link expires in 15 minutes. If you didn't make this request, ignore this email.</p>
        </div>`,
      es: `
        <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Cambio de email</h1>
        </div>
        <div style="padding: 32px;">
          <p style="color: #a0a0a0; line-height: 1.6;">Has solicitado cambiar tu dirección de email. Haz clic en el botón de abajo para confirmar que eres tú.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #fff !important; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: bold; font-size: 16px;">
              Confirmar →
            </a>
          </div>
          <p style="color: #666; font-size: 12px;">Este enlace expira en 15 minutos. Si no hiciste esta solicitud, ignora este email.</p>
        </div>`,
    };

    const html = wrapEmailWithBranding(bodies[lang], lang);

    const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
    const from = rawFrom
      ? rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`
      : "Yuno <onboarding@resend.dev>";

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from,
        to: [user.email],
        subject: subjects[lang],
        html,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      throw new Error(`Resend error: ${err}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in request-email-change:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
