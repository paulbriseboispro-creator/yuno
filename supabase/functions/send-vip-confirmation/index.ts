import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { 
  EmailLanguage, 
  t, 
  wrapEmailWithBranding,
  escapeHtml 
} from "../_shared/email-branding.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-VIP-CONFIRMATION] ${step}${detailsStr}`);
};

type VipEmailType = 'request_received' | 'confirmed' | 'modified' | 'refused';

interface VipEmailRequest {
  reservationId: string;
  type: VipEmailType;
  changes?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");

    const { reservationId, type, changes } = await req.json() as VipEmailRequest;

    if (!reservationId || !type) {
      throw new Error("reservationId and type are required");
    }

    if (!['request_received', 'confirmed', 'modified', 'refused'].includes(type)) {
      throw new Error("Invalid type. Must be: request_received, confirmed, modified, refused");
    }

    const { data: reservation, error: resError } = await supabaseAdmin
      .from('table_reservations')
      .select(`
        id, user_email, user_id, full_name, minimum_spend, total_price, qr_code,
        zone_id,
        table_zones(name, venue_id),
        events!inner(id, title, start_at, venue_id, poster_url, venues(name, address))
      `)
      .eq('id', reservationId)
      .single();

    if (resError || !reservation) throw new Error("Reservation not found");

    const event = reservation.events as any;
    const zone = reservation.table_zones as any;
    const venue = event?.venues;
    const venueName = venue?.name || '';
    const eventTitle = event?.title || '';
    const customerEmail = reservation.user_email;
    const venueAddress = escapeHtml(venue?.address);

    if (!customerEmail) throw new Error("No customer email");

    let lang: EmailLanguage = 'fr';
    let firstName = '';
    if (reservation.user_id) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('first_name, preferred_language')
        .eq('id', reservation.user_id)
        .single();
      if (profile?.preferred_language && ['en', 'es', 'fr'].includes(profile.preferred_language)) {
        lang = profile.preferred_language as EmailLanguage;
      }
      firstName = profile?.first_name || '';
    }
    if (!firstName && reservation.full_name) {
      firstName = reservation.full_name.split(' ')[0] || '';
    }

    const safeEventTitle = escapeHtml(eventTitle);
    const safeVenueName = escapeHtml(venueName);
    const nameStr = firstName ? ` ${firstName}` : '';
    const eventImageUrl = event?.poster_url || null;

    const dateLocales: Record<EmailLanguage, string> = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR' };
    let formattedDate = '';
    try {
      const d = new Date(event.start_at);
      formattedDate = d.toLocaleDateString(dateLocales[lang], {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris'
      });
    } catch { /* ignore */ }

    let subjectKey = '';
    let titleKey = '';
    let bodyKey = '';
    let extraContent = '';

    switch (type) {
      case 'request_received':
        subjectKey = 'vip.requestReceivedSubject';
        titleKey = 'vip.requestReceivedTitle';
        bodyKey = 'vip.requestReceivedBody';
        extraContent = `
          <p style="color: #999; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
            ${t('vip.requestReceivedNote', lang)}
          </p>
        `;
        break;

      case 'confirmed':
        subjectKey = 'vip.confirmedSubject';
        titleKey = 'vip.confirmedTitle';
        bodyKey = 'vip.confirmedBody';
        extraContent = `
          <!-- Details Card -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 24px;">
            ${formattedDate ? `
            <tr>
              <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                <p style="color: #888; font-size: 12px; margin: 0;">📅 ${t('ticket.eventDate', lang)}</p>
                <p style="color: #fff; font-size: 14px; font-weight: 500; margin: 4px 0 0;">${formattedDate}</p>
              </td>
            </tr>
            ` : ''}
            ${zone?.name ? `
            <tr>
              <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                <p style="color: #888; font-size: 12px; margin: 0;">🎫 ${t('vip.zone', lang)}</p>
                <p style="color: #fff; font-size: 14px; font-weight: 500; margin: 4px 0 0;">${escapeHtml(zone.name)}</p>
              </td>
            </tr>
            ` : ''}
            ${reservation.minimum_spend ? `
            <tr>
              <td style="padding: 12px 16px;">
                <p style="color: #888; font-size: 12px; margin: 0;">${t('vip.minimumSpend', lang)}</p>
                <p style="color: #dc2626; font-size: 20px; font-weight: 700; margin: 4px 0 0;">€${reservation.minimum_spend.toFixed(2)}</p>
              </td>
            </tr>
            ` : ''}
          </table>

          ${reservation.qr_code ? `
          <!-- QR Code -->
          <div style="text-align: center; margin: 24px 0; padding: 24px 20px; background-color: #fff; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">
            <h3 style="color: #0a0a0a; margin-bottom: 16px; font-size: 17px; font-weight: 700;">${t('ticket.yourQRCode', lang)}</h3>
            <div style="background: #f8f8f8; border-radius: 12px; padding: 20px; display: inline-block;">
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(reservation.qr_code)}" alt="QR Code" style="width: 220px; height: 220px; display: block;" />
            </div>
            <div style="margin-top: 16px; background: #f5f5f5; border-radius: 8px; padding: 12px 16px; display: inline-block;">
              <p style="color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">${t('ticket.reference', lang)}</p>
              <p style="color: #0a0a0a; font-size: 20px; font-weight: 800; font-family: 'Courier New', monospace; letter-spacing: 2px; margin: 0;">${escapeHtml(reservation.qr_code)}</p>
            </div>
            <p style="color: #999; font-size: 12px; margin-top: 12px;">${t('ticket.showAtEntry', lang)}</p>
          </div>
          ` : ''}

          ${venueAddress ? `
          <div style="background-color: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
            <p style="margin: 0; color: #f59e0b; font-size: 14px;">
              <strong>📍</strong> ${venueAddress}
            </p>
          </div>
          ` : ''}
        `;
        break;

      case 'modified':
        subjectKey = 'vip.modifiedSubject';
        titleKey = 'vip.modifiedTitle';
        bodyKey = 'vip.modifiedBody';
        extraContent = changes ? `
          <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 16px; margin-bottom: 24px;">
            <p style="color: #ccc; font-size: 14px; line-height: 1.6; margin: 0;">${escapeHtml(changes)}</p>
          </div>
        ` : '';
        break;

      case 'refused':
        subjectKey = 'vip.refusedSubject';
        titleKey = 'vip.refusedTitle';
        bodyKey = 'vip.refusedBody';
        extraContent = `
          <p style="color: #999; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
            ${t('vip.refusedNote', lang)}
          </p>
        `;
        break;
    }

    const subject = t(subjectKey, lang, { eventTitle });

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
        <h1 style="color: white; margin: 0; font-size: 22px;">${t(titleKey, lang)}</h1>
      </div>

      <!-- Content -->
      <div style="padding: 28px;">
        <p style="color: #fff; font-size: 16px; margin-bottom: 16px;">
          ${nameStr ? `${t('ticket.greeting', lang)}${nameStr}!` : `${t('ticket.greeting', lang)}!`}
        </p>

        <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
          ${t(bodyKey, lang, { eventTitle: safeEventTitle, venueName: safeVenueName })}
        </p>
        
        ${extraContent}
        
        ${type !== 'refused' ? `
        <table cellpadding="0" cellspacing="0" style="margin: 0 0 24px;">
          <tr>
            <td>
              <a href="https://yunoapp.eu/my-orders" 
                 style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 600; font-size: 14px;">
                ${t('vip.viewReservation', lang)}
              </a>
            </td>
          </tr>
        </table>
        ` : ''}
        
        <!-- Invoice Download -->
        <div style="text-align: center; margin: 24px 0; padding: 20px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px;">
          <p style="color: #fff; font-size: 16px; font-weight: 600; margin: 0 0 8px;">${t('invoice.sectionTitle', lang)}</p>
          <p style="color: #999; font-size: 13px; margin: 0 0 16px;">${t('invoice.description', lang)}</p>
          <a href="https://yunoapp.eu/order-confirmation?type=table&id=${reservationId}" 
             style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 600; font-size: 14px;">
            ${t('invoice.downloadCta', lang)} →
          </a>
        </div>
        
        <!-- Footer -->
        <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
          <p style="color: #fff; font-size: 14px; margin: 5px 0;">
            ${t('ticket.thanks', lang)}
          </p>
          <p style="color: #666; font-size: 13px; margin: 8px 0 0;">
            ${t('vip.teamSign', lang)}
          </p>
        </div>
      </div>
    `;

    const html = wrapEmailWithBranding(emailContent, lang, venueName);

    const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const from = rawFrom
      ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`)
      : 'Yuno <onboarding@resend.dev>';

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({ from, to: [customerEmail], subject, html }),
    });

    if (!res.ok) {
      const errData = await res.text();
      throw new Error(`Resend error: ${errData}`);
    }

    logStep("Email sent", { type, to: customerEmail });

    return new Response(
      JSON.stringify({ success: true, type, email: customerEmail }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[SEND-VIP-CONFIRMATION] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
