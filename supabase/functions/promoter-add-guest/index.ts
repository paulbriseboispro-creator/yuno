import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { wrapEmailWithBranding, escapeHtml } from "../_shared/email-branding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `GL-${Date.now()}-${code}`;
}

serve(async (req) => {
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
      .select("id, user_id, venue_id, is_active, default_commission_template_id, promo_code")
      .eq("id", promoterId)
      .single();

    if (!promoter || promoter.user_id !== user.id) {
      throw new Error("Unauthorized: you are not this promoter");
    }
    if (!promoter.is_active) {
      throw new Error("Promoter account is inactive");
    }

    logStep("Promoter verified", { promoterId, venueId: promoter.venue_id });

    const { data: event } = await supabaseAdmin
      .from("events")
      .select("id, title, venue_id, start_at, poster_url")
      .eq("id", eventId)
      .maybeSingle();

    if (!event) throw new Error("Event not found");
    if (event.venue_id !== promoter.venue_id) {
      throw new Error("Unauthorized: this event is not linked to your venue");
    }

    let guestList: { id: string; quota: number; is_active: boolean } | null = null;
    const { data: guestLists } = await supabaseAdmin
      .from("guest_lists")
      .select("id, quota, is_active")
      .eq("event_id", eventId)
      .eq("is_active", true)
      .limit(1);

    if (guestLists && guestLists.length > 0) {
      guestList = guestLists[0];
    } else {
      const { data: newGl, error: createGlError } = await supabaseAdmin
        .from("guest_lists")
        .insert({
          event_id: eventId,
          venue_id: promoter.venue_id,
          quota: 99999,
          free_before_time: "23:59",
          is_active: true,
          visible_on_club_page: false,
        })
        .select("id, quota, is_active")
        .single();
      if (createGlError || !newGl) {
        throw new Error("Failed to create guest list for promoter entries");
      }
      guestList = newGl;
      logStep("Auto-created guest list for promoter entries", { glId: newGl.id });
    }
    const normalizedName = fullName.trim();
    const normalizedEmail = (email || "").trim().toLowerCase();

    let existingEntry: { id: string; entry_type: string | null; qr_code: string | null; reservation_code: string | null } | null = null;

    if (normalizedEmail) {
      const { data: existingByEmailAndName } = await supabaseAdmin
        .from("guest_list_entries")
        .select("id, entry_type, qr_code, reservation_code")
        .eq("guest_list_id", guestList.id)
        .eq("promoter_id", promoterId)
        .ilike("email", normalizedEmail)
        .ilike("full_name", normalizedName)
        .neq("status", "cancelled")
        .maybeSingle();
      existingEntry = existingByEmailAndName;
    }

    const isUpdate = Boolean(existingEntry);

    const { data: promoterFull } = await supabaseAdmin
      .from("promoters")
      .select("guest_list_template_id")
      .eq("id", promoterId)
      .single();

    const glTemplateId = (promoterFull as any)?.guest_list_template_id;

    if (glTemplateId) {
      const { data: tmpl } = await supabaseAdmin
        .from("commission_templates")
        .select("rules")
        .eq("id", glTemplateId)
        .single();

      const rules = tmpl?.rules as any;
      if (rules?.guest_list) {
        const gl = rules.guest_list;
        let typeQuota: number | null = null;

        if (resolvedEntryType === "normal" && gl.normalQuota != null) typeQuota = gl.normalQuota;
        else if (resolvedEntryType === "table" && gl.tableQuota != null) typeQuota = gl.tableQuota;
        else if (resolvedEntryType === "drink" && gl.drinkQuota != null) typeQuota = gl.drinkQuota;

        const globalQuota = gl.quota ?? null;

        if (typeQuota != null) {
          let typeCountQuery = supabaseAdmin
            .from("guest_list_entries")
            .select("*", { count: "exact", head: true })
            .eq("guest_list_id", guestList.id)
            .eq("promoter_id", promoterId)
            .eq("entry_type", resolvedEntryType)
            .neq("status", "cancelled");

          if (isUpdate && existingEntry) {
            typeCountQuery = typeCountQuery.neq("id", existingEntry.id);
          }

          const { count: typeCount } = await typeCountQuery;
          if ((typeCount ?? 0) >= typeQuota) {
            throw new Error(`Quota atteint pour le type "${resolvedEntryType}"`);
          }
        }

        if (globalQuota != null && !isUpdate) {
          const { count: totalByPromoter } = await supabaseAdmin
            .from("guest_list_entries")
            .select("*", { count: "exact", head: true })
            .eq("guest_list_id", guestList.id)
            .eq("promoter_id", promoterId)
            .neq("status", "cancelled");

          if ((totalByPromoter ?? 0) >= globalQuota) {
            throw new Error("Quota global de guest list atteint");
          }
        }
      }
    }

    if (!isUpdate && guestList.quota != null) {
      const { count: totalEntries } = await supabaseAdmin
        .from("guest_list_entries")
        .select("*", { count: "exact", head: true })
        .eq("guest_list_id", guestList.id)
        .neq("status", "cancelled");

      if ((totalEntries ?? 0) >= guestList.quota) {
        throw new Error("Guest list is full");
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

    let entryDeadlineValue: string | null = null;
    if (glTemplateId) {
      const { data: tmplForDeadline } = await supabaseAdmin
        .from("commission_templates")
        .select("rules")
        .eq("id", glTemplateId)
        .single();
      const deadlineRules = tmplForDeadline?.rules as any;
      if (deadlineRules?.guest_list?.entryDeadline) {
        entryDeadlineValue = deadlineRules.guest_list.entryDeadline;
      }
    }

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
        throw new Error("Failed to update guest");
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
        throw new Error("Failed to add guest");
      }

      entryId = insertedEntry.id;
      logStep("Guest added", { entryId, entryType: resolvedEntryType, reservationCode, linkedUserId });
    }

    if (resolvedEntryType === "drink" && linkedUserId) {
      let creditCount = 1;
      if (glTemplateId) {
        const { data: tmplDrink } = await supabaseAdmin
          .from("commission_templates")
          .select("rules")
          .eq("id", glTemplateId)
          .single();
        const drinkRules = tmplDrink?.rules as any;
        creditCount = drinkRules?.guest_list?.drinkCount || 1;
      }

      const expiresAt = new Date(new Date(event.start_at).getTime() + 24 * 60 * 60 * 1000).toISOString();

      await supabaseAdmin
        .from("order_pack_credits")
        .upsert({
          user_id: linkedUserId,
          venue_id: promoter.venue_id,
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
          const eventImageUrl = event?.poster_url || null;

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
