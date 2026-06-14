import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_APP_ORIGIN = "https://yunoapp.eu";

const isAllowedOrigin = (origin: string) => {
  if (origin === "https://yuno.club") return true;
  if (origin === DEFAULT_APP_ORIGIN) return true;
  if (origin.startsWith("http://localhost")) return true;
  return false;
};

const getAppOrigin = (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && isAllowedOrigin(origin)) return origin;
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (isAllowedOrigin(refOrigin)) return refOrigin;
    } catch { /* ignore */ }
  }
  return DEFAULT_APP_ORIGIN;
};

const brandedEmail = (opts: {
  title: string;
  intro: string;
  body: string;
  cta: { label: string; url: string };
  expireNote?: string;
}) => `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background: #ffffff; color: #1a1a1a; -webkit-font-smoothing: antialiased; }
      .wrapper { background: #ffffff; padding: 40px 20px; }
      .container { max-width: 480px; margin: 0 auto; }
      .logo { font-size: 15px; font-weight: 800; letter-spacing: 4px; color: #dc2626; margin-bottom: 32px; }
      .divider { height: 3px; width: 40px; background: #dc2626; border-radius: 2px; margin-bottom: 32px; }
      h1 { color: #0a0a0a; margin: 0 0 20px 0; font-size: 26px; font-weight: 700; line-height: 1.2; letter-spacing: -0.3px; }
      .body-text { color: #4a4a4a; line-height: 1.7; margin: 0 0 16px 0; font-size: 15px; }
      .accent { color: #dc2626; font-weight: 600; }
      .button-wrap { text-align: center; margin: 36px 0; }
      .button { display: inline-block; background: #dc2626; color: #ffffff !important; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-weight: 600; font-size: 15px; letter-spacing: 0.3px; }
      .expire { background: #fef9f0; border-radius: 8px; padding: 14px 18px; margin: 24px 0; border-left: 4px solid #f59e0b; }
      .expire p { color: #92660d; margin: 0; font-size: 13px; font-weight: 500; }
      .footer { margin-top: 40px; padding-top: 24px; border-top: 1px solid #e5e5e5; }
      .footer p { color: #999; font-size: 12px; margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="container">
        <div class="logo">YUNO</div>
        <div class="divider"></div>
        <h1>${opts.title}</h1>
        <p class="body-text">${opts.intro}</p>
        <p class="body-text">${opts.body}</p>
        <div class="button-wrap">
          <a href="${opts.cta.url}" class="button">${opts.cta.label} →</a>
        </div>
        ${opts.expireNote ? `<div class="expire"><p>⏱️ ${opts.expireNote}</p></div>` : ""}
        <div class="footer">
          <p>L'équipe Yuno — yunoapp.eu</p>
        </div>
      </div>
    </div>
  </body>
  </html>
`;

const sendEmail = async (apiKey: string, to: string, subject: string, html: string) => {
  const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "onboarding@resend.dev";
  const from = resendFromEmail.includes("<") ? resendFromEmail : `Yuno <${resendFromEmail}>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error("Resend error:", txt);
    throw new Error("Email delivery failed");
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const appOrigin = getAppOrigin(req);
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller is super admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !caller) throw new Error("Unauthorized");

    const { data: adminRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRole) throw new Error("Admin role required");

    const { email, organization_name } = await req.json();
    if (!email || !organization_name) throw new Error("Missing required fields");

    const normalizedEmail = String(email).toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("Invalid email");
    }

    console.log(`Inviting organizer ${normalizedEmail} for ${organization_name}`);

    // Look for an existing user — query profiles (avoids listUsers pagination limit)
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    const existingUser = existingProfile ? { id: existingProfile.id } : null;

    if (existingUser) {
      // Apply organizer profile directly
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .update({
          profile_type: "organizer",
          organization_name,
          onboarding_completed: true,
        })
        .eq("id", existingUser.id);
      if (profileError) throw profileError;

      // Bootstrap public organizer profile (idempotent)
      await supabaseAdmin
        .from("organizer_profiles")
        .upsert(
          { user_id: existingUser.id, display_name: organization_name },
          { onConflict: "user_id" }
        );

      if (resendApiKey) {
        await sendEmail(
          resendApiKey,
          normalizedEmail,
          `Votre espace Organisateur Yuno est prêt — ${organization_name}`,
          brandedEmail({
            title: "Votre espace organisateur est activé",
            intro: `Votre compte Yuno est désormais lié à <span class="accent">${organization_name}</span>.`,
            body: "Connectez-vous pour accéder à votre tableau de bord organisateur, créer vos événements et gérer vos billetteries.",
            cta: { label: "Accéder à mon espace", url: `${appOrigin}/auth?redirect=/organizer-app` },
          })
        );
      }

      return new Response(
        JSON.stringify({ success: true, user_exists: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // No user yet → create / refresh invitation, send signup link
    // Reuse the most recent invitation (pending, revoked, or expired) and reactivate it
    let { data: invitation } = await supabaseAdmin
      .from("platform_invitations")
      .select("*")
      .eq("email", normalizedEmail)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (invitation) {
      const { data: refreshed, error: refErr } = await supabaseAdmin
        .from("platform_invitations")
        .update({
          organization_name,
          status: "pending",
          token: crypto.randomUUID(),
          expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          accepted_at: null,
          accepted_by: null,
        })
        .eq("id", invitation.id)
        .select()
        .single();
      if (refErr) throw refErr;
      invitation = refreshed;
    } else {
      const { data: created, error: invErr } = await supabaseAdmin
        .from("platform_invitations")
        .insert({
          email: normalizedEmail,
          profile_type: "organizer",
          organization_name,
          invited_by: caller.id,
        })
        .select()
        .single();
      if (invErr) throw invErr;
      invitation = created;
    }

    if (resendApiKey) {
      const inviteLink = `${appOrigin}/auth?invite_platform=${invitation.token}&email=${encodeURIComponent(normalizedEmail)}`;
      await sendEmail(
        resendApiKey,
        normalizedEmail,
        `Invitation Yuno — devenez organisateur de ${organization_name}`,
        brandedEmail({
          title: "Bienvenue sur Yuno",
          intro: `Vous êtes invité à rejoindre Yuno en tant qu'organisateur pour <span class="accent">${organization_name}</span>.`,
          body: "Créez votre compte en un clic et accédez immédiatement à votre tableau de bord organisateur : événements, billetterie, scans, statistiques.",
          cta: { label: "Activer mon compte", url: inviteLink },
          expireNote: "Cette invitation expire dans 14 jours.",
        })
      );
    } else {
      console.warn("RESEND_API_KEY not configured, skipping email");
    }

    return new Response(
      JSON.stringify({ success: true, user_exists: false, invitation_id: invitation.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in invite-platform-user:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
