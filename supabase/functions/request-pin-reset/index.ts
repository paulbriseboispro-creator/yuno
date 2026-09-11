import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { crypto } from "https://deno.land/std@0.190.0/crypto/mod.ts";
import { buildSecureLink } from "../_shared/email-templates.ts";
import { isSupportSessionToken } from "../_shared/support-session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};


/**
 * Vue structurelle du client service_role. Les génériques de `SupabaseClient`
 * diffèrent d'un import esm.sh à l'autre : les nommer ici ne ferait que figer
 * une version.
 */
interface AdminLike {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
}

/**
 * Qui peut déclencher la pose d'un PIN pour quelqu'un d'autre : l'organisateur
 * dont la personne est le staff accepté (ou un membre de son équipe qui gère le
 * personnel), et le propriétaire du club où elle travaille. Fermé par défaut —
 * un doute renvoie false, jamais un lien de plus.
 */
async function canManageStaffPin(
  admin: AdminLike,
  callerId: string,
  targetId: string,
): Promise<boolean> {
  const { data: staffRows } = await admin
    .from("org_staff")
    .select("organizer_user_id")
    .eq("user_id", targetId)
    .eq("invitation_status", "accepted");

  for (const row of staffRows ?? []) {
    const organizerId = (row as { organizer_user_id: string }).organizer_user_id;
    if (organizerId === callerId) return true;
    const { data: perm } = await admin.rpc("org_member_has_permission", {
      _user_id: callerId,
      _organizer_user_id: organizerId,
      _permission: "manage_team",
    });
    if (perm === true) return true;
  }

  // Staff de club : le propriétaire du lieu où la personne est rattachée.
  const { data: profile } = await admin
    .from("profiles")
    .select("venue_id")
    .eq("id", targetId)
    .maybeSingle();
  const venueId = (profile as { venue_id: string | null } | null)?.venue_id;
  if (venueId) {
    const { data: venue } = await admin
      .from("venues")
      .select("owner_id")
      .eq("id", venueId)
      .maybeSingle();
    if ((venue as { owner_id: string } | null)?.owner_id === callerId) return true;
  }

  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Demande POUR QUELQU'UN D'AUTRE : un organisateur ou un club débloque un
    // employé qui n'a pas encore de code PIN (ou qui l'a perdu). Le lien part
    // toujours dans la boîte de l'EMPLOYÉ : l'employeur déclenche l'envoi, il
    // ne voit jamais le code. Sans ce chemin, l'écran d'équipe affichait « PIN
    // à configurer » sans qu'aucun bouton puisse rien y faire.
    let body: { targetUserId?: string } = {};
    try { body = await req.json(); } catch { /* corps vide : demande pour soi */ }
    const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId : null;
    const forSelf = !targetUserId || targetUserId === user.id;

    if (!forSelf) {
      // Le PIN est une clé d'accès : une session d'assistance Yuno n'en
      // déclenche pas la remise à zéro pour un tiers.
      if (await isSupportSessionToken(supabaseAdmin, authHeader.replace("Bearer ", ""))) {
        return new Response(JSON.stringify({ error: "support_session_forbidden", success: false }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const allowed = await canManageStaffPin(supabaseAdmin as unknown as AdminLike, user.id, targetUserId!);
      if (!allowed) {
        return new Response(
          JSON.stringify({ error: "forbidden", success: false }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const subjectUserId = forSelf ? user.id : targetUserId!;

    // Verify user has an eligible role. Tous les comptes pro qui protègent leur
    // espace par un PIN (talent + staff opérationnel) doivent pouvoir se
    // réinitialiser par email — sinon un videur qui oublie son PIN est bloqué.
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", subjectUserId)
      .in("role", [
        "dj", "promoter", "organizer", "affiliate", "affiliate_member",
        "barman", "bouncer", "cloakroom", "vip_host", "manager",
      ]);

    if (!roles || roles.length === 0) {
      return new Response(
        JSON.stringify({ error: "Unauthorized role", success: false }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Destinataire : toujours la boîte du porteur du PIN.
    const { data: subject, error: subjectError } = await supabaseAdmin.auth.admin
      .getUserById(subjectUserId);
    const subjectEmail = subject?.user?.email;
    if (subjectError || !subjectEmail) {
      return new Response(
        JSON.stringify({ error: "recipient_not_found", success: false }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate secure token
    const token = crypto.randomUUID() + "-" + crypto.randomUUID();

    // Store token
    const { error: insertError } = await supabaseAdmin
      .from("pin_reset_tokens")
      .insert({
        user_id: subjectUserId,
        token,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
      });

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create reset token", success: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resetUrl = `https://yunoapp.eu/reset-pin?token=${token}`;

    const mail = buildSecureLink({
      lang: "fr",
      title: forSelf ? "Réinitialise ton code PIN" : "Ton code PIN Yuno",
      message: forSelf
        ? "Tu as demandé à réinitialiser ton code PIN. Clique sur le bouton ci-dessous pour en créer un nouveau. Ce lien expire dans 1 heure."
        : "Ton équipe t'a envoyé ce lien pour que tu poses ton code PIN — c'est lui qui ouvre ton poste au moment du service. Choisis un code à 6 chiffres, connu de toi seul. Ce lien expire dans 1 heure.",
      ctaLabel: forSelf ? "Créer un nouveau PIN" : "Créer mon code PIN",
      ctaUrl: resetUrl,
      footnote: "Tu n'es pas à l'origine de cette demande ? Ignore cet email.",
    });

    // Send email via Resend
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "Yuno <noreply@yunoapp.eu>";

    if (!RESEND_API_KEY) {
      console.error("Missing email configuration");
      return new Response(
        JSON.stringify({ error: "Email service not configured", success: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [subjectEmail],
        subject: forSelf
          ? "🔐 Réinitialisation de ton code PIN — Yuno"
          : "🔐 Crée ton code PIN — Yuno",
        html: mail.html,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      console.error("Email send error:", errBody);
      return new Response(
        JSON.stringify({ error: "Failed to send email", success: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("PIN reset email sent for user:", subjectUserId);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in request-pin-reset:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Server error", success: false }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
