import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { verifyPin } from "../_shared/pin-hash.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with user's auth
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      console.error("Auth error:", userError);
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { pin, allowedRoles } = await req.json();

    if (!pin || typeof pin !== "string" || pin.length !== 6) {
      return new Response(
        JSON.stringify({ error: "Invalid PIN format", success: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client for database operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Get user's profile with PIN and venue_id
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("employee_pin, venue_id")
      .eq("id", user.id)
      .single();

    if (profileError) {
      console.error("Profile error:", profileError);
      return new Response(
        JSON.stringify({ error: "Failed to verify PIN", success: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if PIN is set
    if (!profile.employee_pin) {
      console.log("PIN verification failed - no PIN set for user:", user.id);
      return new Response(
        JSON.stringify({ success: false, message: "No PIN configured" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify PIN using the hash function
    const pinMatches = await verifyPin(pin, profile.employee_pin);

    if (!pinMatches) {
      console.log("PIN verification failed for user:", user.id);
      return new Response(
        JSON.stringify({ success: false, message: "Invalid PIN" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user has one of the allowed roles
    const rolesToCheck = allowedRoles || ['barman', 'bouncer', 'manager', 'dj', 'promoter', 'organizer'];
    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", rolesToCheck);

    if (rolesError) {
      console.error("Roles error:", rolesError);
      return new Response(
        JSON.stringify({ error: "Failed to verify role", success: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!roles || roles.length === 0) {
      return new Response(
        JSON.stringify({ error: "Unauthorized role", success: false }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const verifiedRole = roles[0].role;
    console.log("PIN verified successfully for user:", user.id, "role:", verifiedRole);

    return new Response(
      JSON.stringify({ 
        success: true, 
        venueId: profile.venue_id,
        role: verifiedRole 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in verify-pin:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Server error", success: false }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
