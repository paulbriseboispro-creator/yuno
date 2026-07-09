import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { restrictedCorsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Non authentifié" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Non authentifié" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Check for active (unpaid/pending) purchases before deletion.
    const { data: activePurchases } = await supabaseAdmin
      .from("purchases")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ["pending", "processing"])
      .limit(1);

    if (activePurchases?.length) {
      return new Response(
        JSON.stringify({ error: "Des achats sont en cours. Contactez le support pour clôturer avant de supprimer votre compte." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // 1. Delete Vault MFA secret if present.
    await supabaseAdmin.rpc("delete_mfa_totp_secret", { p_user_id: user.id }).catch(() => {});

    // 2. Delete personal data rows (cascade handles child tables where FK exists).
    await supabaseAdmin.from("mfa_recovery_codes").delete().eq("user_id", user.id);
    await supabaseAdmin.from("mfa_pending").delete().eq("user_id", user.id);
    await supabaseAdmin.from("push_subscriptions").delete().eq("user_id", user.id);
    await supabaseAdmin.from("loyalty_points").delete().eq("user_id", user.id);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", user.id);
    await supabaseAdmin.from("waitlist_entries").delete().eq("user_id", user.id);
    await supabaseAdmin.from("visitor_sessions").delete().eq("user_id", user.id);
    await supabaseAdmin.from("attribution_touchpoints").delete().eq("user_id", user.id);

    // 3. Anonymize the profile (keep the row for FK integrity on historical orders).
    await supabaseAdmin
      .from("profiles")
      .update({
        first_name: "Compte",
        last_name: "Supprimé",
        email: `deleted-${user.id}@deleted.local`,
        phone: null,
        avatar_url: null,
        employee_pin: null,
        mfa_enabled: false,
        mfa_verified_at: null,
      })
      .eq("id", user.id);

    // 4. Delete the Supabase Auth account (irreversible).
    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteAuthError) throw deleteAuthError;

    await supabaseAdmin.from("security_logs").insert({
      user_id: user.id,
      action: "account_deleted",
      ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
      user_agent: req.headers.get("user-agent"),
      success: true,
    }).catch(() => {});

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[delete-account]", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur serveur" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
