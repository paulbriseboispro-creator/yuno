import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildInvitation } from "../_shared/email-templates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_APP_ORIGIN = "https://yunoapp.eu";

const isAllowedOrigin = (origin: string) =>
  origin === "https://yuno.club" ||
  origin === DEFAULT_APP_ORIGIN ||
  origin.startsWith("http://localhost");

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
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error("Resend error:", txt);
    throw new Error(`Email delivery failed: ${txt}`);
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const appOrigin = getAppOrigin(req);
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !caller) throw new Error("Unauthorized");

    // Verify caller is admin — direct DB query with service role (same approach as invite-platform-user)
    const { data: adminRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRole) throw new Error("Admin role required");

    const { email, name, city, type, commission_rate } = await req.json();
    if (!email || !name) throw new Error("Missing required fields: email, name");

    const normalizedEmail = String(email).toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("Invalid email");
    }

    const affiliateType = type ?? "independent";
    const affiliateCity = city ?? null;
    const affiliateCommission = commission_rate ?? 0;

    console.log(`Inviting affiliate ${normalizedEmail} — ${name} (${affiliateType}, ${affiliateCity})`);

    // Check if user already exists — query profiles table
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    const existingUser = existingProfile ? { id: existingProfile.id } : null;

    if (existingUser) {
      // Create affiliate record directly
      await supabaseAdmin
        .from("affiliates")
        .upsert({
          user_id: existingUser.id,
          name,
          type: affiliateType,
          city: affiliateCity,
          commission_rate: affiliateCommission,
          created_by: caller.id,
          is_active: true,
        }, { onConflict: "user_id" });

      // Grant affiliate role
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: existingUser.id, role: "affiliate" }, { onConflict: "user_id,role" });

      if (resendApiKey) {
        try {
          const mail = buildInvitation({
            lang: "fr",
            orgName: name,
            roleLabel: "Affilié",
            acceptUrl: `${appOrigin}/auth?redirect=/affiliate`,
          });
          await sendEmail(resendApiKey, normalizedEmail, mail.subject, mail.html);
        } catch (emailErr) {
          console.error("Email notification failed (non-blocking):", emailErr);
        }
      }

      return new Response(
        JSON.stringify({ success: true, user_exists: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // No user yet — create/refresh invitation
    let { data: invitation } = await supabaseAdmin
      .from("platform_invitations")
      .select("*")
      .eq("email", normalizedEmail)
      .eq("profile_type", "affiliate")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const invitationPayload = {
      email: normalizedEmail,
      profile_type: "affiliate",
      organization_name: name,
      status: "pending",
      token: crypto.randomUUID(),
      expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      accepted_at: null,
      accepted_by: null,
      invited_by: caller.id,
    };

    if (invitation) {
      const { data: refreshed, error: refErr } = await supabaseAdmin
        .from("platform_invitations")
        .update(invitationPayload)
        .eq("id", invitation.id)
        .select()
        .single();
      if (refErr) throw refErr;
      invitation = refreshed;
    } else {
      const { data: created, error: invErr } = await supabaseAdmin
        .from("platform_invitations")
        .insert(invitationPayload)
        .select()
        .single();
      if (invErr) throw invErr;
      invitation = created;
    }

    // Store affiliate metadata for when they accept — silently skip on any error
    try {
      await supabaseAdmin
        .from("affiliate_invitations_meta")
        .upsert({
          invitation_token: invitation.token,
          affiliate_name: name,
          affiliate_type: affiliateType,
          city: affiliateCity,
          commission_rate: affiliateCommission,
          created_by: caller.id,
        }, { onConflict: "invitation_token" });
    } catch (metaErr) {
      console.warn("affiliate_invitations_meta upsert failed (non-blocking):", metaErr);
    }

    const inviteLink = `${appOrigin}/auth?invite_affiliate=${invitation.token}&email=${encodeURIComponent(normalizedEmail)}`;

    if (!resendApiKey) {
      console.warn("RESEND_API_KEY not configured — skipping invitation email");
    } else {
      try {
        const mail = buildInvitation({
          lang: "fr",
          orgName: name,
          roleLabel: "Affilié",
          acceptUrl: inviteLink,
        });
        await sendEmail(resendApiKey, normalizedEmail, mail.subject, mail.html);
        console.log(`Invitation email sent to ${normalizedEmail}`);
      } catch (emailErr) {
        // Email failure is non-blocking — the invitation is saved in DB.
        // Admin can resend from the pending invitations list.
        const emailErrMsg = emailErr instanceof Error ? emailErr.message : String(emailErr);
        console.error("Invitation email failed (non-blocking):", emailErrMsg);
        return new Response(
          JSON.stringify({
            success: true,
            user_exists: false,
            invitation_id: invitation.id,
            email_sent: false,
            email_error: emailErrMsg,
            invite_link: inviteLink,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_exists: false,
        invitation_id: invitation.id,
        email_sent: !!resendApiKey,
        invite_link: inviteLink,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in invite-affiliate:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
