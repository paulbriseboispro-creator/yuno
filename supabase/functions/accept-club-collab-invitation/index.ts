import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Accept a club-collab invitation.
 * Two modes:
 *  - GET ?token=...  -> returns invitation details (public, by token)
 *  - POST { token, action: 'accept' | 'decline' }
 *      - accept: requires auth. Creates the venue, links it to the auth user as owner,
 *                creates a venue_organizer_partnership (active) with the inviting organizer,
 *                attaches event partner_venue_id if event_id provided, marks invitation accepted.
 *      - decline: marks invitation declined (no auth required)
 */

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = url.searchParams.get("token");
      if (!token) {
        return new Response(JSON.stringify({ error: "Missing token" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: inv, error } = await admin
        .from("venue_claim_invitations")
        .select(`
          id, club_name, club_email, club_city, club_address,
          contact_first_name, contact_last_name,
          invitation_message, status, expires_at, accepted_at,
          event_id, organizer_user_id,
          default_split_rules
        `)
        .eq("token", token)
        .maybeSingle();
      if (error) throw error;
      if (!inv) {
        return new Response(JSON.stringify({ error: "Invitation introuvable" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch organizer label & event title (best effort)
      const { data: org } = await admin
        .from("profiles")
        .select("first_name, last_name, organization_name, avatar_url")
        .eq("id", inv.organizer_user_id)
        .maybeSingle();

      let event: any = null;
      if (inv.event_id) {
        const { data: ev } = await admin
          .from("events")
          .select("id, title, start_at, poster_url, image_url")
          .eq("id", inv.event_id)
          .maybeSingle();
        event = ev;
      }

      const expired = inv.expires_at && new Date(inv.expires_at) < new Date();
      return new Response(
        JSON.stringify({ invitation: inv, organizer: org, event, expired }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { token, action } = (await req.json()) as { token: string; action: "accept" | "decline" };
    if (!token || !action) {
      return new Response(JSON.stringify({ error: "Missing token or action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inv, error: invErr } = await admin
      .from("venue_claim_invitations")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    if (invErr) throw invErr;
    if (!inv) {
      return new Response(JSON.stringify({ error: "Invitation introuvable" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (inv.status !== "pending") {
      return new Response(JSON.stringify({ error: `Invitation déjà ${inv.status}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      await admin
        .from("venue_claim_invitations")
        .update({ status: "expired" })
        .eq("id", inv.id);
      return new Response(JSON.stringify({ error: "Invitation expirée" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "decline") {
      await admin
        .from("venue_claim_invitations")
        .update({ status: "declined" })
        .eq("id", inv.id);
      return new Response(JSON.stringify({ success: true, status: "declined" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === ACCEPT === requires authenticated user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Connecte-toi pour accepter l'invitation" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate a unique venue slug
    const baseSlug = slugify(inv.club_name) || `club-${inv.id.slice(0, 6)}`;
    let slug = baseSlug;
    let suffix = 0;
    // Try until unique
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: clash } = await admin
        .from("venues")
        .select("id")
        .eq("id", slug)
        .maybeSingle();
      if (!clash) break;
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
      if (suffix > 50) {
        slug = `${baseSlug}-${Date.now()}`;
        break;
      }
    }

    // Create venue
    const { error: venueErr } = await admin.from("venues").insert({
      id: slug,
      name: inv.club_name,
      city: inv.club_city,
      address: inv.club_address,
      owner_id: user.id,
      menu_enabled: false,
      vip_placement_enabled: false,
      is_hidden: false,
    });
    if (venueErr) {
      console.error("venue insert error:", venueErr);
      throw venueErr;
    }

    // Ensure profile_type is owner so they can use the owner dashboard
    await admin
      .from("profiles")
      .update({ profile_type: "owner", venue_id: slug })
      .eq("id", user.id);

    // Grant the 'owner' role so the dashboard card appears on /profile
    await admin
      .from("user_roles")
      .insert({ user_id: user.id, role: "owner", email: user.email })
      .select()
      .maybeSingle();

    // Create active partnership
    const { error: partErr } = await admin
      .from("venue_organizer_partnerships")
      .insert({
        venue_id: slug,
        organizer_user_id: inv.organizer_user_id,
        status: "active",
        initiated_by: "organizer",
        invitation_message: inv.invitation_message,
        default_split_rules: inv.default_split_rules,
        accepted_at: new Date().toISOString(),
      });
    if (partErr) {
      console.error("partnership insert error:", partErr);
      // Non-fatal — the trigger activate_collab_plan_on_partnership will still set up subscription if active
    }

    // If invitation referenced an event, link partner_venue_id
    if (inv.event_id) {
      await admin
        .from("events")
        .update({ partner_venue_id: slug, event_mode: "co_event" })
        .eq("id", inv.event_id)
        .eq("organizer_user_id", inv.organizer_user_id);
    }

    // Mark invitation accepted
    await admin
      .from("venue_claim_invitations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        created_venue_id: slug,
        created_owner_user_id: user.id,
      })
      .eq("id", inv.id);

    return new Response(
      JSON.stringify({ success: true, venue_id: slug }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("accept-club-collab-invitation error:", error);
    return new Response(JSON.stringify({ error: error.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

serve(handler);
