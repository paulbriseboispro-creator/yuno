import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";
import { wrapEmailWithBranding } from "../_shared/email-branding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};


serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Verify user has an eligible role
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["dj", "promoter", "organizer"]);

    if (!roles || roles.length === 0) {
      return new Response(
        JSON.stringify({ error: "Unauthorized role", success: false }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate secure token
    const token = crypto.randomUUID() + "-" + crypto.randomUUID();

    // Store token
    const { error: insertError } = await supabaseAdmin
      .from("pin_reset_tokens")
      .insert({
        user_id: user.id,
        token,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
      });

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create reset token", success: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get profile name for personalized email
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("first_name")
      .eq("id", user.id)
      .single();

    const firstName = profile?.first_name || "";
    const resetUrl = `https://yunoapp.eu/reset-pin?token=${token}`;

    const emailContent = `
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 32px 24px;">
            <h1 style="color: #fff; font-size: 22px; font-weight: 700; margin: 0 0 16px;">
              🔐 Réinitialisation de ton code PIN
            </h1>
            ${firstName ? `<p style="color: #ccc; font-size: 15px; margin: 0 0 20px;">Salut ${firstName},</p>` : ''}
            <p style="color: #aaa; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
              Tu as demandé à réinitialiser ton code PIN. Clique sur le bouton ci-dessous pour en créer un nouveau.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin: 0 auto 24px;">
              <tr>
                <td>
                  <a href="${resetUrl}" 
                     style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 14px;">
                    Réinitialiser mon PIN →
                  </a>
                </td>
              </tr>
            </table>
            <p style="color: #666; font-size: 12px; line-height: 1.5; margin: 0 0 8px;">
              Ce lien expire dans 1 heure. Si tu n'as pas fait cette demande, ignore cet email.
            </p>
            <p style="color: #444; font-size: 11px; margin: 16px 0 0; word-break: break-all;">
              Si le bouton ne fonctionne pas : ${resetUrl}
            </p>
          </td>
        </tr>
      </table>
    `;

    const html = wrapEmailWithBranding(emailContent, 'fr');

    // Send email via Resend
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "Yuno <noreply@yunoapp.eu>";

    if (!RESEND_API_KEY) {
      console.error("Missing email configuration");
      return new Response(
        JSON.stringify({ error: "Email service not configured", success: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [user.email],
        subject: "🔐 Réinitialisation de ton code PIN — Yuno",
        html,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      console.error("Email send error:", errBody);
      return new Response(
        JSON.stringify({ error: "Failed to send email", success: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("PIN reset email sent to:", user.email);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in request-pin-reset:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Server error", success: false }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
