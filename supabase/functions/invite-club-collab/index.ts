import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildClubCollabInvitation } from "../_shared/email-templates.ts";
import { restrictedCorsHeaders } from "../_shared/cors.ts";

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
  invitation_message?: string;
  default_split_rules?: any;
  origin?: string;
  /** Langue de l'email reçu par le club (fr par défaut). */
  lang?: string;
}

/** « Billets 100 % orga · tables 100 % club » ou « barème sur le CA : 0 % < 3 500 €, 7 % … ». */
function summarizeTerms(rules: any, lang: "fr" | "en" | "es"): string | null {
  if (!rules || typeof rules !== "object") return null;
  const orga = lang === "en" ? "organizer" : lang === "es" ? "orga" : "orga";
  const rem = rules.remuneration;
  if (rem && rem.mode === "tiered_total" && Array.isArray(rem.tiers) && rem.tiers.length) {
    const tiers = [...rem.tiers].sort((a: any, b: any) => Number(a.from) - Number(b.from));
    const parts = tiers.map((t: any, i: number) => {
      const next = tiers[i + 1];
      const range = next ? `${Number(t.from).toLocaleString("fr-FR")}–${Number(next.from).toLocaleString("fr-FR")} €` : `≥ ${Number(t.from).toLocaleString("fr-FR")} €`;
      return `${range} : ${t.pct} %`;
    });
    const head = lang === "en" ? "Tiers on the night's total revenue" : lang === "es" ? "Escala sobre la facturación de la noche" : "Barème sur le CA de la soirée";
    return `${head} (${orga}) — ${parts.join(" · ")}`;
  }
  const pct = (b: any) => Number(b?.organizer_pct ?? 0);
  const tk = lang === "en" ? "Tickets" : lang === "es" ? "Entradas" : "Billets";
  const tb = lang === "en" ? "tables" : lang === "es" ? "mesas" : "tables";
  const dr = lang === "en" ? "drinks" : lang === "es" ? "bebidas" : "boissons";
  return `${tk} ${pct(rules.tickets)} % ${orga} · ${tb} ${pct(rules.tables)} % ${orga} · ${dr} ${pct(rules.drinks)} % ${orga}`;
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    // Only organizers may invite a partner club. Without this, any logged-in account
    // could seed venue_claim_invitations that the accept flow turns into a real venue
    // + owner role.
    const { data: inviterProfile } = await supabaseAdmin
      .from("profiles").select("profile_type").eq("id", user.id).maybeSingle();
    if (inviterProfile?.profile_type !== "organizer") {
      return new Response(JSON.stringify({ error: "Seuls les organisateurs peuvent inviter un club partenaire." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Check pending invitation by this organizer for this email
    const { data: existingInv } = await supabaseAdmin
      .from("venue_claim_invitations")
      .select("id, expires_at")
      .eq("organizer_user_id", user.id)
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
      .eq("id", user.id)
      .maybeSingle();
    const organizerLabel =
      orgProfile?.organization_name ||
      [orgProfile?.first_name, orgProfile?.last_name].filter(Boolean).join(" ") ||
      "Un organisateur Yuno";

    // Create invitation
    const { data: invitation, error: insErr } = await supabaseAdmin
      .from("venue_claim_invitations")
      .insert({
        organizer_user_id: user.id,
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
      .from("organizer_profiles").select("display_name").eq("user_id", user.id).maybeSingle();
    const inviterPublic = orgPublic?.display_name || organizerLabel;
    let eventTitle: string | null = null;
    let eventDateLabel: string | null = null;
    if (event_id) {
      const { data: ev } = await supabaseAdmin
        .from("events").select("title, start_at, timezone").eq("id", event_id).eq("organizer_user_id", user.id).maybeSingle();
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
    });

    const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
    const from = rawFrom
      ? rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`
      : "Yuno <noreply@yunoapp.eu>";

    if (RESEND_API_KEY) {
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
