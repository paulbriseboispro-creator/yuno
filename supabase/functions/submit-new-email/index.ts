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

    const { request_id, new_email, origin } = await req.json();
    if (!request_id || !new_email) throw new Error("Missing fields");

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(new_email)) throw new Error("Invalid email format");

    // Verify the request belongs to the user and is in the right status
    const { data: request, error: fetchError } = await supabaseAdmin
      .from("email_change_requests")
      .select("*")
      .eq("id", request_id)
      .eq("user_id", user.id)
      .eq("status", "pending_new_email")
      .single();

    if (fetchError || !request) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Check if new email is already in use
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const emailInUse = existingUsers?.users?.some(
      (u) => u.email?.toLowerCase() === new_email.toLowerCase() && u.id !== user.id
    );
    if (emailInUse) {
      return new Response(JSON.stringify({ error: "Email already in use" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Generate new token for new email verification
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

    const verifyUrl = `${origin}/settings?email_change_token=${newToken}`;

    const subjects: Record<EmailLanguage, string> = {
      fr: "Confirme ta nouvelle adresse email",
      en: "Confirm your new email address",
      es: "Confirma tu nueva dirección de email",
    };

    const bodies: Record<EmailLanguage, string> = {
      fr: `
        <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Nouvelle adresse email</h1>
        </div>
        <div style="padding: 32px;">
          <p style="color: #a0a0a0; line-height: 1.6;">Clique sur le bouton ci-dessous pour confirmer ta nouvelle adresse email.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #fff !important; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: bold; font-size: 16px;">
              Confirmer →
            </a>
          </div>
          <p style="color: #666; font-size: 12px;">Ce lien expire dans 15 minutes.</p>
        </div>`,
      en: `
        <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">New Email Address</h1>
        </div>
        <div style="padding: 32px;">
          <p style="color: #a0a0a0; line-height: 1.6;">Click the button below to confirm your new email address.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #fff !important; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: bold; font-size: 16px;">
              Confirm →
            </a>
          </div>
          <p style="color: #666; font-size: 12px;">This link expires in 15 minutes.</p>
        </div>`,
      es: `
        <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Nueva dirección de email</h1>
        </div>
        <div style="padding: 32px;">
          <p style="color: #a0a0a0; line-height: 1.6;">Haz clic en el botón de abajo para confirmar tu nueva dirección de email.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #fff !important; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: bold; font-size: 16px;">
              Confirmar →
            </a>
          </div>
          <p style="color: #666; font-size: 12px;">Este enlace expira en 15 minutos.</p>
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
        to: [new_email],
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
    console.error("Error in submit-new-email:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
