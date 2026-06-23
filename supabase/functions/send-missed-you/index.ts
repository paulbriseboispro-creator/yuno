import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { EmailLanguage, t, wrapEmailWithBranding, escapeHtml } from "../_shared/email-branding.ts";
import { loadOptIns, optInToken, unsubscribeHeaders } from "../_shared/email-compliance.ts";
import { buildWinBack, fmtDateParts } from "../_shared/email-templates.ts";

import { authorizeCronRequest } from "../_shared/cron-auth.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[MISSED-YOU] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

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
    const from = rawFrom ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`) : 'Yuno <noreply@yunoapp.eu>';

    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

    const { data: recentEvents } = await supabaseAdmin
      .from('events')
      .select('id, title, start_at, venue_id, organizer_user_id, poster_url, venues(name)')
      .lte('end_at', twelveHoursAgo)
      .gte('end_at', fortyEightHoursAgo);

    if (!recentEvents || recentEvents.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No recent events" }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let sentCount = 0;

    for (const event of recentEvents) {
      const venueName = (event.venues as any)?.name || '';
      const safeEventTitle = escapeHtml(event.title);
      const safeVenueName = escapeHtml(venueName);
      const eventImageUrl = event.poster_url || null;

      const { data: noShowTickets } = await supabaseAdmin
        .from('tickets')
        .select('user_id, user_email')
        .eq('event_id', event.id)
        .eq('status', 'paid')
        .not('user_id', 'is', null);

      if (!noShowTickets || noShowTickets.length === 0) continue;

      // Exclude anyone who actually showed up: a user holding a 'used' ticket for
      // this event attended, even if a separate 'paid' ticket of theirs was never
      // scanned. Without this, real attendees get a "you missed it" email.
      const { data: attendedRows } = await supabaseAdmin
        .from('tickets')
        .select('user_id, user_email')
        .eq('event_id', event.id)
        .eq('status', 'used');
      const attendedUserIds = new Set((attendedRows || []).map((r: any) => r.user_id).filter(Boolean));
      const attendedEmails = new Set((attendedRows || []).map((r: any) => r.user_email).filter(Boolean));

      const attendeeCount = attendedRows?.length ?? 0;

      const { data: nextEvents } = await supabaseAdmin
        .from('events')
        .select('id, title, start_at')
        .eq('venue_id', event.venue_id)
        .eq('is_active', true)
        .gt('start_at', new Date().toISOString())
        .order('start_at', { ascending: true })
        .limit(1);

      const nextEvent = nextEvents?.[0];

      const optins = await loadOptIns(supabaseAdmin, noShowTickets.map((tk: any) => tk.user_email));

      const seen = new Set<string>();
      for (const ticket of noShowTickets) {
        if (!ticket.user_email || !ticket.user_id || seen.has(ticket.user_email)) continue;
        if (attendedUserIds.has(ticket.user_id) || attendedEmails.has(ticket.user_email)) continue;
        // Marketing: send ONLY to recipients who opted in for this venue/organizer.
        const unsubToken = optInToken(optins, ticket.user_email, { venueId: event.venue_id, organizerUserId: (event as any).organizer_user_id });
        if (unsubToken === null) continue;
        seen.add(ticket.user_email);

        const alreadySent = await wasAlreadySent(supabaseAdmin, ticket.user_id, 'missed_you', event.id);
        if (alreadySent) continue;

        try {
          let lang: EmailLanguage = 'fr';
          if (ticket.user_id) {
            const { data: profile } = await supabaseAdmin
              .from('profiles')
              .select('preferred_language')
              .eq('id', ticket.user_id)
              .single();
            if (profile?.preferred_language && ['en', 'es', 'fr'].includes(profile.preferred_language)) {
              lang = profile.preferred_language as EmailLanguage;
            }
          }

          const dateLocales: Record<EmailLanguage, string> = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR' };

          let nextEventHtml = '';
          if (nextEvent) {
            const nextDate = new Date(nextEvent.start_at).toLocaleDateString(dateLocales[lang], { weekday: 'short', day: 'numeric', month: 'short' });
            nextEventHtml = `
              <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin: 16px 0;">
                <tr>
                  <td style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <p style="color: #888; font-size: 12px; margin: 0;">🎉 ${t('missed.nextEvent', lang)}</p>
                    <p style="color: #fff; font-size: 14px; font-weight: 500; margin: 4px 0 0;">${escapeHtml(nextEvent.title)} — ${nextDate}</p>
                  </td>
                </tr>
              </table>
            `;
          }

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
              <h1 style="color: white; margin: 0; font-size: 22px;">${t('missed.title', lang)}</h1>
            </div>

            <!-- Content -->
            <div style="padding: 28px;">
              <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
                ${t('missed.body', lang, { eventTitle: safeEventTitle, venueName: safeVenueName })}
              </p>
              
              <!-- Stats Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 16px;">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <p style="color:#dc2626;margin:0;font-size:32px;font-weight:800">${attendeeCount || 0}</p>
                    <p style="color:#888;margin:4px 0 0;font-size:13px">${t('missed.attendees', lang)}</p>
                  </td>
                </tr>
              </table>

              ${nextEventHtml}

              <a href="https://yunoapp.eu/club/${event.venue_id}" style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px; margin-top: 16px;">
                ${t('missed.cta', lang)}
              </a>

              <!-- Footer -->
              <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
                <p style="color: #666; font-size: 13px; margin: 0;">${t('missed.teamSign', lang)}</p>
              </div>
            </div>
          `;

          const nextEventBuilt = nextEvent ? {
            title: nextEvent.title,
            meta: (() => { const dp = fmtDateParts(nextEvent.start_at, lang); return `${dp.day} ${dp.month}`; })(),
            url: `https://yunoapp.eu/event/${nextEvent.id}`,
          } : undefined;
          const unsubUrl = `${Deno.env.get('PUBLIC_URL') || Deno.env.get('APP_BASE_URL') || 'https://yunoapp.eu'}/unsubscribe?token=${unsubToken}`;
          const mail = buildWinBack({
            lang,
            pastEventTitle: event.title,
            venueName,
            posterUrl: eventImageUrl || undefined,
            attendeeCount: attendeeCount ? String(attendeeCount) : undefined,
            nextEvent: nextEventBuilt,
            venueUrl: `https://yunoapp.eu/club/${event.venue_id}`,
            unsubscribeUrl: unsubUrl,
            recipientEmail: ticket.user_email,
          });
          const html = mail.html;
          const subject = mail.subject;

          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` },
            body: JSON.stringify({ from, to: [ticket.user_email], subject, html, headers: unsubscribeHeaders(unsubToken) }),
          });
          if (res.ok) {
            await markSent(supabaseAdmin, ticket.user_id, 'missed_you', event.id);
            sentCount++;
          }
        } catch (err) {
          console.error(`Missed-you error for ${ticket.user_email}:`, err);
        }
      }
    }

    logStep("Completed", { sentCount });
    return new Response(
      JSON.stringify({ success: true, sent: sentCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[MISSED-YOU] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
