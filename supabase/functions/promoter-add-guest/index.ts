import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { wrapEmailWithBranding } from "../_shared/email-branding.ts";
import { restrictedCorsHeaders } from "../_shared/cors.ts";
import { sendAutoPush } from "../_shared/auto-push.ts";
import { entryTypeLabelFr, guestListEntryEmailContent } from "../_shared/guest-list-email.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[PROMOTER-ADD-GUEST] ${step}`, details ? JSON.stringify(details) : "");
};

function generateReservationCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `YN-${code}`;
}

function generateQRCode(): string {
  // Cryptographically-random, unguessable code (Deno global crypto). A QR code is
  // a door credential — a Date.now()+Math.random() code is guessable/enumerable.
  // Aligned with create-guest-list-entry.
  return `GL-${crypto.randomUUID()}`;
}

/** Map the atomic-capacity trigger's error to a clean client message (else null). */
function capacityErrorMessage(err: { message?: string; code?: string } | null): string | null {
  const msg = err?.message || "";
  if (msg.includes("Female quota reached")) return "Female quota reached";
  if (msg.includes("Male quota reached")) return "Male quota reached";
  if (msg.includes("Guest list is full")) return "Guest list is full";
  if (err?.code === "23505") return "This guest is already on the list";
  return null;
}

serve(async (req) => {
  const corsHeaders = restrictedCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Authentication required");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw new Error("Authentication required");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { promoterId, eventId, fullName, gender, email, entryType } = await req.json();

    if (!promoterId || !eventId || !fullName?.trim()) {
      throw new Error("Missing required fields: promoterId, eventId, fullName");
    }

    const resolvedEntryType = entryType || "normal";

    const { data: promoter } = await supabaseAdmin
      .from("promoters")
      .select("id, user_id, venue_id, organizer_user_id, is_active, default_commission_template_id, promo_code, agency_id, agency_guestlist_quota")
      .eq("id", promoterId)
      .single();

    if (!promoter || promoter.user_id !== user.id) {
      throw new Error("Unauthorized: you are not this promoter");
    }
    if (!promoter.is_active) {
      throw new Error("Promoter account is inactive");
    }

    logStep("Promoter verified", { promoterId, venueId: promoter.venue_id, organizerUserId: promoter.organizer_user_id });

    const { data: event } = await supabaseAdmin
      .from("events")
      .select("id, title, venue_id, organizer_user_id, partner_organizer_id, start_at, end_at, poster_url")
      .eq("id", eventId)
      .maybeSingle();

    if (!event) throw new Error("Event not found");
    // Pas d'ajout d'invité sur une soirée déjà terminée.
    if (event.end_at && new Date(event.end_at) < new Date()) {
      throw new Error("Event has ended");
    }

    // A promoter is scoped to a club (venue_id) OR an organizer. Authorize accordingly.
    const venueMatch = !!promoter.venue_id && event.venue_id === promoter.venue_id;
    const orgMatch = !!promoter.organizer_user_id &&
      (event.organizer_user_id === promoter.organizer_user_id || event.partner_organizer_id === promoter.organizer_user_id);
    if (!venueMatch && !orgMatch) {
      throw new Error("Unauthorized: this event is not linked to your account");
    }

    // The promoter's guest list is now their OWN allocation: a guest_lists "part" with
    // holder_type='promoter', created and capped by the club on the Guest List page. The
    // commission template no longer carries any guest-list config — it is purely money.
    // No allocation = the promoter can't add (they ask the club to set one up).
    const { data: promoterParts } = await supabaseAdmin
      .from("guest_lists")
      .select("id, quota, includes_drink, is_active, entry_deadline, quota_normal, quota_drink, quota_table")
      .eq("event_id", eventId)
      .eq("holder_type", "promoter")
      .eq("promoter_id", promoterId)
      .limit(1);
    // quota NULL = allocation illimitée (accordée par le club).
    const guestList = promoterParts?.[0] as { id: string; quota: number | null; includes_drink: boolean; is_active: boolean; entry_deadline: string | null; quota_normal: number; quota_drink: number; quota_table: number } | undefined;
    if (!guestList || !guestList.is_active) {
      throw new Error("No guest list allocation for this event. Ask your club to set it up.");
    }
    const normalizedName = fullName.trim();
    const normalizedEmail = (email || "").trim().toLowerCase();

    let existingEntry: { id: string; entry_type: string | null; qr_code: string | null; reservation_code: string | null } | null = null;

    if (normalizedEmail) {
      // Dedup on the normalized email only (the real unique key, stored lowercased).
      // The previous .ilike() treated user-supplied %/_ as wildcards — a name/email
      // with those chars could match the wrong row or blow up maybeSingle().
      const { data: existingByEmail } = await supabaseAdmin
        .from("guest_list_entries")
        .select("id, entry_type, qr_code, reservation_code")
        .eq("guest_list_id", guestList.id)
        .eq("promoter_id", promoterId)
        .eq("email", normalizedEmail)
        .neq("status", "cancelled")
        .maybeSingle();
      existingEntry = existingByEmail;
    }

    const isUpdate = Boolean(existingEntry);
    // Re-inviting an existing guest at a DIFFERENT entry_type re-consumes a slot of
    // the new type. Without this, a promoter could add N guests as "normal" then
    // flip them one by one to "table"/"drink" and blow past the per-type allocation
    // (the per-type checks below were gated on !isUpdate). The DB trigger enforces
    // this atomically too; here we surface the clean quota message.
    const typeChanging = isUpdate
      && (resolvedEntryType !== ((existingEntry?.entry_type) || "normal"));

    // Enforce the promoter part's quotas (set by the club on the Guest List page):
    // the per-type allocation (e.g. 10 normal + 2 VIP) AND the global total.
    // Legacy parts created before per-type allocation have all-zero per-type quotas —
    // treat those as standard-only against the global quota (no per-type rejection).
    const hasPerType = ((guestList.quota_normal ?? 0) + (guestList.quota_drink ?? 0) + (guestList.quota_table ?? 0)) > 0;
    if ((!isUpdate || typeChanging) && hasPerType) {
      const typeQuota = resolvedEntryType === "table" ? guestList.quota_table
        : resolvedEntryType === "drink" ? guestList.quota_drink
        : guestList.quota_normal;
      if (typeQuota != null && typeQuota > 0) {
        const { count: typeCount } = await supabaseAdmin
          .from("guest_list_entries")
          .select("*", { count: "exact", head: true })
          .eq("guest_list_id", guestList.id)
          .eq("entry_type", resolvedEntryType)
          .neq("status", "cancelled");
        if ((typeCount ?? 0) >= typeQuota) {
          throw new Error(`Quota reached for "${resolvedEntryType}" entries`);
        }
      } else if (typeQuota === 0) {
        // The allocation doesn't offer this entry kind at all.
        throw new Error(`This guest list doesn't offer "${resolvedEntryType}" entries`);
      }
    }
    // Global total cap always applies (per-type or legacy single-quota parts alike).
    if (!isUpdate && guestList.quota != null) {
      const { count: totalEntries } = await supabaseAdmin
        .from("guest_list_entries")
        .select("*", { count: "exact", head: true })
        .eq("guest_list_id", guestList.id)
        .neq("status", "cancelled");
      if ((totalEntries ?? 0) >= guestList.quota) {
        throw new Error("Guest list quota reached");
      }
    }

    // Agency-managed promoters: the agency's own guest-list rule applies ON TOP
    // of the club's allocation (rule templates: NULL = guest list not allowed,
    // 0 = unlimited, N = max entries per event for this promoter).
    if (!isUpdate && promoter.agency_id) {
      const agencyQuota = promoter.agency_guestlist_quota as number | null;
      if (agencyQuota === null || agencyQuota === undefined) {
        throw new Error("Your agency hasn't enabled guest list access for you");
      }
      if (agencyQuota > 0) {
        const { count: agencyCount } = await supabaseAdmin
          .from("guest_list_entries")
          .select("*", { count: "exact", head: true })
          .eq("guest_list_id", guestList.id)
          .eq("promoter_id", promoterId)
          .neq("status", "cancelled");
        if ((agencyCount ?? 0) >= agencyQuota) {
          throw new Error("Agency guest list quota reached");
        }
      }
    }

    let linkedUserId: string | null = null;
    if (normalizedEmail) {
      const { data: existingProfile } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", normalizedEmail)
        .maybeSingle();
      if (existingProfile) {
        linkedUserId = existingProfile.id;
        logStep("Auto-linked to existing user", { userId: linkedUserId });
      }
    }

    let entryId = "";
    let qrCode = existingEntry?.qr_code || "";
    let reservationCode = existingEntry?.reservation_code || "";
    let wasUpdated = false;

    // Entry deadline now comes from the promoter part itself (set by the club).
    const entryDeadlineValue: string | null = guestList.entry_deadline ?? null;

    if (isUpdate && existingEntry) {
      const updatePayload: Record<string, unknown> = {
        full_name: normalizedName,
        email: normalizedEmail,
        gender: gender || null,
        status: "confirmed",
        entry_type: resolvedEntryType,
        entry_deadline: entryDeadlineValue,
      };
      if (linkedUserId) updatePayload.user_id = linkedUserId;

      const { data: updatedEntry, error: updateError } = await supabaseAdmin
        .from("guest_list_entries")
        .update(updatePayload)
        .eq("id", existingEntry.id)
        .select("id, qr_code, reservation_code")
        .single();

      if (updateError || !updatedEntry) {
        console.error("Update error:", updateError);
        throw new Error(capacityErrorMessage(updateError) || "Failed to update guest");
      }

      entryId = updatedEntry.id;
      qrCode = updatedEntry.qr_code || qrCode;
      reservationCode = (updatedEntry as any).reservation_code || reservationCode;
      wasUpdated = true;
      logStep("Guest updated", { entryId, entryType: resolvedEntryType });
    } else {
      qrCode = generateQRCode();
      reservationCode = generateReservationCode();

      const insertPayload: Record<string, unknown> = {
        guest_list_id: guestList.id,
        full_name: normalizedName,
        email: normalizedEmail,
        phone: "",
        qr_code: qrCode,
        reservation_code: reservationCode,
        gender: gender || null,
        promoter_id: promoterId,
        status: "confirmed",
        entry_type: resolvedEntryType,
        entry_deadline: entryDeadlineValue,
      };
      if (linkedUserId) insertPayload.user_id = linkedUserId;

      const { data: insertedEntry, error: insertError } = await supabaseAdmin
        .from("guest_list_entries")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertError || !insertedEntry) {
        console.error("Insert error:", insertError);
        throw new Error(capacityErrorMessage(insertError) || "Failed to add guest");
      }

      entryId = insertedEntry.id;
      logStep("Guest added", { entryId, entryType: resolvedEntryType, reservationCode, linkedUserId });
    }

    // Drink credits need a venue to be redeemable at the bar. Organizer-only events with
    // no host venue can't carry bar credits, so skip them (the invite still stands).
    const creditVenueId = event.venue_id ?? promoter.venue_id ?? null;
    if (resolvedEntryType === "drink" && linkedUserId && creditVenueId) {
      const creditCount = 1;
      const expiresAt = new Date(new Date(event.start_at).getTime() + 24 * 60 * 60 * 1000).toISOString();

      await supabaseAdmin
        .from("order_pack_credits")
        .upsert({
          user_id: linkedUserId,
          venue_id: creditVenueId,
          event_id: eventId,
          pack_id: `gl-drink-${entryId}`,
          total_credits: creditCount,
          used_credits: 0,
          expires_at: expiresAt,
        }, { onConflict: "user_id,pack_id" });

      logStep("Drink credits created", { userId: linkedUserId, credits: creditCount });
    }

    // Send invitation email with Yuno branding
    if (normalizedEmail) {
      try {
        let venueName = "";
        if (event?.venue_id) {
          const { data: venue } = await supabaseAdmin
            .from("venues")
            .select("name")
            .eq("id", event.venue_id)
            .single();
          venueName = venue?.name || "";
        }

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("first_name, last_name")
          .eq("id", promoter.user_id)
          .single();
        const promoterName = profile ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim() : promoter.promo_code;

        const eventDate = event?.start_at
          ? new Date(event.start_at).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
          : "";

        const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
        const RESEND_FROM = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@yunoapp.eu";
        const APP_URL = "https://yunoapp.eu";

        if (RESEND_API_KEY) {
          const ctaUrl = linkedUserId
            ? `${APP_URL}/my-orders`
            : `${APP_URL}/auth?redirect=/my-orders`;

          // Gabarit partagé avec guest-list-manage (_shared/guest-list-email.ts).
          const emailContent = guestListEntryEmailContent({
            eventTitle: event?.title || "Événement",
            eventDate,
            venueName,
            posterUrl: event?.poster_url,
            entryLabel: entryTypeLabelFr(resolvedEntryType),
            invitedBy: promoterName,
            qrCode,
            reservationCode,
            ctaUrl,
            hasAccount: !!linkedUserId,
          });

          const html = wrapEmailWithBranding(emailContent, 'fr', venueName);

          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: RESEND_FROM,
              to: [normalizedEmail],
              subject: `Guest List - ${event?.title || "Événement"}`,
              html,
            }),
          });

          logStep("Invitation email sent", { to: normalizedEmail, hasAccount: !!linkedUserId });
        } else {
          logStep("RESEND_API_KEY not set, skipping email");
        }
      } catch (emailErr) {
        console.error("Email sending failed (non-blocking):", emailErr);
      }
    }

    // Push « tu es sur la guest list » — seulement pour les invités qui ont un
    // compte Yuno (linkedUserId), à la première inscription (pas aux mises à
    // jour). Registre auto (clé 'guest_list_added') : gate + langue + tracking.
    if (linkedUserId && !wasUpdated) {
      try {
        await sendAutoPush(supabaseAdmin, {
          key: "guest_list_added",
          userId: linkedUserId,
          url: "/my-orders",
          vars: { event: event?.title || { fr: "Événement", en: "Event", es: "Evento" } },
        });
      } catch (pushErr) {
        console.error("Guest list push failed (non-blocking):", pushErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, entryId, updated: wasUpdated, reservationCode }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }
});
