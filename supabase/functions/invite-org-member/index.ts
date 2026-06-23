import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildInvitation } from "../_shared/email-templates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("Authorization");
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, role } = await req.json();
    if (!email || !role || !["admin", "editor", "scanner"].includes(role)) {
      return new Response(JSON.stringify({ error: "Missing or invalid fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Get inviter profile (must be organizer/BDE)
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("profile_type, organization_name")
      .eq("id", user.id)
      .maybeSingle();

    // 'bde' / 'private_organizer' kept for legacy DB rows that may not yet be migrated.
    if (!profile || !["organizer", "bde", "private_organizer"].includes(profile.profile_type)) {
      return new Response(JSON.stringify({ error: "Only organizers can invite team members" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check existing
    const { data: existing } = await supabaseAdmin
      .from("org_members")
      .select("id")
      .eq("organizer_user_id", user.id)
      .eq("member_email", normalizedEmail)
      .eq("invitation_status", "pending")
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ error: "Une invitation est déjà en attente pour cet email." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user already exists
    const { data: existingMember } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    const { data: invitation, error: invError } = await supabaseAdmin
      .from("org_members")
      .insert({
        organizer_user_id: user.id,
        member_user_id: existingMember?.id ?? null,
        member_email: normalizedEmail,
        role,
        invited_by: user.id,
      })
      .select()
      .single();

    if (invError) throw invError;

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const appUrl = "https://yunoapp.eu";

    if (resendApiKey) {
      const acceptUrl = `${appUrl}/accept-org-member?token=${invitation.invitation_token}`;
      const roleLabel = role === "admin" ? "Administrateur" : role === "editor" ? "Éditeur" : "Scanner";

      const mail = buildInvitation({
        lang: "fr",
        orgName: profile.organization_name,
        roleLabel,
        acceptUrl,
      });

      const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "noreply@yunoapp.eu";
      const from = resendFromEmail.includes("<") ? resendFromEmail : `Yuno <${resendFromEmail}>`;

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [normalizedEmail],
          subject: mail.subject,
          html: mail.html,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error("invite-org-member email send failed:", res.status, body);
        return new Response(JSON.stringify({ error: "Échec de l'envoi de l'invitation par email" }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, invitation_id: invitation.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in invite-org-member:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
