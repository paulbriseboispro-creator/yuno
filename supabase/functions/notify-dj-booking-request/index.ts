import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendAutoPush } from "../_shared/auto-push.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Pousse le DJ sur son téléphone (app Yuno Pro) quand un club ou un
 * organisateur vient de lui envoyer une demande de booking.
 *
 * Body: { request_id: string }
 *
 * Invoquée par le client du booker juste après create_dj_booking_request,
 * en fire-and-forget : un échec ici ne casse jamais l'envoi de la demande.
 * L'inbox in-app (DJ → Bookings) reste la source de vérité ; ce push est le
 * signal. Circuit auto-push : gate du registre super admin
 * (/admin/notifications, clé dj_booking_request), langue FR/EN/ES du
 * destinataire, tracking auto_push_events, clic attribué via ?an=.
 *
 * Autorisation : l'appelant doit être le booker de la demande (créateur, ou
 * propriétaire/manager du club, ou l'organisateur) et la demande doit être
 * encore pending — on ne peut pas s'en servir pour pousser un tiers.
 */
const log = (step: string, details?: unknown) => {
  console.log(`[NOTIFY-DJ-BOOKING] ${step}${details ? ` ${JSON.stringify(details)}` : ""}`);
};

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

    const { request_id } = await req.json().catch(() => ({}));
    if (!request_id || typeof request_id !== "string") {
      return new Response(JSON.stringify({ error: "request_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: r } = await admin
      .from("dj_booking_requests")
      .select("id, status, venue_id, organizer_user_id, created_by, dj_user_id, requested_date")
      .eq("id", request_id)
      .maybeSingle();
    if (!r) {
      return new Response(JSON.stringify({ ok: false, reason: "not_found" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (r.status !== "pending") {
      log("skipped: not pending", { status: r.status });
      return new Response(JSON.stringify({ ok: false, reason: "not_pending" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // L'appelant doit être du côté booker de CETTE demande.
    let isBooker = r.created_by === user.id
      || (r.organizer_user_id != null && r.organizer_user_id === user.id);
    if (!isBooker && r.venue_id) {
      const { data: venue } = await admin
        .from("venues").select("owner_id").eq("id", r.venue_id).maybeSingle();
      if (venue?.owner_id === user.id) {
        isBooker = true;
      } else {
        const { data: prof } = await admin
          .from("profiles").select("venue_id").eq("id", user.id).maybeSingle();
        const { data: roles } = await admin
          .from("user_roles").select("role").eq("user_id", user.id).eq("role", "manager");
        isBooker = prof?.venue_id === r.venue_id && (roles?.length ?? 0) > 0;
      }
    }
    if (!isBooker) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Nom du booker : le club parle au nom du club, l'organisateur au sien.
    let booker = "Un club";
    if (r.venue_id) {
      const { data: v } = await admin.from("venues").select("name").eq("id", r.venue_id).maybeSingle();
      if (v?.name) booker = v.name;
    } else if (r.organizer_user_id) {
      const { data: prof } = await admin
        .from("profiles")
        .select("first_name, last_name, organization_name")
        .eq("id", r.organizer_user_id)
        .maybeSingle();
      booker = prof?.organization_name
        || [prof?.first_name, prof?.last_name].filter(Boolean).join(" ")
        || "Un organisateur";
    }

    const d = String(r.requested_date); // 'YYYY-MM-DD'
    const dateLabel = `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

    const { sent } = await sendAutoPush(admin, {
      key: "dj_booking_request",
      userId: r.dj_user_id,
      url: "/dj/bookings",
      vars: { booker, date: dateLabel },
    });
    log("dispatched", { request_id, sent });

    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "unknown";
    console.error("[NOTIFY-DJ-BOOKING] error", msg);
    // Best-effort : ne casse jamais le flux client.
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

serve(handler);
