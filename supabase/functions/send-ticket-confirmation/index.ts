import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import QRCode from "https://esm.sh/qrcode@1.5.3";
import {
  EmailLanguage,
  t,
  wrapEmailWithBranding,
  escapeHtml,
} from "../_shared/email-branding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SEND-TICKET-CONFIRMATION] ${step}${detailsStr}`);
};

interface TicketConfirmationRequest {
  ticketId: string;
  email: string;
  firstName?: string;
  isGuest?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { ticketId, email, firstName, isGuest } =
      (await req.json()) as TicketConfirmationRequest;

    if (!ticketId || !email) {
      throw new Error("ticketId and email are required");
    }

    // Fetch ticket with round & event details
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("tickets")
      .select(`
        id, qr_code, reference_code, quantity, unit_price, total_price, full_name, user_email, user_id, status,
        ticket_round_id, event_id,
        ticket_rounds(name),
        events!inner(id, title, start_at, venue_id, poster_url, location_name, location_address, location_is_secret, reveal_address_in_email, venues!events_venue_id_fkey(name, address))
      `)
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) throw new Error("Ticket not found");

    if (ticket.status !== "paid") {
      throw new Error("Ticket not paid");
    }

    // Verify email matches
    if (ticket.user_email !== email) {
      throw new Error("Email mismatch");
    }

    const event = ticket.events as any;
    const venue = event?.venues;
    const round = ticket.ticket_rounds as any;
    const venueName = venue?.name || event?.location_name || "";
    const eventTitle = event?.title || "";

    // Get user's preferred language
    let lang: EmailLanguage = "fr";
    if (ticket.user_id) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("preferred_language")
        .eq("id", ticket.user_id)
        .single();
      if (
        profile?.preferred_language &&
        ["en", "es", "fr"].includes(profile.preferred_language)
      ) {
        lang = profile.preferred_language as EmailLanguage;
      }
    }

    const safeFirstName = escapeHtml(firstName || ticket.full_name?.split(" ")[0]) || "";
    const safeVenueName = escapeHtml(venueName);
    const safeEventTitle = escapeHtml(eventTitle);
    const safeRoundName = escapeHtml(round?.name);
    // Secret-location reveal: show the exact address only when the event isn't
    // secret, or when the organizer chose to reveal it in the confirmation email.
    // Otherwise the organizer sends it themselves (e.g. a scheduled campaign).
    const isSecret = !!event?.location_is_secret;
    const revealInEmail = event?.reveal_address_in_email !== false;
    const rawAddress = venue?.address || event?.location_address || "";
    const venueAddress = rawAddress && (!isSecret || revealInEmail) ? escapeHtml(rawAddress) : "";
    const addressDeferred = isSecret && !revealInEmail;
    const addressDeferredText = lang === "fr"
      ? "L'adresse exacte vous sera communiquée par email par l'organisateur avant l'événement."
      : lang === "es"
      ? "La dirección exacta te será comunicada por email por el organizador antes del evento."
      : "The exact address will be sent to you by email by the host before the event.";

    // Format event date
    const dateLocales: Record<EmailLanguage, string> = {
      en: "en-GB",
      es: "es-ES",
      fr: "fr-FR",
    };
    let formattedDate = "";
    try {
      const d = new Date(event.start_at);
      formattedDate = d.toLocaleDateString(dateLocales[lang], {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Paris",
      });
    } catch {
      /* ignore */
    }

    // Build app base URL from environment
    const appBaseUrl = Deno.env.get("APP_BASE_URL") || "https://yunoapp.eu";

    const qrData = ticket.qr_code || ticketId;
    const qrCodeSvg = await QRCode.toString(qrData, {
      type: "svg",
      width: 300,
      margin: 2,
      color: { dark: "#000000", light: "#FFFFFF" },
    });
    const qrCodeDataUrl = `data:image/svg+xml;base64,${btoa(qrCodeSvg)}`;

    // Short human reference (TK-XXXXXX) shown in the email and typed into the
    // "Find my order" claim flow. The QR itself still encodes the full qr_code
    // (above) for door scanning. Fall back to the legacy long qr_code for any
    // ticket created before reference_code existed.
    const ticketRef = ticket.reference_code || ticket.qr_code || ticketId.slice(0, 8).toUpperCase();

    const eventImageUrl = event?.poster_url || null;

    // Build guest-specific blocks
    const guestBlock = isGuest
      ? `
        <div style="margin-top: 24px;">
          <!-- Claim order link -->
          <div style="background: rgba(220, 38, 38, 0.08); border: 1px solid rgba(220, 38, 38, 0.2); border-radius: 12px; padding: 20px; margin-bottom: 16px; text-align: center;">
            <p style="color: #fff; font-size: 15px; font-weight: 600; margin: 0 0 8px;">${t("ticket.guestClaimTitle", lang)}</p>
            <p style="color: #999; font-size: 13px; margin: 0 0 16px;">${t("ticket.guestClaimDesc", lang)}</p>
            <a href="${appBaseUrl}/claim?type=ticket&ref=${encodeURIComponent(ticketRef)}" style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">
              ${t("ticket.guestClaimCta", lang)} →
            </a>
          </div>
          <!-- Create account link -->
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; text-align: center;">
            <p style="color: #999; font-size: 13px; margin: 0 0 12px;">${t("ticket.guestFinalize", lang)}</p>
            <a href="${appBaseUrl}/guest/finalize?email=${encodeURIComponent(email)}" style="display: inline-block; background: rgba(255,255,255,0.08); color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-weight: 500; font-size: 13px; border: 1px solid rgba(255,255,255,0.15);">
              ${t("ticket.guestFinalizeCta", lang)}
            </a>
          </div>
        </div>
      `
      : "";

    const emailContent = `
      ${
        eventImageUrl
          ? `
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <img src="${eventImageUrl}" alt="${safeEventTitle}" style="width: 100%; max-height: 200px; object-fit: cover; display: block;" />
          </td>
        </tr>
      </table>
      `
          : ""
      }
      
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 24px 28px; text-align: center;">
        <div style="font-size: 20px; font-weight: bold; color: #fff; margin-bottom: 4px;">${safeVenueName}</div>
        <h1 style="color: white; margin: 0; font-size: 22px;">${t("ticket.confirmedTitle", lang)}</h1>
      </div>

      <!-- Content -->
      <div style="padding: 28px;">
        <p style="color: #fff; font-size: 16px; margin-bottom: 16px;">
          ${safeFirstName ? `${t("ticket.greeting", lang)} ${safeFirstName}!` : `${t("ticket.greeting", lang)}!`}
        </p>

        <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
          ${t("ticket.body", lang, { eventTitle: safeEventTitle, venueName: safeVenueName })}
        </p>

        <!-- Ticket Details -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 24px;">
          ${
            formattedDate
              ? `
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);">
              <p style="color: #888; font-size: 12px; margin: 0;">📅 ${t("ticket.eventDate", lang)}</p>
              <p style="color: #fff; font-size: 14px; font-weight: 500; margin: 4px 0 0;">${formattedDate}</p>
            </td>
          </tr>
          `
              : ""
          }
          ${
            safeRoundName
              ? `
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);">
              <p style="color: #888; font-size: 12px; margin: 0;">🎫 ${t("ticket.ticketType", lang)}</p>
              <p style="color: #fff; font-size: 14px; font-weight: 500; margin: 4px 0 0;">${safeRoundName}</p>
            </td>
          </tr>
          `
              : ""
          }
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);">
              <p style="color: #888; font-size: 12px; margin: 0;">${t("ticket.quantity", lang)}</p>
              <p style="color: #fff; font-size: 14px; font-weight: 500; margin: 4px 0 0;">x${ticket.quantity || 1}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 12px 16px;">
              <p style="color: #888; font-size: 12px; margin: 0;">${t("ticket.totalPrice", lang)}</p>
              <p style="color: #dc2626; font-size: 20px; font-weight: 700; margin: 4px 0 0;">€${(ticket.total_price ?? 0).toFixed(2)}</p>
            </td>
          </tr>
        </table>

        <!-- QR Code -->
        <div style="text-align: center; margin: 24px 0; padding: 24px 20px; background-color: #fff; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">
          <h3 style="color: #0a0a0a; margin-bottom: 16px; font-size: 17px; font-weight: 700;">${t("ticket.yourQRCode", lang)}</h3>
          <div style="background: #f8f8f8; border-radius: 12px; padding: 20px; display: inline-block;">
            <img src="${qrCodeDataUrl}" alt="Ticket QR Code" style="width: 220px; height: 220px; display: block;" />
          </div>
          <div style="margin-top: 16px; background: #f5f5f5; border-radius: 8px; padding: 12px 16px; display: inline-block;">
            <p style="color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">${t("ticket.reference", lang)}</p>
            <p style="color: #0a0a0a; font-size: 20px; font-weight: 800; font-family: 'Courier New', monospace; letter-spacing: 2px; margin: 0;">${escapeHtml(ticketRef)}</p>
          </div>
          <p style="color: #999; font-size: 12px; margin-top: 12px;">${t("ticket.showAtEntry", lang)}</p>
        </div>

        <!-- How to enter -->
        <div style="background: #1a1a1a; padding: 20px; border-radius: 12px; margin: 24px 0; border-left: 4px solid #dc2626;">
          <h3 style="color: #fff; margin-top: 0; margin-bottom: 15px; font-size: 16px;">
            ${t("ticket.howToEnter", lang)}
          </h3>
          <ol style="color: #a0a0a0; line-height: 1.8; margin: 0; padding-left: 20px;">
            <li style="margin-bottom: 8px;">
              <strong style="color:#fff;">${t("ticket.enterStep1Title", lang)}</strong> ${t("ticket.enterStep1Desc", lang)}
            </li>
            <li style="margin-bottom: 8px;">
              <strong style="color:#fff;">${t("ticket.enterStep2Title", lang)}</strong> ${t("ticket.enterStep2Desc", lang)} ${safeVenueName}.
            </li>
            <li style="margin-bottom: 8px;">
              <strong style="color:#fff;">${t("ticket.enterStep3Title", lang)}</strong> ${t("ticket.enterStep3Desc", lang)}
            </li>
            <li>
              <strong style="color:#fff;">${t("ticket.enterStep4Title", lang)}</strong> ${t("ticket.enterStep4Desc", lang)}
            </li>
          </ol>
        </div>

        ${venueAddress ? `
        <div style="background-color: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
          <p style="margin: 0; color: #f59e0b; font-size: 14px;">
            <strong>📍</strong> ${venueAddress}
          </p>
        </div>
        ` : addressDeferred ? `
        <div style="background-color: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
          <p style="margin: 0; color: #f59e0b; font-size: 14px;">
            <strong>📍</strong> ${addressDeferredText}
          </p>
        </div>
        ` : ""}

        ${guestBlock}

        <!-- Invoice Download -->
        <div style="text-align: center; margin: 24px 0; padding: 20px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px;">
          <p style="color: #fff; font-size: 16px; font-weight: 600; margin: 0 0 8px;">${t("invoice.sectionTitle", lang)}</p>
          <p style="color: #999; font-size: 13px; margin: 0 0 16px;">${t("invoice.description", lang)}</p>
          <a href="${appBaseUrl}/order-confirmation?type=ticket&id=${ticketId}" 
             style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 600; font-size: 14px;">
            ${t("invoice.downloadCta", lang)} →
          </a>
        </div>

        <!-- Footer -->
        <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
          <p style="color: #fff; font-size: 14px; margin: 5px 0;">
            ${t("ticket.thanks", lang)}
          </p>
          <p style="color: #666; font-size: 13px; margin: 8px 0 0;">
            ${t("ticket.teamSign", lang)}
          </p>
        </div>
      </div>
    `;

    const html = wrapEmailWithBranding(emailContent, lang, venueName);

    const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
    const from = rawFrom
      ? rawFrom.includes("<")
        ? rawFrom
        : `Yuno <${rawFrom}>`
      : "Yuno <noreply@yunoapp.eu>";

    const subject = t("ticket.confirmedSubject", lang, { eventTitle });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({ from, to: [email], subject, html }),
    });

    if (!res.ok) {
      const errData = await res.text();
      throw new Error(`Resend error: ${errData}`);
    }

    const data = await res.json();
    logStep("Email sent", { ticketId, to: email, isGuest });

    return new Response(JSON.stringify({ success: true, ...data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[SEND-TICKET-CONFIRMATION] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
