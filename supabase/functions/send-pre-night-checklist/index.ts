import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { EmailLanguage, t, wrapEmailWithBranding, escapeHtml } from "../_shared/email-branding.ts";

import { authorizeCronRequest } from "../_shared/cron-auth.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[PRE-NIGHT-CHECKLIST] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

function emailToUuid(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    const char = email.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `00000000-0000-4000-8000-${hex.padStart(12, '0')}`;
}

async function wasAlreadySent(supabase: any, userId: string, notifType: string, key: string): Promise<boolean> {
  const { data } = await supabase
    .from('notification_log')
    .select('id')
    .eq('user_id', userId)
    .eq('notification_type', notifType)
    .eq('title', key)
    .limit(1);
  return (data && data.length > 0);
}

async function markSent(supabase: any, userId: string, notifType: string, key: string) {
  await supabase
    .from('notification_log')
    .insert({ user_id: userId, notification_type: notifType, title: key });
}

serve(async (req) => {
    // SECURITY: scheduled function — require shared cron secret or super-admin JWT
    const _cronAuth = await authorizeCronRequest(req);
    if (!_cronAuth.ok) {
      return new Response(
        JSON.stringify({ error: _cronAuth.message }),
        { status: _cronAuth.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    logStep("Function started");

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");

    const rawFrom = Deno.env.get('RESEND_FROM_EMAIL');
    const from = rawFrom ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`) : 'Yuno <onboarding@resend.dev>';

    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const fourHoursFromNow = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

    const { data: upcomingEvents } = await supabaseAdmin
      .from('events')
      .select('id, title, start_at, venue_id, poster_url, image_url, venues(name, address)')
      .eq('is_active', true)
      .gte('start_at', twoHoursFromNow)
      .lte('start_at', fourHoursFromNow);

    if (!upcomingEvents || upcomingEvents.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No upcoming events in window" }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let sentCount = 0;

    for (const event of upcomingEvents) {
      const venueName = (event.venues as any)?.name || '';
      const venueAddress = (event.venues as any)?.address || '';
      const eventImageUrl = event.image_url || event.poster_url || null;
      const safeEventTitle = escapeHtml(event.title);
      const safeVenueName = escapeHtml(venueName);
      const safeAddress = escapeHtml(venueAddress);

      const { data: tickets } = await supabaseAdmin
        .from('tickets')
        .select('user_id, user_email, qr_code')
        .eq('event_id', event.id)
        .in('status', ['paid']);

      const { data: tableRes } = await supabaseAdmin
        .from('table_reservations')
        .select('user_id, user_email, qr_code')
        .eq('event_id', event.id)
        .eq('status', 'confirmed');

      const recipientMap = new Map<string, { userId: string | null; qrCode: string | null }>();
      for (const t of tickets || []) {
        if (t.user_email) recipientMap.set(t.user_email, { userId: t.user_id, qrCode: t.qr_code });
      }
      for (const r of tableRes || []) {
        if (r.user_email) recipientMap.set(r.user_email, { userId: r.user_id, qrCode: r.qr_code });
      }

      logStep("Processing event", { eventId: event.id, recipients: recipientMap.size });

      for (const [email, { userId, qrCode }] of recipientMap) {
        try {
          const recipientId = userId || emailToUuid(email);
          const alreadySent = await wasAlreadySent(supabaseAdmin, recipientId, 'checklist', event.id);
          if (alreadySent) continue;

          let lang: EmailLanguage = 'fr';
          let firstName = '';
          if (userId) {
            const { data: profile } = await supabaseAdmin
              .from('profiles')
              .select('first_name, preferred_language')
              .eq('id', userId)
              .single();
            if (profile?.preferred_language && ['en', 'es', 'fr'].includes(profile.preferred_language)) {
              lang = profile.preferred_language as EmailLanguage;
            }
            firstName = profile?.first_name || '';
          }

          const nameStr = firstName ? ` ${firstName}` : '';
          const dateLocales: Record<EmailLanguage, string> = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR' };
          const eventTime = new Date(event.start_at).toLocaleTimeString(dateLocales[lang], { hour: '2-digit', minute: '2-digit' });

          const qrSection = qrCode ? `
            <!-- QR Code -->
            <div style="text-align: center; margin: 24px 0; padding: 24px 20px; background-color: #fff; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">
              <h3 style="color: #0a0a0a; margin-bottom: 16px; font-size: 17px; font-weight: 700;">${t('checklist.qrTitle', lang)}</h3>
              <div style="background: #f8f8f8; border-radius: 12px; padding: 20px; display: inline-block;">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}" alt="QR Code" style="width: 220px; height: 220px; display: block;" />
              </div>
              <div style="margin-top: 16px; background: #f5f5f5; border-radius: 8px; padding: 12px 16px; display: inline-block;">
                <p style="color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 4px;">${t('ticket.reference', lang)}</p>
                <p style="color: #0a0a0a; font-size: 20px; font-weight: 800; font-family: 'Courier New', monospace; letter-spacing: 2px; margin: 0;">${escapeHtml(qrCode)}</p>
              </div>
              <p style="color: #999; font-size: 12px; margin-top: 12px;">${t('checklist.qrNote', lang)}</p>
            </div>
          ` : '';

          const emailContent = `
            ${eventImageUrl ? `
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td><img src="${eventImageUrl}" alt="${safeEventTitle}" style="width: 100%; max-height: 200px; object-fit: cover; display: block;" /></td></tr>
              </table>
            ` : ''}

            <!-- Header gradient -->
            <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 24px 28px; text-align: center;">
              <div style="font-size: 20px; font-weight: bold; color: #fff; margin-bottom: 4px;">${safeVenueName}</div>
              <h1 style="color: white; margin: 0; font-size: 22px;">${t('checklist.title', lang)}</h1>
            </div>

            <!-- Content -->
            <div style="padding: 28px;">
              <p style="color: #fff; font-size: 16px; margin-bottom: 16px;">
                ${nameStr ? `${t('ticket.greeting', lang)}${nameStr}!` : `${t('ticket.greeting', lang)}!`}
              </p>

              <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
                ${t('checklist.body', lang, { eventTitle: safeEventTitle, venueName: safeVenueName })}
              </p>
              
              <!-- Details Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <p style="color: #888; font-size: 12px; margin: 0;">🕐 ${t('checklist.doorsOpen', lang)}</p>
                    <p style="color: #fff; font-size: 14px; font-weight: 500; margin: 4px 0 0;">${eventTime}</p>
                  </td>
                </tr>
                ${safeAddress ? `
                <tr>
                  <td style="padding: 12px 16px;">
                    <p style="color: #888; font-size: 12px; margin: 0;">📍 ${t('checklist.address', lang)}</p>
                    <p style="color: #fff; font-size: 14px; font-weight: 500; margin: 4px 0 0;">${safeAddress}</p>
                  </td>
                </tr>
                ` : ''}
              </table>

              ${qrSection}

              <!-- How to enter -->
              <div style="background: #1a1a1a; padding: 20px; border-radius: 12px; margin: 24px 0; border-left: 4px solid #dc2626;">
                <h3 style="color: #fff; margin-top: 0; margin-bottom: 15px; font-size: 16px;">
                  ${t('ticket.howToEnter', lang)}
                </h3>
                <ol style="color: #a0a0a0; line-height: 1.8; margin: 0; padding-left: 20px;">
                  <li style="margin-bottom: 8px;">
                    <strong style="color:#fff;">${t('ticket.enterStep1Title', lang)}</strong> ${t('ticket.enterStep1Desc', lang)}
                  </li>
                  <li style="margin-bottom: 8px;">
                    <strong style="color:#fff;">${t('ticket.enterStep2Title', lang)}</strong> ${t('ticket.enterStep2Desc', lang)} ${safeVenueName}.
                  </li>
                  <li>
                    <strong style="color:#fff;">${t('ticket.enterStep3Title', lang)}</strong> ${t('ticket.enterStep3Desc', lang)}
                  </li>
                </ol>
              </div>

              ${safeAddress ? `
              <div style="background-color: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                <p style="margin: 0; color: #f59e0b; font-size: 14px;">
                  <strong>📍</strong> ${safeAddress}
                </p>
              </div>
              ` : ''}

              <table cellpadding="0" cellspacing="0" style="margin: 24px 0;">
                <tr><td>
                  <a href="https://yunoapp.eu/club/${event.venue_id}" style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 600; font-size: 14px;">
                    ${t('checklist.viewEvent', lang)}
                  </a>
                </td></tr>
              </table>
              
              <!-- Footer -->
              <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
                <p style="color: #fff; font-size: 14px; margin: 5px 0;">
                  ${t('ticket.thanks', lang)}
                </p>
                <p style="color: #666; font-size: 13px; margin: 8px 0 0;">
                  ${t('checklist.teamSign', lang)}
                </p>
              </div>
            </div>
          `;

          const html = wrapEmailWithBranding(emailContent, lang, venueName);
          const subject = t('checklist.subject', lang, { eventTitle: event.title });

          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` },
            body: JSON.stringify({ from, to: [email], subject, html }),
          });

          if (res.ok) {
            await markSent(supabaseAdmin, recipientId, 'checklist', event.id);
            sentCount++;
          } else {
            console.error(`Checklist failed for ${email}:`, await res.text());
          }
        } catch (err) {
          console.error(`Checklist error for ${email}:`, err);
        }
      }
    }

    logStep("Completed", { sentCount });
    return new Response(
      JSON.stringify({ success: true, sent: sentCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[PRE-NIGHT-CHECKLIST] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
