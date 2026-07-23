import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { restrictedCorsHeaders } from "../_shared/cors.ts";

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

/** Un `tl` venant de l'URL est une donnée non fiable : forme validée avant requête. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RFC-lite email check — good enough to reject junk before it hits the list. */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

/** SHA-256 of the client IP (never store the raw IP for a throttle). */
async function hashIp(ip: string): Promise<string> {
  if (!ip) return "";
  const data = new TextEncoder().encode(`gl-signup:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-GUEST-LIST-ENTRY] ${step}`, details ? JSON.stringify(details) : "");
};

serve(async (req) => {
  // CORS locked to the app's own origins (yunoapp.eu, native app, local dev,
  // Cloudflare previews) instead of "*" — no arbitrary site drives this endpoint
  // from a browser.
  const corsHeaders = restrictedCorsHeaders(req);
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

    const { shareToken, inviteToken, trackedLinkId, entryType, gender, promoterCode, guestEmail, guestFullName, guestPhone } = await req.json();

    // Deux portes d'entrée : le lien public de la part (shareToken) ou un lien
    // unique personnel (inviteToken, table guest_list_invites).
    if (!shareToken && !inviteToken) {
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

    // Un lien unique multi-places doit permettre à un utilisateur loggé
    // d'inscrire AUSSI un proche : des coordonnées explicites priment alors
    // sur l'identité du JWT (l'entrée est celle du proche, sans user_id).
    const hasExplicitGuestInfo = Boolean(guestEmail && guestFullName);
    const useProfileIdentity = Boolean(user) && !hasExplicitGuestInfo;

    if (user && useProfileIdentity) {
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

    // Input validation (backstop — the endpoint is public, no JWT on the guest path).
    // Length caps keep junk/oversized rows out; email format keeps the list clean.
    if (!fullName || fullName.length < 1 || fullName.length > 120) {
      throw new Error("Please provide a valid name.");
    }
    if (!isValidEmail(email)) {
      throw new Error("Please provide a valid email address.");
    }
    if (phone.length > 40) {
      throw new Error("Please provide a valid phone number.");
    }

    // registrantUser = identité réellement inscrite (null quand un loggé inscrit
    // un proche via des coordonnées explicites) — gouverne user_id, le check
    // « déjà inscrit » et le crédit boisson.
    const registrantUser = useProfileIdentity ? user : null;

    logStep("Registrant resolved", { fullName, email, isGuest: !registrantUser });

    // Résolution de la part : lien unique (invite) d'abord, sinon lien public.
    let invite: { id: string; entry_type: string; max_uses: number; used_count: number; revoked_at: string | null } | null = null;
    let guestListId: string | null = null;

    if (inviteToken) {
      const { data: inviteRow } = await supabaseAdmin
        .from("guest_list_invites")
        .select("id, guest_list_id, entry_type, max_uses, used_count, revoked_at")
        .eq("token", inviteToken)
        .maybeSingle();
      if (!inviteRow) {
        throw new Error("Invite link not found");
      }
      if (inviteRow.revoked_at) {
        throw new Error("This invite link has been revoked");
      }
      // Pré-check lisible ; le claim atomique ci-dessous reste l'arbitre final.
      if ((inviteRow.used_count ?? 0) >= inviteRow.max_uses) {
        throw new Error("This invite link has no remaining spots");
      }
      invite = inviteRow;
      guestListId = inviteRow.guest_list_id;
    }

    const glQuery = supabaseAdmin
      .from("guest_lists")
      .select("*, events!inner(id, title, start_at, end_at, venue_id)")
      .eq("is_active", true);
    const { data: guestList, error: glError } = await (guestListId
      ? glQuery.eq("id", guestListId)
      : glQuery.eq("share_token", shareToken)
    ).single();

    if (glError || !guestList) {
      throw new Error("Guest list not found or inactive");
    }

    if (new Date(guestList.events.end_at) < new Date()) {
      throw new Error("Event has ended");
    }

    // Anti-bot throttle — public, JWT-less endpoint. Counted before the dedup/quota
    // work so it also blunts email enumeration. Generous + fail-open (see the RPC):
    // only a scripted loop trips it, not a venue crowd behind one NAT.
    const clientIp = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    const ipHash = await hashIp(clientIp);
    const { data: throttleOk } = await supabaseAdmin.rpc("bump_guest_signup_throttle", {
      _ip_hash: ipHash,
      _guest_list_id: guestList.id,
      _max: 30,
      _window_seconds: 120,
    });
    if (throttleOk === false) {
      throw new Error("Too many attempts, please try again in a few minutes.");
    }

    // Gender is required when the list runs a gendered split — otherwise an
    // omitted/junk gender consumes a total slot while dodging the F/M caps
    // entirely (the client already enforces this; this is the server backstop
    // for tampered links or direct API calls).
    const normalizedGender = typeof gender === "string"
      ? (["female", "f", "femme"].includes(gender.trim().toLowerCase()) ? "female"
        : ["male", "m", "homme"].includes(gender.trim().toLowerCase()) ? "male"
        : null)
      : null;
    if (((guestList.quota_female ?? 0) > 0 || (guestList.quota_male ?? 0) > 0) && !normalizedGender) {
      throw new Error("Gender is required for this guest list");
    }

    // Check user not already registered (logged-in path only; guests are
    // de-duplicated by email below).
    if (registrantUser) {
      const { data: existingByUser } = await supabaseAdmin
        .from("guest_list_entries")
        .select("id")
        .eq("guest_list_id", guestList.id)
        .eq("user_id", registrantUser.id)
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

    // quota NULL = liste illimitée (jamais pleine). Sans ce garde, `count >= null`
    // se coerce en `count >= 0` → inscription publique toujours refusée.
    if (guestList.quota != null && (totalEntries ?? 0) >= guestList.quota) {
      throw new Error("Guest list is full");
    }

    // Canal de diffusion (lien suivi Instagram/WhatsApp/… posé par /l/<code>) :
    // purement une attribution, jamais une autorisation. Un id inconnu, inactif
    // ou visant une autre part est ignoré — l'inscription passe quand même,
    // elle est juste non attribuée. Même contrat que le `tl` des checkouts.
    let resolvedTrackedLinkId: string | null = null;
    if (trackedLinkId && UUID_RE.test(String(trackedLinkId))) {
      const { data: linkRow } = await supabaseAdmin
        .from("tracked_links")
        .select("id, guest_list_id, event_id, is_active")
        .eq("id", trackedLinkId)
        .maybeSingle();
      if (
        linkRow?.is_active &&
        (linkRow.guest_list_id === guestList.id || linkRow.event_id === guestList.events.id)
      ) {
        resolvedTrackedLinkId = linkRow.id;
      }
    }

    // Résolution du type d'entrée, par canal :
    //   - lien unique  → le type est IMPOSÉ par l'invitation ;
    //   - lien public avec offre configurée (public_entry_types) → le guest
    //     choisit parmi les types offerts (défaut : le premier de l'offre) ;
    //   - lien public historique (public_entry_types NULL) → type primaire
    //     résolu automatiquement (normal de préférence), comportement inchangé.
    const qn = guestList.quota_normal ?? 0, qd = guestList.quota_drink ?? 0, qtb = guestList.quota_table ?? 0;
    const offeredTypes: string[] | null = Array.isArray(guestList.public_entry_types) && guestList.public_entry_types.length > 0
      ? guestList.public_entry_types
      : null;
    const requestedType = typeof entryType === "string" && ["normal", "drink", "table"].includes(entryType)
      ? entryType
      : null;
    let resolvedEntryType: string;
    if (invite) {
      resolvedEntryType = invite.entry_type;
    } else if (offeredTypes) {
      if (requestedType && !offeredTypes.includes(requestedType)) {
        throw new Error("This entry type is not offered on this guest list");
      }
      resolvedEntryType = requestedType ?? offeredTypes[0];
    } else {
      resolvedEntryType = qn > 0 ? "normal" : qd > 0 ? "drink" : qtb > 0 ? "table" : (guestList.entry_kind || "normal");
    }
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

    // Check gender quotas (on the NORMALIZED gender). The DB trigger is the final
    // arbiter under concurrency; this is the fast pre-check.
    if (normalizedGender && (guestList.quota_female || guestList.quota_male)) {
      if (normalizedGender === "female" && guestList.quota_female) {
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

      if (normalizedGender === "male" && guestList.quota_male) {
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
      p_user_id: registrantUser?.id ?? null,
      p_email: email.toLowerCase().trim(),
      p_first_name: nameParts[0] || null,
      p_last_name: nameParts.slice(1).join(" ") || null,
      p_phone: phone || null,
    });

    // Un lien unique réserve sa place AVANT l'insertion (UPDATE conditionnel
    // atomique : deux claims concurrents ne dépassent jamais max_uses). Si le
    // trigger de capacité rejette ensuite l'insertion, la place est relâchée.
    if (invite) {
      const { data: claimed } = await supabaseAdmin.rpc("claim_guest_list_invite_use", {
        _invite_id: invite.id,
      });
      if (claimed !== true) {
        throw new Error("This invite link has no remaining spots");
      }
    }

    // Create the entry with YN-XXXXXX reservation code
    const qrCode = generateQRCode();
    const reservationCode = generateReservationCode();

    const { data: entry, error: insertError } = await supabaseAdmin
      .from("guest_list_entries")
      .insert({
        guest_list_id: guestList.id,
        user_id: registrantUser?.id ?? null,
        invite_id: invite?.id ?? null,
        tracked_link_id: resolvedTrackedLinkId,
        full_name: fullName.trim(),
        email: email.toLowerCase().trim(),
        phone: phone || "",
        // Store the normalized gender ('female'|'male'|null) so the F/M caps and
        // the door counters stay consistent (never 'F'/'femme').
        gender: normalizedGender,
        qr_code: qrCode,
        reservation_code: reservationCode,
        status: "reserved",
        promoter_id: promoterId,
        // The resolved entry kind (normal | drink | table=VIP) is stamped so the door
        // scanner and drink credits know what the guest is entitled to.
        entry_type: resolvedEntryType,
        // Copy the owner-configured entry deadline onto the entry (parity with
        // promoter-add-guest) so the door scanner enforces the same condition
        // regardless of the sign-up channel.
        entry_deadline: guestList.entry_deadline ?? null,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      // L'insertion a échoué : on relâche la place du lien unique réservée
      // au-dessus (best-effort — un échec ici laisse au pire une place fantôme
      // sur le lien, jamais une entrée fantôme).
      if (invite) {
        await supabaseAdmin.rpc("release_guest_list_invite_use", { _invite_id: invite.id }).then(
          () => {},
          (releaseErr: unknown) => console.error("Invite release failed:", releaseErr),
        );
      }
      // Le trigger enforce_guest_list_capacity (verrou atomique côté base) est
      // l'arbitre final sous forte concurrence : ses messages doivent remonter
      // tels quels — le front matche « full » / « quota reached ».
      const triggerMsg = insertError.message || "";
      if (triggerMsg.includes("Guest list is full") || triggerMsg.includes("quota reached")) {
        throw new Error(triggerMsg.includes("Female") ? "Female quota reached"
          : triggerMsg.includes("Male") ? "Male quota reached"
          : "Guest list is full");
      }
      if (insertError.code === "23505") {
        throw new Error("Email already registered for this guest list");
      }
      throw new Error("Failed to create guest list entry");
    }

    logStep("Entry created", { entryId: entry.id, userId: registrantUser?.id ?? null, inviteId: invite?.id ?? null, reservationCode });

    // ── Grant drink credits if guest list includes_drink AND venue uses credits mode ──
    // Credits key on user_id, so only logged-in registrants get them here. A guest
    // who later creates an account (via /guest/finalize) can claim the drink then.
    if (resolvedEntryType === "drink" && registrantUser) {
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
            user_id: registrantUser.id,
            venue_id: guestList.venue_id,
            event_id: guestList.events.id,
            pack_id: `gl-drink-${entry.id}`,
            total_credits: 1,
            used_credits: 0,
            expires_at: expiresAt,
          }, { onConflict: "user_id,pack_id" });
        logStep("Drink credits created for club GL", { userId: registrantUser.id });
      } else {
        logStep("Drink credits skipped for GL (bouncer_notify mode)", { userId: registrantUser.id });
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
          entryType: resolvedEntryType,
        },
        // Places restantes sur le lien unique après CETTE inscription (le front
        // propose « inscrire une autre personne » tant qu'il en reste).
        inviteRemaining: invite ? Math.max(0, invite.max_uses - invite.used_count - 1) : null,
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
