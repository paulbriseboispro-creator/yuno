import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();
    if (!token) throw new Error("Missing token");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Find the request by token
    const { data: request, error } = await supabaseAdmin
      .from("email_change_requests")
      .select("*")
      .eq("token", token)
      .single();

    if (error || !request) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Check expiry
    if (new Date(request.expires_at) < new Date()) {
      await supabaseAdmin
        .from("email_change_requests")
        .update({ status: "expired" })
        .eq("id", request.id);
      return new Response(JSON.stringify({ error: "Token expired" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (request.status === "pending_old_verification") {
      // Step 1: old email verified -> allow user to enter new email
      await supabaseAdmin
        .from("email_change_requests")
        .update({
          status: "pending_new_email",
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        })
        .eq("id", request.id);

      return new Response(
        JSON.stringify({ success: true, status: "pending_new_email", request_id: request.id }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (request.status === "pending_new_verification") {
      // Step 3: new email verified -> update auth email
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(request.user_id, {
        email: request.new_email,
      });

      if (updateError) throw updateError;

      // Update profile email too
      await supabaseAdmin
        .from("profiles")
        .update({ email: request.new_email })
        .eq("id", request.user_id);

      await supabaseAdmin
        .from("email_change_requests")
        .update({ status: "completed" })
        .eq("id", request.id);

      return new Response(
        JSON.stringify({ success: true, status: "completed" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    return new Response(JSON.stringify({ error: "Invalid request status" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in verify-email-change:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
