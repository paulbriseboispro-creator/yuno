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
        JSON.stringify({
          code: "active_purchases",
          error: "Des achats sont en cours. Contactez le support pour clôturer avant de supprimer votre compte.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Un compte qui EST une entité (club, agence) ne peut pas s'effacer seul :
    // `venues.owner_id` et `affiliates.user_id` sont l'identité du tenant, pas une
    // trace d'activité. L'effacer orphelinerait le club/l'agence, ses employés et
    // son historique de ventes. On refuse avec un motif que le front sait traduire,
    // plutôt que de laisser la contrainte FK remonter en 500 illisible.
    const { data: ownedVenues } = await supabaseAdmin
      .from("venues")
      .select("id")
      .eq("owner_id", user.id)
      .limit(1);

    if (ownedVenues?.length) {
      return new Response(
        JSON.stringify({
          code: "owns_venue",
          error: "Ce compte est propriétaire d'un établissement. Transférez-le ou demandez sa clôture au support avant de supprimer le compte.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const { data: ownedAffiliates } = await supabaseAdmin
      .from("affiliates")
      .select("id")
      .eq("user_id", user.id)
      .limit(1);

    if (ownedAffiliates?.length) {
      return new Response(
        JSON.stringify({
          code: "owns_agency",
          error: "Ce compte est propriétaire d'une agence. Transférez-la ou demandez sa clôture au support avant de supprimer le compte.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // 1. Delete Vault MFA secret if present (best-effort : le builder supabase-js
    // ne rejette jamais — l'erreur revient dans { error }, ignorée ici).
    await supabaseAdmin.rpc("delete_mfa_totp_secret", { p_user_id: user.id });

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

    // 3b. Anonymize the club CRM rows (venue_customers) : email/nom/téléphone du
    // compte supprimé y vivaient dans le CRM de CHAQUE club visité, sans être
    // touchés par la suppression — contradiction avec la promesse d'effacement
    // faite dans l'app (RGPD art. 17). On garde la ligne (le total dépensé /
    // palier reste utile au club en agrégat) mais on retire l'identité. `email`
    // est NOT NULL → placeholder, comme pour le profil.
    await supabaseAdmin
      .from("venue_customers")
      .update({
        email: `deleted-${user.id}@deleted.local`,
        first_name: "Compte",
        last_name: "Supprimé",
        phone: null,
      })
      .eq("user_id", user.id);

    // 3c. Détacher les références « auteur » qui BLOQUENT la suppression auth.
    // Ces colonnes pointent vers auth.users en ON DELETE NO ACTION : tant qu'une
    // seule ligne existe, `admin.deleteUser` lève une violation de contrainte et
    // la suppression échoue en 500. C'est le cas de la plupart des comptes pro
    // (un barman qui a pris une commande, un hôte VIP qui a saisi une conso) et
    // même de clients (une demande de boisson, un signalement). On efface le lien
    // vers la personne, jamais la ligne métier — la commande, la conso et la
    // statistique du club restent, sans auteur nommé.
    const detach: [string, string][] = [
      ["affiliate_clicks", "user_id"],
      ["affiliate_invitations_meta", "created_by"],
      ["affiliate_members", "invited_by"],
      ["affiliates", "created_by"],
      ["app_settings", "updated_by"],
      ["chatbot_training", "created_by"],
      ["dj_team_invitations", "member_user_id"],
      ["drink_catalog", "created_by"],
      ["feedback_issues", "reported_by"],
      ["feedback_issues", "assigned_to"],
      ["orders", "prep_claimed_by"],
      ["vip_consumptions", "staff_id"],
      ["vip_upsell_stats", "staff_id"],
    ];

    // Mêmes contraintes bloquantes, mais colonne NOT NULL : impossible de
    // détacher, et la ligne n'a aucun sens sans son auteur (une invitation
    // envoyée par un compte disparu, une demande de boisson d'un compte parti).
    const purge: [string, string][] = [
      ["dj_team_invitations", "invited_by"],
      ["drink_requests", "requested_by"],
    ];

    for (const [table, column] of purge) {
      const { error } = await supabaseAdmin.from(table).delete().eq(column, user.id);
      if (error) console.error(`[delete-account] purge ${table}.${column}`, error.message);
    }
    for (const [table, column] of detach) {
      const { error } = await supabaseAdmin.from(table).update({ [column]: null }).eq(column, user.id);
      if (error) console.error(`[delete-account] detach ${table}.${column}`, error.message);
    }

    // 4. Delete the Supabase Auth account (irreversible).
    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteAuthError) throw deleteAuthError;

    await supabaseAdmin.from("security_logs").insert({
      user_id: user.id,
      action: "account_deleted",
      ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
      user_agent: req.headers.get("user-agent"),
      success: true,
    });

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
