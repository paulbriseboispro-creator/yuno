import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildInvitation } from "../_shared/email-templates.ts";

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

const sendEmail = async (apiKey: string, to: string, subject: string, html: string) => {
  const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "noreply@yunoapp.eu";
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
        const mail = buildInvitation({
          lang: "fr",
          orgName: organization_name,
          roleLabel: "Organisateur",
          acceptUrl: `${appOrigin}/auth?redirect=/organizer-app`,
        });
        await sendEmail(resendApiKey, normalizedEmail, mail.subject, mail.html);
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
      const expiresLabel = invitation.expires_at
        ? new Date(invitation.expires_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
        : undefined;
      const mail = buildInvitation({
        lang: "fr",
        orgName: organization_name,
        roleLabel: "Organisateur",
        acceptUrl: inviteLink,
        expiresLabel,
      });
      await sendEmail(resendApiKey, normalizedEmail, mail.subject, mail.html);
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
