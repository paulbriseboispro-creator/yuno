import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { buildInvitation } from "../_shared/email-templates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_APP_ORIGIN = "https://yunoapp.eu";

const isAllowedOrigin = (origin: string) => {
  // Keep this tight: we only use it to build onboarding links in admin-triggered emails.
  // This prevents an attacker from using an admin session to send phishing links.
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
    } catch {
      // ignore
    }
  }

  return DEFAULT_APP_ORIGIN;
};

interface InviteOwnerRequest {
  email: string;
  venue_id: string;
  venue_name: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const appOrigin = getAppOrigin(req);

    // Create admin client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller is super admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !caller) {
      throw new Error("Unauthorized");
    }

    // Check if caller has admin role in user_roles table
    const { data: adminRole, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError) {
      console.error("Error checking admin role:", roleError);
      throw new Error("Failed to verify admin status");
    }

    if (!adminRole) {
      throw new Error("Only super admins can invite owners");
    }
    
    console.log(`Super admin ${caller.email} is inviting an owner`);

    const { email, venue_id, venue_name }: InviteOwnerRequest = await req.json();

    if (!email || !venue_id) {
      throw new Error("Email and venue_id are required");
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("Invalid email");
    }

    console.log(`Inviting owner: ${normalizedEmail} for venue: ${venue_id}`);

    // Check if user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find((u: any) => (u.email || "").toLowerCase() === normalizedEmail);

    if (existingUser) {
      console.log(`User ${email} already exists, assigning as owner`);
      
      // Add owner role if not exists
      const { error: roleError } = await supabaseAdmin
        .from("user_roles")
        .upsert({
          user_id: existingUser.id,
          role: "owner",
          email: normalizedEmail,
        }, { onConflict: "user_id,role" });

      if (roleError) {
        console.error("Error adding role:", roleError);
        throw new Error("Failed to add owner role");
      }

      // Assign venue to user
      const { error: venueError } = await supabaseAdmin
        .from("venues")
        .update({ owner_id: existingUser.id })
        .eq("id", venue_id);

      if (venueError) {
        console.error("Error assigning venue:", venueError);
        throw new Error("Failed to assign venue");
      }

      // Update profile venue_id + reset MFA so they go through fresh onboarding
      await supabaseAdmin
        .from("profiles")
        .update({ venue_id: venue_id, mfa_enabled: false, mfa_enforced: false })
        .eq("id", existingUser.id);

      // Clear old MFA credentials
      await Promise.all([
        supabaseAdmin.from("mfa_pending").delete().eq("user_id", existingUser.id),
        supabaseAdmin.from("mfa_recovery_codes").delete().eq("user_id", existingUser.id),
        supabaseAdmin.from("mfa_disable_requests").delete().eq("user_id", existingUser.id),
      ]);

      // Send notification email with Yuno branding
      if (resendApiKey) {
        const resend = new Resend(resendApiKey);
        const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "noreply@yunoapp.eu";
        const from = resendFromEmail.includes("<")
          ? resendFromEmail
          : `Yuno <${resendFromEmail}>`;
        const mail = buildInvitation({
          lang: "fr",
          orgName: venue_name,
          roleLabel: "Propriétaire",
          acceptUrl: `${appOrigin}/auth`,
        });
        const emailResponse = await resend.emails.send({
          from,
          to: [normalizedEmail],
          subject: mail.subject,
          html: mail.html,
        });
        // Resend returns { data, error }
        if ((emailResponse as any)?.error) {
          console.error("Resend error (existing user):", (emailResponse as any).error);
          throw new Error((emailResponse as any).error.message || "Email delivery failed");
        }
        console.log("Notification email sent to existing user", emailResponse);
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Propriétaire assigné avec succès",
          user_exists: true 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // User doesn't exist - create invitation
    console.log(`User ${normalizedEmail} doesn't exist, creating invitation`);

    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from("owner_invitations")
      .insert({
        venue_id,
        email: normalizedEmail,
      })
      .select()
      .single();

    if (inviteError) {
      console.error("Error creating invitation:", inviteError);
      throw new Error("Failed to create invitation");
    }

    // Send invitation email with Yuno branding
    if (resendApiKey) {
      const resend = new Resend(resendApiKey);
      const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "noreply@yunoapp.eu";
      const from = resendFromEmail.includes("<")
        ? resendFromEmail
        : `Yuno <${resendFromEmail}>`;
      const inviteLink = `${appOrigin}/auth?invite=${invitation.token}`;
      const mail = buildInvitation({
        lang: "fr",
        orgName: venue_name,
        roleLabel: "Propriétaire",
        acceptUrl: inviteLink,
      });

      const emailResponse = await resend.emails.send({
        from,
        to: [normalizedEmail],
        subject: mail.subject,
        html: mail.html,
      });
      if ((emailResponse as any)?.error) {
        console.error("Resend error (invitation):", (emailResponse as any).error);
        throw new Error((emailResponse as any).error.message || "Email delivery failed");
      }
      console.log("Invitation email sent", emailResponse);
    } else {
      console.warn("RESEND_API_KEY not configured, skipping email");
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Invitation envoyée avec succès",
        user_exists: false,
        invitation_token: invitation.token
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in invite-owner:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
