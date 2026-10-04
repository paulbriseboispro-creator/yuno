import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildInvitation } from "../_shared/email-templates.ts";
import { demoPreviewGuard } from "../_shared/demo-guard.ts";
import { isDemoEmail } from "../_shared/demo-scope.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  // Lien démo : lecture seule garantie côté serveur (_shared/demo-guard.ts).
  const demoRefusal = await demoPreviewGuard(req, corsHeaders);
  if (demoRefusal) return demoRefusal;

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

    const body = await req.json();
    const { email, role } = body as { email?: string; role?: string };
    const targetOrg = typeof body.organizer_user_id === "string" ? body.organizer_user_id : null;
    const resendOnly = body.resend === true;
    if (!email || !role || !["admin", "editor", "scanner", "viewer"].includes(role)) {
      return new Response(JSON.stringify({ error: "Missing or invalid fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // L'organisation où l'on invite : la sienne, ou — Yuno CRM — celle d'un
    // espace où l'on gère l'équipe (fondateur ou admin, crm_user_manages_team).
    let orgId = user.id;
    const { data: orgRow } = await supabaseAdmin
      .from("organizer_profiles").select("product").eq("user_id", targetOrg ?? user.id).maybeSingle();
    const isCrm = (orgRow as { product?: string } | null)?.product === "crm";
    if (targetOrg && targetOrg !== user.id) {
      const { data: can } = await supabaseAdmin.rpc("crm_user_manages_team", {
        p_user_id: user.id, p_venue_id: null, p_organizer_user_id: targetOrg,
      });
      if (can !== true || !isCrm) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      orgId = targetOrg;
    } else {
      // Get inviter profile (must be organizer/BDE)
      const { data: inviter } = await supabaseAdmin
        .from("profiles").select("profile_type").eq("id", user.id).maybeSingle();
      // 'bde' / 'private_organizer' kept for legacy DB rows that may not yet be migrated.
      if (!inviter || !["organizer", "bde", "private_organizer"].includes(inviter.profile_type)) {
        return new Response(JSON.stringify({ error: "Only organizers can invite team members" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // Le lecteur n'existe que dans Yuno CRM (la Console Organisateur ne le gère pas).
    if (role === "viewer" && !isCrm) {
      return new Response(JSON.stringify({ error: "Missing or invalid fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("profile_type, organization_name, email")
      .eq("id", orgId)
      .maybeSingle();

    // Compte démo : on n'invite qu'une adresse démo, et rien ne part par e-mail.
    const demoOrg = isDemoEmail((profile as { email?: string | null } | null)?.email) || isDemoEmail(user.email);
    if (demoOrg && !isDemoEmail(normalizedEmail)) {
      return new Response(JSON.stringify({ error: "demo_invite_real", code: "demo_invite_real" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Renvoyer une invitation en attente : nouveau délai de 7 jours, même lien.
    if (resendOnly) {
      const { data: pending } = await supabaseAdmin
        .from("org_members")
        .select("id, invitation_token, role")
        .eq("organizer_user_id", orgId)
        .eq("member_email", normalizedEmail)
        .eq("invitation_status", "pending")
        .maybeSingle();
      if (!pending) {
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await supabaseAdmin.from("org_members")
        .update({ expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })
        .eq("id", pending.id);
      const sent = demoOrg ? true : await sendInvite(normalizedEmail, pending.invitation_token as string, pending.role as string, profile?.organization_name || "Yuno");
      return new Response(JSON.stringify(sent ? { success: true, invitation_id: pending.id } : { error: "Échec de l'envoi de l'invitation par email" }), {
        status: sent ? 200 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Déjà dans l'équipe, déjà invitée, ou le titulaire lui-même : rien à envoyer.
    const { data: existingRows } = await supabaseAdmin
      .from("org_members")
      .select("id, invitation_status")
      .eq("organizer_user_id", orgId)
      .eq("member_email", normalizedEmail)
      .in("invitation_status", ["pending", "accepted"])
      .limit(1);
    const existing = existingRows?.[0] ?? null;
    const isHolder = String((profile as { email?: string | null } | null)?.email ?? "").toLowerCase() === normalizedEmail;
    if (existing || isHolder) {
      const code = existing?.invitation_status === "pending" ? "already_invited" : "already_member";
      return new Response(JSON.stringify({ error: code, code }), {
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
        organizer_user_id: orgId,
        member_user_id: existingMember?.id ?? null,
        member_email: normalizedEmail,
        role,
        invited_by: user.id,
      })
      .select()
      .single();

    // Yuno CRM : l'équipe de l'offre est complète (trigger crm_guard_member_limit).
    if (invError && String(invError.message ?? "").includes("crm_member_limit")) {
      return new Response(JSON.stringify({ error: "crm_member_limit", code: "crm_member_limit" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (invError) throw invError;

    if (!demoOrg) {
      const sent = await sendInvite(normalizedEmail, invitation.invitation_token as string, role, profile?.organization_name || "Yuno");
      if (!sent) {
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

/** L'e-mail d'invitation (lien /accept-org-member). Rend false si Resend refuse. */
async function sendInvite(to: string, token: string, role: string, orgName: string): Promise<boolean> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) return true;
  const acceptUrl = `https://yunoapp.eu/accept-org-member?token=${token}`;
  const roleLabel = role === "admin" ? "Administrateur" : role === "editor" ? "Éditeur" : role === "viewer" ? "Lecteur" : "Scanner";
  const mail = buildInvitation({ lang: "fr", orgName, roleLabel, acceptUrl });
  const resendFromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "noreply@yunoapp.eu";
  const from = resendFromEmail.includes("<") ? resendFromEmail : `Yuno <${resendFromEmail}>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: mail.subject, html: mail.html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("invite-org-member email send failed:", res.status, body);
    return false;
  }
  return true;
}
