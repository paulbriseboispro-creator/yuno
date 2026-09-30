import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildOrganizerCollabInvitation } from "../_shared/email-templates.ts";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { demoPreviewGuard } from "../_shared/demo-guard.ts";
import { summarizeTerms, needsStripe } from "../_shared/collab-invite-text.ts";
import { handleCoorgInvite } from "../_shared/coorg-invite.ts";

const DEFAULT_APP_ORIGIN = "https://yunoapp.eu";
// The accept link goes into an email holding a live token — never build it from
// an arbitrary caller-supplied origin.
const isAllowedOrigin = (o: string) =>
  o === "https://yuno.club" || o === DEFAULT_APP_ORIGIN || o.startsWith("http://localhost");

/**
 * A venue owner invites an external organizer (not yet on Yuno) by email.
 * Mirror of `invite-club-collab`, venue → organizer direction. The invitation
 * CARRIES the deal: the night and the terms (per pillar or tiers, Stripe or
 * bank transfer) chosen by the club. On acceptance the contract opens
 * pre-signed by the club (`accept_organizer_claim_invitation`).
 *
 * Body:
 *  - organizer_email (required)
 *  - organizer_name?, contact_first_name?, contact_last_name?
 *  - invitation_message?
 *  - venue_id?  (the club inviting — must be owned by the caller; first owned club otherwise)
 *  - event_id?  (the club's own upcoming night, still without organizer)
 *  - default_split_rules?  (required with event_id)
 *  - lang? ('fr' | 'en' | 'es' — language of the email)
 *  - origin (window.location.origin)
 *
 * With `kind: "coorg"` the same function sends a CO-ORGANIZATION invitation
 * by email (`_shared/coorg-invite.ts`) — the project's function quota forbids
 * a dedicated function.
 */
const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Lien démo : lecture seule garantie côté serveur (_shared/demo-guard.ts).
  const demoRefusal = await demoPreviewGuard(req, corsHeaders);
  if (demoRefusal) return demoRefusal;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated" }, 401, corsHeaders);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401, corsHeaders);

    const body = await req.json();
    // Co-organisation : inviter par email une structure sans compte (club ou
    // organisateur). Règles dans la RPC create_cohost_email_invite.
    if (body?.kind === "coorg") return await handleCoorgInvite(req, body, corsHeaders);
    const {
      organizer_email,
      organizer_name,
      contact_first_name,
      contact_last_name,
      invitation_message,
      venue_id,
      event_id,
      default_split_rules,
      lang,
      origin,
    } = body || {};

    if (!organizer_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(organizer_email).trim())) {
      return json({ error: "Email organisateur invalide" }, 400, corsHeaders);
    }
    const normalizedEmail = String(organizer_email).toLowerCase().trim();
    const mailLang = (["fr", "en", "es"].includes(lang ?? "") ? lang : "fr") as "fr" | "en" | "es";

    // The club inviting: owned by the caller (the invitation commits the club
    // on financial terms — never a manager).
    let venueQuery = admin.from("venues").select("id, name, city").eq("owner_id", user.id).is("decommissioned_at", null);
    if (venue_id) venueQuery = venueQuery.eq("id", venue_id);
    const { data: venue } = await venueQuery.order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!venue) return json({ error: "Aucun club rattaché à ton compte" }, 403, corsHeaders);

    // La démo n'écrit jamais à une vraie boîte mail.
    const [{ data: inviterDemo }, { data: targetDemo }] = await Promise.all([
      admin.rpc("is_demo_email", { p_email: user.email ?? "" }),
      admin.rpc("is_demo_email", { p_email: normalizedEmail }),
    ]);
    if (inviterDemo === true && targetDemo !== true) {
      return json({ error: "Un compte de démonstration ne peut inviter qu'une adresse de démonstration." }, 403, corsHeaders);
    }

    // The night: the club's own, upcoming, still without an organizer.
    let eventTitle: string | null = null;
    let eventDateLabel: string | null = null;
    if (event_id) {
      const { data: ev } = await admin
        .from("events")
        .select("id, title, start_at, end_at, timezone, cancelled_at, organizer_user_id, partner_organizer_id")
        .eq("id", event_id).eq("venue_id", venue.id).maybeSingle();
      if (!ev || ev.cancelled_at || ev.organizer_user_id || ev.partner_organizer_id
          || new Date(ev.end_at ?? ev.start_at).getTime() < Date.now()) {
        return json({ error: "Cette soirée ne peut plus recevoir d'organisateur." }, 400, corsHeaders);
      }
      if (!default_split_rules || typeof default_split_rules !== "object") {
        return json({ error: "Choisis les conditions financières proposées." }, 400, corsHeaders);
      }
      eventTitle = ev.title;
      const locale = mailLang === "es" ? "es-ES" : mailLang === "en" ? "en-GB" : "fr-FR";
      eventDateLabel = new Date(ev.start_at).toLocaleString(locale, {
        weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
        timeZone: ev.timezone || "Europe/Paris",
      });
    }

    // Don't stack pending invitations for the same organizer — repeated clicks
    // would spam the invitee and pile up claimable rows.
    const { data: existingInv } = await admin
      .from("organizer_claim_invitations")
      .select("id")
      .eq("inviting_venue_id", venue.id)
      .eq("organizer_email", normalizedEmail)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (existingInv) {
      return json({ error: "Une invitation est déjà en attente pour cet organisateur." }, 400, corsHeaders);
    }

    const { data: inv, error: insErr } = await admin
      .from("organizer_claim_invitations")
      .insert({
        organizer_email: normalizedEmail,
        organizer_name: organizer_name?.trim() || null,
        contact_first_name: contact_first_name?.trim() || null,
        contact_last_name: contact_last_name?.trim() || null,
        invitation_message: invitation_message?.trim() || null,
        inviting_venue_id: venue.id,
        invited_by_user_id: user.id,
        event_id: event_id ?? null,
        default_split_rules: default_split_rules ?? null,
      })
      .select("id, token, expires_at")
      .single();
    if (insErr) throw insErr;

    const baseOrigin = origin && isAllowedOrigin(origin) ? origin : DEFAULT_APP_ORIGIN;
    const acceptUrl = `${baseOrigin}/accept-organizer-invitation?token=${inv.token}`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    let emailSent = false;
    if (RESEND_API_KEY && targetDemo !== true) {
      const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
      const from = rawFrom
        ? (rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`)
        : "Yuno <noreply@yunoapp.eu>";
      const expiresLabel = inv.expires_at
        ? new Date(inv.expires_at).toLocaleDateString(mailLang === "es" ? "es-ES" : mailLang === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "long", year: "numeric" })
        : null;
      const mail = buildOrganizerCollabInvitation({
        lang: mailLang,
        clubName: venue.name,
        organizerName: organizer_name?.trim() || null,
        contactFirstName: contact_first_name?.trim() || null,
        eventTitle,
        eventDateLabel,
        termsSummary: event_id ? summarizeTerms(default_split_rules, mailLang) : null,
        message: invitation_message?.trim() || null,
        acceptUrl,
        expiresLabel,
        organizerNeedsStripe: event_id ? needsStripe(default_split_rules, "organizer") : true,
      });
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({ from, to: [normalizedEmail], subject: mail.subject, html: mail.html }),
      });
      if (!resp.ok) console.error("Resend error:", await resp.text());
      else emailSent = true;
    } else if (!RESEND_API_KEY) {
      console.warn("RESEND_API_KEY not configured — invitation saved without email");
    }

    return json({ success: true, invitation_id: inv.id, email_sent: emailSent }, 200, corsHeaders);
  } catch (error) {
    console.error("invite-organizer-collab error:", error);
    return json({ error: (error as Error).message ?? "Unknown error" }, 500, corsHeaders);
  }
};

serve(handler);
