import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import QRCode from "https://esm.sh/qrcode@1.5.3";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import {
  EmailLanguage,
  t,
  wrapEmailWithBranding,
  escapeHtml,
} from "../_shared/email-branding.ts";
import { buildTicketConfirmation, fmtDateParts } from "../_shared/email-templates.ts";
import {
  drawReceipt, drawBillet, receiptLineLabels,
  type PdfDoc, type DocLang, type ReceiptLine,
} from "../_shared/pdf-documents.ts";
import { handleWalletRequest, ensureWalletPass, walletPassUrl } from "../_shared/wallet/router.ts";

// Fetch a remote image into a base64 data URL (jsPDF addImage needs bytes, not a URL).
async function fetchImageDataUrl(url?: string | null): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ct = res.headers.get("content-type") || "image/jpeg";
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return `data:${ct};base64,${btoa(bin)}`;
  } catch {
    return undefined;
  }
}

// Render a jsPDF document to a base64 string (for Resend attachments).
function renderPdfBase64(draw: (doc: PdfDoc) => void): string {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  draw(doc as unknown as PdfDoc);
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

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

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  // Routes Apple Wallet (D2 : cette fonction est l'hôte permanent du
  // webServiceURL des passes). POST racine = flux email historique, intact.
  const walletResponse = await handleWalletRequest(req, supabaseAdmin);
  if (walletResponse) return walletResponse;

  try {
    logStep("Function started");

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");

    const { ticketId, email, firstName, isGuest } =
      (await req.json()) as TicketConfirmationRequest;

    if (!ticketId || !email) {
      throw new Error("ticketId and email are required");
    }

    // Fetch ticket with round & event details
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("tickets")
      .select(`
        id, qr_code, reference_code, quantity, unit_price, total_price, service_fee, insurance_fee, full_name, phone, user_email, user_id, status,
        ticket_round_id, event_id,
        ticket_rounds(name, group_label),
        events!inner(id, title, start_at, venue_id, organizer_user_id, poster_url, location_name, location_address, location_city, location_is_secret, reveal_address_in_email, venues!events_venue_id_fkey(name, address, legal_name, legal_address, siret, vat_number, logo_url))
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

    // ===== Generate the two PDFs (Billet + Reçu) and attach them to the email =====
    // Mirrors Shotgun: a fiscal "Reçu de transaction" (club = sole seller) + the
    // scannable "Billet". Rendered server-side via the shared isomorphic core so
    // they match the OrderConfirmation page downloads to the cent. NEVER block the
    // confirmation email on a PDF failure — send without attachments instead.
    let attachments: Array<{ filename: string; content: string }> = [];
    try {
      const docLang = (["en", "es", "fr"].includes(lang) ? lang : "fr") as DocLang;
      const v = (venue || {}) as any;
      // Seller = merchant of record (Yuno direct-charge model). Venue legal info,
      // else the organizer profile for organizer-led events.
      let seller = {
        name: v.legal_name || v.name || event?.location_name || "Yuno",
        address: v.legal_address || v.address || event?.location_address || undefined,
        siret: v.siret || undefined,
        vat: v.vat_number || undefined,
        logoUrl: v.logo_url || undefined,
      };
      let organizerName: string = v.name || event?.location_name || "";
      if (!event?.venue_id && event?.organizer_user_id) {
        const { data: org } = await supabaseAdmin
          .from("organizer_profiles")
          .select("legal_name, display_name, legal_address, siret, vat_number, avatar_url")
          .eq("user_id", event.organizer_user_id)
          .maybeSingle();
        if (org) {
          seller = {
            name: org.legal_name || org.display_name || seller.name,
            address: org.legal_address || undefined,
            siret: org.siret || undefined,
            vat: org.vat_number || undefined,
            logoUrl: org.avatar_url || undefined,
          };
          organizerName = org.display_name || org.legal_name || organizerName;
        }
      }

      // Best-effort canonical order number from the invoice row.
      const { data: inv } = await supabaseAdmin
        .from("invoices").select("invoice_number").eq("ticket_id", ticketId).maybeSingle();
      const orderNumber = inv?.invoice_number || ticketRef;

      // Receipt lines: the ticket (event VAT, default 20%) + Yuno service + insurance fees (20%).
      const svc = Number(ticket.service_fee) || 0;
      const ins = Number(ticket.insurance_fee) || 0;
      const ticketTtc = Math.max(0, (Number(ticket.total_price) || 0) - svc - ins);
      const feeL = receiptLineLabels(docLang);
      const lines: ReceiptLine[] = [
        { label: round?.name || (docLang === "fr" ? "Billet" : docLang === "es" ? "Entrada" : "Ticket"), qty: ticket.quantity || 1, ttc: ticketTtc, vatRate: 20 },
      ];
      if (svc > 0) lines.push({ label: feeL.serviceFee, qty: 1, ttc: svc, vatRate: 20 });
      if (ins > 0) lines.push({ label: feeL.insurance, qty: 1, ttc: ins, vatRate: 20 });

      const [posterData, logoData, qrPng] = await Promise.all([
        fetchImageDataUrl(event?.poster_url),
        fetchImageDataUrl(seller.logoUrl),
        QRCode.toDataURL(qrData, { width: 260, margin: 1 }),
      ]);

      const start = event?.start_at ? new Date(event.start_at) : undefined;
      const priceStr = `${(Number(ticket.total_price) || 0).toFixed(2).replace(".", ",")} €`;

      const recuB64 = renderPdfBase64((doc) => drawReceipt(doc, {
        lang: docLang, orderNumber, receiptDate: new Date(), paymentDate: new Date(),
        sellerName: seller.name, sellerAddress: seller.address, sellerSiret: seller.siret,
        sellerVatNumber: seller.vat, sellerLogo: logoData,
        customerName: ticket.full_name || "", customerEmail: ticket.user_email || email,
        customerPhone: ticket.phone || undefined,
        eventTitle, eventDate: start, eventCity: event?.location_city || undefined, lines,
      }));
      const billetB64 = renderPdfBase64((doc) => drawBillet(doc, {
        lang: docLang, eventTitle, organizerName, eventStart: start,
        address: (rawAddress && (!isSecret || revealInEmail)) ? rawAddress : undefined,
        addressDeferred,
        entranceGroup: round?.group_label || undefined, entranceName: round?.name || undefined,
        reference: ticketRef, price: priceStr, orderNumber,
        customerName: ticket.full_name || undefined,
        poster: posterData, qr: qrPng, index: 1, total: 1,
      }));

      attachments = [
        { filename: `Yuno-billet-${ticketRef}.pdf`, content: billetB64 },
        { filename: `Yuno-recu-${orderNumber}.pdf`, content: recuB64 },
      ];
      logStep("PDFs generated", { ticketId, attachments: attachments.length });
    } catch (pdfErr) {
      console.error("[SEND-TICKET-CONFIRMATION] PDF generation failed:", pdfErr);
      attachments = [];
    }

    // Apple Wallet : émettre (idempotent) la ligne du pass et joindre le lien
    // de téléchargement direct — seul canal pass pour les achats invités.
    // Best-effort : jamais bloquant pour l'email (table absente, etc.).
    let walletUrl: string | undefined;
    try {
      const wp = await ensureWalletPass(supabaseAdmin, "ticket", ticketId, ticket.user_id ?? null);
      walletUrl = walletPassUrl(wp.serial, wp.authToken);
    } catch (walletErr) {
      console.error("[SEND-TICKET-CONFIRMATION] wallet link skipped:", walletErr);
    }

    // Éducation boissons (upsell post-achat) : uniquement pour les comptes
    // connectés (la page /order/upsell exige une session), si le club vend des
    // boissons et n'a pas coupé l'upsell. Best-effort — jamais bloquant.
    let drinksUpsell: { url: string; presale: boolean } | undefined;
    if (!isGuest && ticket.user_id && event?.venue_id) {
      try {
        const { data: venueFlags } = await supabaseAdmin
          .from("venues")
          .select("menu_enabled, post_checkout_upsell_enabled")
          .eq("id", event.venue_id)
          .maybeSingle();
        if (venueFlags && venueFlags.menu_enabled !== false && venueFlags.post_checkout_upsell_enabled !== false) {
          const { data: drinkRows } = await supabaseAdmin
            .from("drinks")
            .select("presale_active, presale_price")
            .eq("venue_id", event.venue_id)
            .eq("active", true)
            .limit(30);
          if (drinkRows && drinkRows.length > 0) {
            drinksUpsell = {
              url: `${appBaseUrl}/order/upsell?ticket=${ticketId}`,
              presale: drinkRows.some((d) => d.presale_active && d.presale_price),
            };
          }
        }
      } catch (upsellErr) {
        console.error("[SEND-TICKET-CONFIRMATION] drinks upsell section skipped:", upsellErr);
      }
    }

    const dp = fmtDateParts(event.start_at, lang);
    const mail = buildTicketConfirmation({
      attached: attachments.length > 0,
      lang,
      firstName: firstName || ticket.full_name?.split(" ")[0] || undefined,
      eventTitle,
      venueName,
      posterUrl: event?.poster_url || undefined,
      day: dp.day,
      month: dp.month,
      openTime: dp.time,
      city: event?.location_city || venue?.city || undefined,
      ticketType: round?.name || (lang === "fr" ? "Billet" : lang === "es" ? "Entrada" : "Ticket"),
      price: `€${(ticket.total_price ?? 0).toFixed(2)}`,
      reference: ticketRef,
      ticketUrl: isGuest
        ? `${appBaseUrl}/claim?type=ticket&ref=${encodeURIComponent(ticketRef)}`
        : `${appBaseUrl}/order-confirmation?type=ticket&id=${ticketId}`,
      qrDataUrl: qrCodeDataUrl,
      recipientEmail: email,
      address: venueAddress || (addressDeferred ? addressDeferredText : undefined),
      walletUrl,
      drinksUpsell,
    });
    const html = mail.html;

    const rawFrom = Deno.env.get("RESEND_FROM_EMAIL");
    const from = rawFrom
      ? rawFrom.includes("<")
        ? rawFrom
        : `Yuno <${rawFrom}>`
      : "Yuno <noreply@yunoapp.eu>";

    const subject = mail.subject;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({ from, to: [email], subject, html, ...(attachments.length ? { attachments } : {}) }),
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
