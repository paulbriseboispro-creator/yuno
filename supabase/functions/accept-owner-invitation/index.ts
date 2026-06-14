import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const { invitation_token } = await req.json();

    if (!invitation_token) {
      throw new Error("Invitation token is required");
    }

    console.log(`Accepting invitation for user: ${user.email}`);

    // Verify invitation using secure database function (prevents token enumeration)
    const { data: verifyResult, error: verifyError } = await supabaseAdmin
      .rpc("verify_invitation_token", { 
        _token: invitation_token, 
        _email: user.email 
      });

    if (verifyError) {
      console.error("Error verifying invitation:", verifyError);
      throw new Error("Failed to verify invitation");
    }

    const invitation = verifyResult?.[0];
    if (!invitation || !invitation.is_valid) {
      console.error("Invitation not found, expired, or email mismatch");
      throw new Error("Invitation invalide ou expirée");
    }

    // Add owner role
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({
        user_id: user.id,
        role: "owner",
        email: user.email,
      }, { onConflict: "user_id,role" });

    if (roleError) {
      console.error("Error adding role:", roleError);
      throw new Error("Failed to add owner role");
    }

    // Assign venue to user
    const { error: venueError } = await supabaseAdmin
      .from("venues")
      .update({ owner_id: user.id })
      .eq("id", invitation.venue_id);

    if (venueError) {
      console.error("Error assigning venue:", venueError);
      throw new Error("Failed to assign venue");
    }

    // Update profile venue_id
    await supabaseAdmin
      .from("profiles")
      .update({ venue_id: invitation.venue_id })
      .eq("id", user.id);

    // Mark invitation as accepted
    await supabaseAdmin
      .from("owner_invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invitation.invitation_id);

    console.log(`Owner invitation accepted successfully for ${user.email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Invitation acceptée! Vous êtes maintenant propriétaire.",
        venue_id: invitation.venue_id
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in accept-owner-invitation:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
