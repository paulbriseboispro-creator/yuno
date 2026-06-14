import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { terms_version, context, guest_email, venue_id } = await req.json();

    if (!terms_version) {
      return new Response(
        JSON.stringify({ error: "terms_version is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ip_address =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;
    const user_agent = req.headers.get("user-agent") || null;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Try to get user from JWT
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data } = await supabaseUser.auth.getClaims(token);
      if (data?.claims?.sub) {
        userId = data.claims.sub;
      }
    }

    if (!userId && !guest_email) {
      return new Response(
        JSON.stringify({ error: "Either authentication or guest_email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const record = {
      terms_version,
      context: context || null,
      venue_id: venue_id || null,
      ip_address,
      user_agent,
      accepted_at: new Date().toISOString(),
    };

    if (userId) {
      // Check if already exists
      const { data: existing } = await supabaseAdmin
        .from("terms_acceptances")
        .select("id")
        .eq("user_id", userId)
        .eq("terms_version", terms_version)
        .maybeSingle();

      if (existing) {
        // Update existing
        await supabaseAdmin
          .from("terms_acceptances")
          .update({ ...record, user_id: userId })
          .eq("id", existing.id);
      } else {
        const { error } = await supabaseAdmin
          .from("terms_acceptances")
          .insert({ ...record, user_id: userId });
        if (error) throw error;
      }
    } else {
      // Guest
      const { data: existing } = await supabaseAdmin
        .from("terms_acceptances")
        .select("id")
        .eq("guest_email", guest_email)
        .eq("terms_version", terms_version)
        .maybeSingle();

      if (existing) {
        await supabaseAdmin
          .from("terms_acceptances")
          .update({ ...record, guest_email })
          .eq("id", existing.id);
      } else {
        const { error } = await supabaseAdmin
          .from("terms_acceptances")
          .insert({ ...record, guest_email });
        if (error) throw error;
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error recording terms acceptance:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
