import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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

      const html = `
<!DOCTYPE html><html><body style="margin:0;background:#0a0a0a;font-family:system-ui,sans-serif;color:#fff">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:24px;border-radius:16px 16px 0 0;text-align:center">
      <h1 style="margin:0;font-size:22px">🤝 ${venue.name} t'invite à collaborer</h1>
    </div>
    <div style="background:#161616;padding:24px;border-radius:0 0 16px 16px;line-height:1.6">
      <p style="margin:0 0 12px;color:#ddd">Bonjour ${contact_first_name || ""},</p>
      <p style="margin:0 0 12px;color:#bbb">
        <strong style="color:#fff">${venue.name}</strong>${venue.city ? ` (${venue.city})` : ""} aimerait collaborer avec toi sur Yuno.
      </p>
      ${invitation_message ? `<div style="background:#0d0d0d;border-left:3px solid #dc2626;padding:12px 16px;margin:16px 0;color:#ccc;font-style:italic">« ${invitation_message} »</div>` : ""}
      <p style="margin:16px 0;color:#bbb">
        Yuno est la plateforme tout-en-un pour la nightlife : billetterie, tables VIP, paiements, fidélité.
        En acceptant, tu créeras ton compte organisateur en quelques clics.
      </p>
      <div style="text-align:center;margin:24px 0">
        <a href="${acceptUrl}" style="display:inline-block;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:bold">Accepter l'invitation</a>
      </div>
      <p style="color:#666;font-size:12px;text-align:center">
        Ou copie ce lien : <br><a href="${acceptUrl}" style="color:#dc2626;word-break:break-all">${acceptUrl}</a>
      </p>
      <p style="color:#666;font-size:12px;margin-top:16px">Cette invitation expire dans 14 jours.</p>
    </div>
  </div>
</body></html>`;

      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from,
          to: [organizer_email],
          subject: `🤝 ${venue.name} t'invite à collaborer sur Yuno`,
          html,
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
