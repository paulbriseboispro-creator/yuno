import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildInvitation } from "../_shared/email-templates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * A venue owner invites an external organizer (not yet on Yuno) by email.
 * Mirror of `invite-club-collab`, but venue → organizer direction.
 *
 * Body:
 *  - organizer_email (required)
 *  - organizer_name?, contact_first_name?, contact_last_name?
 *  - invitation_message?
 *  - event_id?  (optional — to attach the future organizer to a specific event)
 *  - default_split_rules?
 *  - origin (window.location.origin)
 */
const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      organizer_email,
      organizer_name,
      contact_first_name,
      contact_last_name,
      invitation_message,
      event_id,
      default_split_rules,
      origin,
    } = body || {};

    if (!organizer_email || !/.+@.+\..+/.test(organizer_email)) {
      return new Response(JSON.stringify({ error: "Email organisateur invalide" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find the venue owned by this user
    const { data: venue } = await admin
      .from("venues")
      .select("id, name, city")
      .eq("owner_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!venue) {
      return new Response(JSON.stringify({ error: "Aucun club rattaché à ton compte" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert invitation
    const { data: inv, error: insErr } = await admin
      .from("organizer_claim_invitations")
      .insert({
        organizer_email: String(organizer_email).toLowerCase().trim(),
        organizer_name: organizer_name ?? null,
        contact_first_name: contact_first_name ?? null,
        contact_last_name: contact_last_name ?? null,
        invitation_message: invitation_message ?? null,
        inviting_venue_id: venue.id,
        invited_by_user_id: user.id,
        event_id: event_id ?? null,
        default_split_rules: default_split_rules ?? null,
      })
      .select("id, token")
      .single();
    if (insErr) throw insErr;

    // Send email via Resend if configured
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const baseOrigin = origin || "https://yunoapp.eu";
    const acceptUrl = `${baseOrigin}/accept-organizer-invitation?token=${inv.token}`;

    if (RESEND_API_KEY) {
      const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
      const from = rawFrom
        ? (rawFrom.includes("<") ? rawFrom : `Yuno <${rawFrom}>`)
        : "Yuno <noreply@yunoapp.eu>";

      const mail = buildInvitation({
        lang: "fr",
        inviterName: venue.name,
        orgName: venue.name,
        roleLabel: "Collaboration",
        acceptUrl,
      });

      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from,
          to: [organizer_email],
          subject: mail.subject,
          html: mail.html,
        }),
      });
      if (!resp.ok) {
        console.error("Resend error:", await resp.text());
      }
    } else {
      console.warn("RESEND_API_KEY not configured — invitation saved without email");
    }

    return new Response(
      JSON.stringify({ success: true, invitation_id: inv.id, accept_url: acceptUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("invite-organizer-collab error:", error);
    return new Response(JSON.stringify({ error: error.message ?? "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

serve(handler);
