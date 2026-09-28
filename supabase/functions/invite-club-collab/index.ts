import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildClubCollabInvitation } from "../_shared/email-templates.ts";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { demoPreviewGuard } from "../_shared/demo-guard.ts";
import { summarizeTerms, needsStripe } from "../_shared/collab-invite-text.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const DEFAULT_APP_ORIGIN = "https://yunoapp.eu";
// The accept link goes into an email holding a live token — never build it from
// an arbitrary caller-supplied origin.
const isAllowedOrigin = (o: string) =>
  o === "https://yuno.club" || o === DEFAULT_APP_ORIGIN || o.startsWith("http://localhost");

interface Payload {
  club_name: string;
  club_email: string;
  club_city?: string;
  club_address?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  event_id?: string | null;
  /** Organisation au nom de laquelle on invite (fondateur ou admin d'équipe). */
  organizer_user_id?: string | null;
  invitation_message?: string;
  default_split_rules?: any;
  origin?: string;
  /** Langue de l'email reçu par le club (fr par défaut). */
  lang?: string;
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Lien démo : lecture seule garantie côté serveur (_shared/demo-guard.ts).
  const demoRefusal = await demoPreviewGuard(req, corsHeaders);
  if (demoRefusal) return demoRefusal;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });
    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) throw new Error("Not authenticated");

    const body = (await req.json()) as Payload;
    const {
      club_name,
      club_email,
      club_city,
      club_address,
      contact_first_name,
      contact_last_name,
      event_id,
      invitation_message,
      default_split_rules,
      origin,
      lang,
    } = body;

    // Scope = l'ORGANISATION : le fondateur, ou un ADMIN de son équipe qui
    // invite en son nom (même règle que collab_org_can_act côté SQL). Jamais un
    // éditeur ni un scanner : l'invitation porte des conditions financières.
    const orgId = body.organizer_user_id && body.organizer_user_id !== user.id ? body.organizer_user_id : user.id;
    if (orgId !== user.id) {
      const { data: isAdmin } = await supabaseAdmin.rpc("is_org_team_member", {
        _user_id: user.id, _organizer_user_id: orgId, _min_role: "admin",
      });
      if (isAdmin !== true) {
        return new Response(JSON.stringify({ error: "Seuls le fondateur et les admins de l'équipe peuvent inviter un club." }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Only organizers may invite a partner club. Without this, any logged-in account
    // could seed venue_claim_invitations that the accept flow turns into a real venue
    // + owner role.
    const { data: inviterProfile } = await supabaseAdmin
      .from("profiles").select("profile_type").eq("id", orgId).maybeSingle();
    if (inviterProfile?.profile_type !== "organizer") {
      return new Response(JSON.stringify({ error: "Seuls les organisateurs peuvent inviter un club partenaire." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    if (!club_name?.trim() || !club_email?.trim()) {
      return new Response(JSON.stringify({ error: "club_name et club_email requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalizedEmail = club_email.trim().toLowerCase();
    if (!emailRegex.test(normalizedEmail)) {
      return new Response(JSON.stringify({ error: "Email invalide" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // La soirée jointe doit être une soirée de l'organisation, encore sans club
    // (l'acceptation le revérifie en base ; ici on refuse tôt et clairement).
    if (event_id) {
      const { data: ownEvent } = await supabaseAdmin
        .from("events").select("id")
        .eq("id", event_id).eq("organizer_user_id", orgId)
        .is("venue_id", null).is("partner_venue_id", null)
        .maybeSingle();
      if (!ownEvent) {
        return new Response(JSON.stringify({ error: "Cette soirée n'appartient pas à ton organisation ou a déjà un club." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Check if a venue with this email already exists in Yuno
    const { data: existingVenue } = await supabaseAdmin
      .from("venues")
      .select("id, name")
      .ilike("contact_email", normalizedEmail)
      .maybeSingle();
    if (existingVenue) {
      return new Response(
        JSON.stringify({
          error: `Ce club est déjà inscrit sur Yuno (${existingVenue.name}). Utilise plutôt "Demander un partenariat".`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // La démo n'écrit jamais à une vraie boîte mail : un compte démo n'invite
    // qu'une adresse démo, et cet email-là n'est pas envoyé (boîte fictive).
    const [{ data: inviterDemo }, { data: targetDemo }] = await Promise.all([
      supabaseAdmin.rpc("is_demo_email", { p_email: user.email ?? "" }),
      supabaseAdmin.rpc("is_demo_email", { p_email: normalizedEmail }),
    ]);
    if (inviterDemo === true && targetDemo !== true) {
      return new Response(JSON.stringify({ error: "Un compte de démonstration ne peut inviter qu'une adresse de démonstration." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check pending invitation by this organizer for this email
    const { data: existingInv } = await supabaseAdmin
      .from("venue_claim_invitations")
      .select("id, expires_at")
      .eq("organizer_user_id", orgId)
      .eq("club_email", normalizedEmail)
      .eq("status", "pending")
      .maybeSingle();
    if (existingInv) {
      return new Response(
        JSON.stringify({ error: "Une invitation est déjà en attente pour ce club." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get organizer profile for personalization
    const { data: orgProfile } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name, organization_name")
      .eq("id", orgId)
      .maybeSingle();
    const organizerLabel =
      orgProfile?.organization_name ||
      [orgProfile?.first_name, orgProfile?.last_name].filter(Boolean).join(" ") ||
      "Un organisateur Yuno";

    // Create invitation
    const { data: invitation, error: insErr } = await supabaseAdmin
      .from("venue_claim_invitations")
      .insert({
        organizer_user_id: orgId,
        club_name: club_name.trim(),
        club_email: normalizedEmail,
        club_city: club_city?.trim() || null,
        club_address: club_address?.trim() || null,
        contact_first_name: contact_first_name?.trim() || null,
        contact_last_name: contact_last_name?.trim() || null,
        event_id: event_id || null,
        invitation_message: invitation_message?.trim() || null,
        default_split_rules: default_split_rules ?? undefined,
      })
      .select()
      .single();
    if (insErr) throw insErr;

    const baseUrl = origin && isAllowedOrigin(origin) ? origin : DEFAULT_APP_ORIGIN;
    const acceptUrl = `${baseUrl}/club-invitation?token=${invitation.token}`;

    const mailLang = (["fr", "en", "es"].includes(lang ?? "") ? lang : "fr") as "fr" | "en" | "es";

    // Nom PUBLIC de l'organisateur (le club ne connaît pas Yuno : il doit
    // reconnaître qui l'invite), la soirée visée, et les conditions en clair.
    const { data: orgPublic } = await supabaseAdmin
      .from("organizer_profiles").select("display_name").eq("user_id", orgId).maybeSingle();
    const inviterPublic = orgPublic?.display_name || organizerLabel;
    let eventTitle: string | null = null;
    let eventDateLabel: string | null = null;
    if (event_id) {
      const { data: ev } = await supabaseAdmin
        .from("events").select("title, start_at, timezone").eq("id", event_id).eq("organizer_user_id", orgId).maybeSingle();
      if (ev) {
        eventTitle = ev.title;
        const locale = mailLang === "es" ? "es-ES" : mailLang === "en" ? "en-GB" : "fr-FR";
        eventDateLabel = new Date(ev.start_at).toLocaleString(locale, {
          weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
          timeZone: ev.timezone || "Europe/Paris",
        });
      }
    }
    const termsSummary = summarizeTerms(default_split_rules, mailLang);
    const expiresLabel = invitation.expires_at
      ? new Date(invitation.expires_at).toLocaleDateString(mailLang === "es" ? "es-ES" : mailLang === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "long", year: "numeric" })
      : null;

    const mail = buildClubCollabInvitation({
      lang: mailLang,
      organizerName: inviterPublic,
      clubName: club_name.trim(),
      contactFirstName: contact_first_name?.trim() || null,
      eventTitle,
      eventDateLabel,
      termsSummary,
      message: invitation_message?.trim() || null,
      acceptUrl,
      expiresLabel,
      clubNeedsStripe: needsStripe(default_split_rules, "venue"),
    });

    const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
    const from = rawFrom
      ? rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`
      : "Yuno <noreply@yunoapp.eu>";

    if (RESEND_API_KEY && targetDemo !== true) {
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from,
          to: [normalizedEmail],
          subject: mail.subject,
          html: mail.html,
        }),
      });
      if (!emailRes.ok) {
        const errTxt = await emailRes.text();
        console.error("Resend error:", errTxt);
      } else {
        console.log("Club collab invitation email sent to", normalizedEmail);
      }
    } else {
      console.warn("RESEND_API_KEY missing — skipping email");
    }

    return new Response(
      JSON.stringify({ success: true, invitation_id: invitation.id, token: invitation.token }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("invite-club-collab error:", error);
    return new Response(JSON.stringify({ error: error.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

serve(handler);
