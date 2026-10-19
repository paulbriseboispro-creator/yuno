import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { isSupportSessionToken } from "../_shared/support-session.ts";
import { demoPreviewGuard } from "../_shared/demo-guard.ts";

serve(async (req) => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Lien démo : lecture seule garantie côté serveur (_shared/demo-guard.ts).
  const demoRefusal = await demoPreviewGuard(req, corsHeaders);
  if (demoRefusal) return demoRefusal;

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

    // Mode support (accès admin assisté) : la suppression du compte appartient
    // au client, jamais à une session support.
    if (await isSupportSessionToken(supabaseAdmin, authHeader.replace("Bearer ", ""))) {
      return new Response(JSON.stringify({ error: "support_session_forbidden" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
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

    // 0. Un PRO qui supprime son compte : Paul est prévenu (alerte plateforme,
    // relayée sur son téléphone par le Cockpit). Lu AVANT l'anonymisation ;
    // ne bloque jamais la suppression (migration 20261103410000).
    await notifyProAccountDeleted(supabaseAdmin, user.id, user.email ?? null, user.created_at ?? null);

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

    // user_id NULL : la ligne pointe vers auth.users (ON DELETE CASCADE) et le
    // compte vient d'être effacé — avec son id, l'insertion échouait toujours.
    await supabaseAdmin.from("security_logs").insert({
      user_id: null,
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

async function notifyProAccountDeleted(admin: SupabaseClient, userId: string, email: string | null, createdAt: string | null) {
  try {
    const [{ data: roles }, { data: profile }, { data: org }, { data: signup }] = await Promise.all([
      admin.from("user_roles").select("role").eq("user_id", userId).returns<Array<{ role: string }>>(),
      admin.from("profiles").select("first_name, last_name, phone, profile_type, organization_name")
        .eq("id", userId).maybeSingle<{ first_name: string | null; last_name: string | null; phone: string | null; profile_type: string | null; organization_name: string | null }>(),
      admin.from("organizer_profiles").select("display_name, city").eq("user_id", userId)
        .maybeSingle<{ display_name: string | null; city: string | null }>(),
      admin.from("pro_signups").select("id, org_name, city, kind, phone").eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(1)
        .maybeSingle<{ id: string; org_name: string | null; city: string | null; kind: string | null; phone: string | null }>(),
    ]);
    const proRoles = (roles ?? []).map((r) => r.role).filter((r) => r !== "client");
    if (!proRoles.length && profile?.profile_type !== "organizer" && !signup) return;
    if (email && /@womber\.fr$/i.test(email)) return;
    const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || email || "?";
    const orgName = org?.display_name ?? signup?.org_name ?? profile?.organization_name ?? null;
    const city = org?.city ?? signup?.city ?? null;
    const phone = profile?.phone ?? signup?.phone ?? null;
    await admin.rpc("emit_admin_notification", {
      p_type: "admin_pro_account_deleted",
      p_title: "Un pro a supprimé son compte",
      p_message: `${orgName ?? name}${city ? ` (${city})` : ""} · ${name}${phone ? ` · ${phone}` : ""}`
        + `${createdAt ? ` · compte ouvert le ${createdAt.slice(0, 10)}` : ""}.`,
      p_priority: "high",
      p_reference_type: signup ? "pro_signup" : "user",
      p_reference_id: signup?.id ?? userId,
      p_metadata: {
        email, name, phone, org_name: orgName, city, roles: proRoles,
        signup_kind: signup?.kind ?? (profile?.profile_type === "organizer" ? "organizer" : null),
        account_created_at: createdAt, user_id: userId,
      },
      p_dedup_key: `pro_account_deleted:${userId}`,
    });
  } catch (e) {
    console.warn("[delete-account] admin alert", e instanceof Error ? e.message : e);
  }
}
