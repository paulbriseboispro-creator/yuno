import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Generate client-facing reservation code in YN-XXXXXX format */
function generateReservationCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `YN-${code}`;
}

/** Generate internal QR code for scanning */
function generateQRCode(): string {
  // Cryptographically-random, unguessable code (Deno global crypto). A QR code is
  // a door credential — it must not be guessable from a timestamp.
  return `GL-${crypto.randomUUID()}`;
}

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-GUEST-LIST-ENTRY] ${step}`, details ? JSON.stringify(details) : "");
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { shareToken, gender, promoterCode, guestEmail, guestFullName, guestPhone } = await req.json();

    if (!shareToken) {
      throw new Error("Missing required field: shareToken");
    }

    // Resolve the registrant. Two paths, same as ticket/table checkout:
    //   - logged-in user  → identity from the JWT + profile
    //   - guest (no account) → identity from the request body
    // A guest entry is stored with user_id = null (the column is nullable and the
    // INSERT RLS allows it); account creation is offered later via /guest/finalize.
    const authHeader = req.headers.get("Authorization");
    let user: { id: string; email: string | null } | null = null;
    if (authHeader) {
      const supabaseClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user: authedUser } } = await supabaseClient.auth.getUser();
      if (authedUser) user = { id: authedUser.id, email: authedUser.email ?? null };
    }

    let fullName: string;
    let email: string;
    let phone: string;

    if (user) {
      logStep("User authenticated", { userId: user.id, email: user.email });
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("first_name, last_name, phone, email")
        .eq("id", user.id)
        .single();
      fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || user.email?.split("@")[0] || "Guest";
      email = user.email || profile?.email || "";
      phone = profile?.phone || "";
    } else {
      // Guest registration — no account required.
      if (!guestEmail || !guestFullName) {
        throw new Error("Please provide your name and email to register, or log in.");
      }
      logStep("Guest registration", { email: guestEmail });
      fullName = String(guestFullName).trim();
      email = String(guestEmail).trim();
      phone = guestPhone ? String(guestPhone).trim() : "";
    }

    logStep("Registrant resolved", { fullName, email, isGuest: !user });

    // Find guest list by share token
    const { data: guestList, error: glError } = await supabaseAdmin
      .from("guest_lists")
      .select("*, events!inner(id, title, start_at, end_at, venue_id)")
      .eq("share_token", shareToken)
      .eq("is_active", true)
      .single();

    if (glError || !guestList) {
      throw new Error("Guest list not found or inactive");
    }

    if (new Date(guestList.events.end_at) < new Date()) {
      throw new Error("Event has ended");
    }

    // Check user not already registered (logged-in path only; guests are
    // de-duplicated by email below).
    if (user) {
      const { data: existingByUser } = await supabaseAdmin
        .from("guest_list_entries")
        .select("id")
        .eq("guest_list_id", guestList.id)
        .eq("user_id", user.id)
        .neq("status", "cancelled")
        .maybeSingle();

      if (existingByUser) {
        throw new Error("You are already registered for this guest list");
      }
    }

    const { data: existingByEmail } = await supabaseAdmin
      .from("guest_list_entries")
      .select("id")
      .eq("guest_list_id", guestList.id)
      .eq("email", email.toLowerCase().trim())
      .neq("status", "cancelled")
      .maybeSingle();

    if (existingByEmail) {
      throw new Error("Email already registered for this guest list");
    }

    // Count current entries
    const { count: totalEntries } = await supabaseAdmin
      .from("guest_list_entries")
      .select("*", { count: "exact", head: true })
      .eq("guest_list_id", guestList.id)
      .neq("status", "cancelled");

    if ((totalEntries ?? 0) >= guestList.quota) {
      throw new Error("Guest list is full");
    }

    // A public self-signup takes the list's primary available kind (normal preferred);
    // the drink/VIP slots are filled by the promoter (app) or the owner. Enforce that
    // kind's per-type quota so a "10 normal + 2 VIP" list keeps its split.
    const qn = guestList.quota_normal ?? 0, qd = guestList.quota_drink ?? 0, qtb = guestList.quota_table ?? 0;
    const resolvedEntryType = qn > 0 ? "normal" : qd > 0 ? "drink" : qtb > 0 ? "table" : (guestList.entry_kind || "normal");
    const typeQuota = resolvedEntryType === "table" ? qtb : resolvedEntryType === "drink" ? qd : qn;
    if (typeQuota > 0) {
      const { count: typeCount } = await supabaseAdmin
        .from("guest_list_entries")
        .select("*", { count: "exact", head: true })
        .eq("guest_list_id", guestList.id)
        .eq("entry_type", resolvedEntryType)
        .neq("status", "cancelled");
      if ((typeCount ?? 0) >= typeQuota) {
        throw new Error("Guest list is full");
      }
    }

    // Check gender quotas
    if (gender && (guestList.quota_female || guestList.quota_male)) {
      if (gender === "female" && guestList.quota_female) {
        const { count: femaleCount } = await supabaseAdmin
          .from("guest_list_entries")
          .select("*", { count: "exact", head: true })
          .eq("guest_list_id", guestList.id)
          .eq("gender", "female")
          .neq("status", "cancelled");

        if ((femaleCount ?? 0) >= guestList.quota_female) {
          throw new Error("Female quota reached");
        }
      }

      if (gender === "male" && guestList.quota_male) {
        const { count: maleCount } = await supabaseAdmin
          .from("guest_list_entries")
          .select("*", { count: "exact", head: true })
          .eq("guest_list_id", guestList.id)
          .eq("gender", "male")
          .neq("status", "cancelled");

        if ((maleCount ?? 0) >= guestList.quota_male) {
          throw new Error("Male quota reached");
        }
      }
    }

    // Resolve promoter ID. Precedence:
    //   1. explicit ?ref= promoterCode (a promoter link layered on any part) — wins
    //   2. the part's own holder (holder_type='promoter') — the part link IS the
    //      promoter's link, so a signup through it attributes to that promoter and the
    //      door scan fires the commission (read from guest_list_entries.promoter_id).
    let promoterId: string | null = null;
    if (promoterCode) {
      const { data: promoter } = await supabaseAdmin
        .from("promoters")
        .select("id")
        .eq("promo_code", promoterCode)
        .eq("venue_id", guestList.venue_id)
        .maybeSingle();
      if (promoter) promoterId = promoter.id;
    }
    if (!promoterId && guestList.holder_type === "promoter" && guestList.promoter_id) {
      promoterId = guestList.promoter_id;
    }

    // Create/update venue_customer (works for guests too — user_id is optional)
    const nameParts = fullName.trim().split(" ");
    await supabaseAdmin.rpc("get_or_create_venue_customer", {
      p_venue_id: guestList.venue_id,
      p_user_id: user?.id ?? null,
      p_email: email.toLowerCase().trim(),
      p_first_name: nameParts[0] || null,
      p_last_name: nameParts.slice(1).join(" ") || null,
      p_phone: phone || null,
    });

    // Create the entry with YN-XXXXXX reservation code
    const qrCode = generateQRCode();
    const reservationCode = generateReservationCode();
    
    const { data: entry, error: insertError } = await supabaseAdmin
      .from("guest_list_entries")
      .insert({
        guest_list_id: guestList.id,
        user_id: user?.id ?? null,
        full_name: fullName.trim(),
        email: email.toLowerCase().trim(),
        phone: phone || "",
        gender: gender || null,
        qr_code: qrCode,
        reservation_code: reservationCode,
        status: "reserved",
        promoter_id: promoterId,
        // The resolved entry kind (normal | drink | table=VIP) is stamped so the door
        // scanner and drink credits know what the guest is entitled to.
        entry_type: resolvedEntryType,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      throw new Error("Failed to create guest list entry");
    }

    logStep("Entry created", { entryId: entry.id, userId: user?.id ?? null, reservationCode });

    // ── Grant drink credits if guest list includes_drink AND venue uses credits mode ──
    // Credits key on user_id, so only logged-in registrants get them here. A guest
    // who later creates an account (via /guest/finalize) can claim the drink then.
    if (resolvedEntryType === "drink" && user) {
      // Check venue free_drink_mode
      const { data: venueForDrink } = await supabaseAdmin
        .from("venues")
        .select("free_drink_mode")
        .eq("id", guestList.venue_id)
        .single();
      const drinkMode = venueForDrink?.free_drink_mode || 'credits';
      
      if (drinkMode === 'credits') {
        // Bind the credit to the soirée: expire at the event end, or (no end_at)
        // 8h after start. Never NULL — that would make the credit unredeemable.
        const expiresAt = guestList.events.end_at
          ? new Date(guestList.events.end_at).toISOString()
          : new Date(new Date(guestList.events.start_at).getTime() + 8 * 60 * 60 * 1000).toISOString();
        await supabaseAdmin
          .from("order_pack_credits")
          .upsert({
            user_id: user.id,
            venue_id: guestList.venue_id,
            event_id: guestList.events.id,
            pack_id: `gl-drink-${entry.id}`,
            total_credits: 1,
            used_credits: 0,
            expires_at: expiresAt,
          }, { onConflict: "user_id,pack_id" });
        logStep("Drink credits created for club GL", { userId: user.id });
      } else {
        logStep("Drink credits skipped for GL (bouncer_notify mode)", { userId: user.id });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        entry: {
          id: entry.id,
          qrCode: entry.qr_code,
          reservationCode: reservationCode,
          fullName: entry.full_name,
          email: entry.email,
          eventTitle: guestList.events.title,
          eventStartAt: guestList.events.start_at,
          freeBeforeTime: guestList.free_before_time,
          includesDrink: guestList.includes_drink,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
