import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { wrapEmailWithBranding, escapeHtml } from "../_shared/email-branding.ts";
import { restrictedCorsHeaders } from "../_shared/cors.ts";

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

/** Sanitize a poster URL for safe interpolation into an email img src. */
function safeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = String(url).trim();
  // Only allow http(s) URLs; block javascript:/data: and quote-breaking chars.
  if (!/^https?:\/\//i.test(u)) return null;
  if (/["'<>\s]/.test(u)) return null;
  return u;
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
      .select("id, user_id, venue_id, organizer_user_id, is_active, default_commission_template_id, promo_code")
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
      .select("id, title, venue_id, organizer_user_id, partner_organizer_id, start_at, poster_url")
      .eq("id", eventId)
      .maybeSingle();

    if (!event) throw new Error("Event not found");

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
    const guestList = promoterParts?.[0] as { id: string; quota: number; includes_drink: boolean; is_active: boolean; entry_deadline: string | null; quota_normal: number; quota_drink: number; quota_table: number } | undefined;
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

        const entryLabel = resolvedEntryType === "table" ? "Entrée Table VIP" : resolvedEntryType === "drink" ? "Entrée + Boisson offerte" : "Entrée standard";

        const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
        const RESEND_FROM = Deno.env.get("RESEND_FROM_EMAIL") || "noreply@yunoapp.eu";
        const APP_URL = "https://yunoapp.eu";

        if (RESEND_API_KEY) {
          const ctaUrl = linkedUserId
            ? `${APP_URL}/my-orders`
            : `${APP_URL}/auth?redirect=/my-orders`;

          const safeEventTitle = escapeHtml(event?.title || "Événement");
          const safeVenueName = escapeHtml(venueName);
          // Validate the URL scheme + reject quote/tag chars before interpolating
          // into src="…" — a crafted poster_url must not break out of the attribute.
          const eventImageUrl = safeImageUrl(event?.poster_url);

          const emailContent = `
            ${eventImageUrl ? `
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <img src="${eventImageUrl}" alt="${safeEventTitle}" style="width: 100%; max-height: 200px; object-fit: cover; display: block;" />
                </td>
              </tr>
            </table>
            ` : ''}

            <!-- Header gradient -->
            <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 24px 28px; text-align: center;">
              <div style="font-size: 20px; font-weight: bold; color: #fff; margin-bottom: 4px;">${safeVenueName}</div>
              <h1 style="color: white; margin: 0; font-size: 22px;">Vous êtes sur la Guest List</h1>
            </div>

            <!-- Content -->
            <div style="padding: 28px;">
              <!-- Details Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 24px;">
                ${eventDate ? `
                <tr>
                  <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <p style="color: #888; font-size: 12px; margin: 0;">📅 Date</p>
                    <p style="color: #fff; font-size: 14px; font-weight: 500; margin: 4px 0 0;">${eventDate}</p>
                  </td>
                </tr>
                ` : ''}
                <tr>
                  <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <p style="color: #888; font-size: 12px; margin: 0;">🎫 Type d'entrée</p>
                    <p style="color: #fff; font-size: 14px; font-weight: 500; margin: 4px 0 0;">${entryLabel}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px;">
                    <p style="color: #888; font-size: 12px; margin: 0;">👤 Invité par</p>
                    <p style="color: #fff; font-size: 14px; font-weight: 500; margin: 4px 0 0;">${escapeHtml(promoterName)}</p>
                  </td>
                </tr>
              </table>

              <!-- QR Code -->
              <div style="text-align: center; margin: 24px 0; padding: 24px 20px; background-color: #fff; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">
                <h3 style="color: #0a0a0a; margin-bottom: 16px; font-size: 17px; font-weight: 700;">QR Code d'entrée</h3>
                <div style="background: #f8f8f8; border-radius: 12px; padding: 20px; display: inline-block;">
                  <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}" alt="QR Code" style="width: 220px; height: 220px; display: block;" />
                </div>
                <div style="margin-top: 16px; background: #f5f5f5; border-radius: 8px; padding: 12px 16px; display: inline-block;">
                  <p style="color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">Code de réservation</p>
                  <p style="color: #0a0a0a; font-size: 20px; font-weight: 800; font-family: 'Courier New', monospace; letter-spacing: 2px; margin: 0;">${reservationCode}</p>
                </div>
              </div>

              <!-- CTA -->
              <div style="text-align: center; margin: 24px 0;">
                <a href="${ctaUrl}" style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px;">
                  ${linkedUserId ? "Voir dans Mes Commandes" : "Connectez-vous pour voir votre ticket"}
                </a>
                <p style="color: #666; font-size: 12px; margin: 10px 0 0;">
                  ${linkedUserId ? "Retrouvez votre invitation dans l'application Yuno" : "Créez un compte ou connectez-vous pour retrouver votre invitation"}
                </p>
              </div>

              <!-- Footer -->
              <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
                <p style="color: #666; font-size: 13px; margin: 0;">L'équipe Yuno</p>
              </div>
            </div>
          `;

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
