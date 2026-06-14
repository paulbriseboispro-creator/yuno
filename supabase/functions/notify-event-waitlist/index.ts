import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { wrapEmailWithBranding, t, escapeHtml, type EmailLanguage } from '../_shared/email-branding.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[NOTIFY-EVENT-WAITLIST] ${step}${detailsStr}`);
};

function buildWaitlistConfirmationEmail(
  entry: { full_name?: string | null },
  eventTitle: string,
  venueName: string,
  lang: EmailLanguage = 'fr'
): { subject: string; html: string } {
  const name = escapeHtml(entry.full_name) || '';
  const safeEventTitle = escapeHtml(eventTitle);
  const safeVenueName = escapeHtml(venueName);

  const subject = t('waitlist.confirmationSubject', lang, { eventTitle: safeEventTitle });

  const content = `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding: 32px 28px;">
          <h1 style="color: #fff; font-size: 22px; font-weight: 700; margin: 0 0 24px; line-height: 1.3;">
            ${t('waitlist.confirmationTitle', lang)}
          </h1>
          <p style="color: #ccc; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            ${t('waitlist.confirmationGreeting', lang, { name })}
          </p>
          <p style="color: #ccc; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            ${t('waitlist.confirmationBody', lang, { eventTitle: safeEventTitle, venueName: safeVenueName })}
          </p>
          <p style="color: #999; font-size: 14px; line-height: 1.6; margin: 0 0 28px;">
            ${t('waitlist.confirmationNote', lang)}
          </p>
          <div style="border-top: 1px solid rgba(255,255,255,0.08); margin: 0 0 20px;"></div>
          <p style="color: #666; font-size: 13px; margin: 0;">
            ${t('waitlist.teamSign', lang)}
          </p>
        </td>
      </tr>
    </table>
  `;

  return {
    subject,
    html: wrapEmailWithBranding(content, lang, safeVenueName),
  };
}

function buildWaitlistOpeningEmail(
  entry: { full_name?: string | null },
  eventTitle: string,
  venueName: string,
  eventUrl: string | null,
  eventImageUrl: string | null,
  eventDate: string | null,
  eventDescription: string | null,
  lang: EmailLanguage = 'fr'
): { subject: string; html: string } {
  const name = escapeHtml(entry.full_name) || '';
  const safeEventTitle = escapeHtml(eventTitle);
  const safeVenueName = escapeHtml(venueName);

  const subject = t('waitlist.openingSubject', lang, { eventTitle: safeEventTitle });

  let formattedDate = '';
  if (eventDate) {
    try {
      const d = new Date(eventDate);
      const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' };
      formattedDate = d.toLocaleDateString(lang === 'es' ? 'es-ES' : lang === 'en' ? 'en-GB' : 'fr-FR', options);
    } catch { formattedDate = ''; }
  }

  const safeDescription = eventDescription ? escapeHtml(eventDescription).substring(0, 200) : '';

  const content = `
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
      <h1 style="color: white; margin: 0; font-size: 22px;">${t('waitlist.openingTitle', lang)}</h1>
    </div>

    <!-- Content -->
    <div style="padding: 28px;">
      <p style="color: #fff; font-size: 16px; margin-bottom: 16px;">
        ${name ? `${t('ticket.greeting', lang)} ${name}!` : `${t('ticket.greeting', lang)}!`}
      </p>

      <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
        ${t('waitlist.openingBody', lang, { eventTitle: safeEventTitle })}
      </p>

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
        ${safeDescription ? `
        <tr>
          <td style="padding: 12px 16px;">
            <p style="color: #888; font-size: 12px; margin: 0;">📝</p>
            <p style="color: #ccc; font-size: 13px; line-height: 1.5; margin: 4px 0 0;">${safeDescription}${eventDescription && eventDescription.length > 200 ? '…' : ''}</p>
          </td>
        </tr>
        ` : ''}
      </table>

      <p style="color: #dc2626; font-size: 15px; font-weight: 600; line-height: 1.6; margin: 0 0 16px;">
        ${t('waitlist.openingPriority', lang)}
      </p>
      
      ${eventUrl ? `
      <table cellpadding="0" cellspacing="0" style="margin: 0 0 24px;">
        <tr>
          <td>
            <a href="${eventUrl}" 
               style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 600; font-size: 14px;">
              ${t('waitlist.buyTickets', lang)}
            </a>
          </td>
        </tr>
      </table>
      ` : ''}
      
      <!-- Footer -->
      <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
        <p style="color: #fff; font-size: 14px; margin: 5px 0;">
          ${t('ticket.thanks', lang)}
        </p>
        <p style="color: #666; font-size: 13px; margin: 8px 0 0;">
          ${t('waitlist.teamSign', lang)}
        </p>
      </div>
    </div>
  `;

  return {
    subject,
    html: wrapEmailWithBranding(content, lang, safeVenueName),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'noreply@yuno.app';

    const { eventId, type, email: targetEmail } = await req.json();

    if (!eventId) {
      throw new Error('eventId is required');
    }

    logStep("Request data", { eventId, type, targetEmail });

    const { data: event, error: eventError } = await supabaseClient
      .from('events')
      .select('title, start_at, venue_id, image_url, poster_url, description, venues(name)')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      throw new Error('Event not found');
    }

    let entriesQuery = supabaseClient
      .from('event_waitlist')
      .select('id, email, full_name')
      .eq('event_id', eventId);
    
    if (type === 'confirmation' && targetEmail) {
      entriesQuery = entriesQuery.eq('email', targetEmail.toLowerCase().trim());
    }

    const { data: entries, error: entriesError } = await entriesQuery;

    if (entriesError) throw entriesError;

    if (!entries || entries.length === 0) {
      logStep("No waitlist entries to notify");
      return new Response(
        JSON.stringify({ success: true, notified: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logStep("Entries found", { count: entries.length });

    if (type !== 'confirmation') {
      await supabaseClient
        .from('event_waitlist')
        .update({ presale_access: true })
        .eq('event_id', eventId)
        .eq('presale_access', false);
    }

    let notifiedCount = 0;
    if (resendApiKey) {
      const venueName = (event as any).venues?.name || 'Yuno';
      const eventUrl = `https://yunoapp.eu/club/${event.venue_id}`;
      const eventImageUrl = (event as any).image_url || (event as any).poster_url || null;
      const lang: EmailLanguage = 'fr';

      for (const entry of entries) {
        try {
          const emailData = type === 'confirmation'
            ? buildWaitlistConfirmationEmail(entry, event.title, venueName, lang)
            : buildWaitlistOpeningEmail(entry, event.title, venueName, eventUrl, eventImageUrl, event.start_at, (event as any).description, lang);

          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${resendApiKey}`,
            },
            body: JSON.stringify({
              from: fromEmail,
              to: [entry.email],
              subject: emailData.subject,
              html: emailData.html,
            }),
          });

          if (res.ok) {
            notifiedCount++;
          } else {
            const errData = await res.text();
            console.error(`Failed to email ${entry.email}:`, errData);
          }
        } catch (emailErr) {
          console.error(`Email error for ${entry.email}:`, emailErr);
        }
      }
    }

    if (type !== 'confirmation') {
      const venueName = (event as any).venues?.name || 'Yuno';
      
      const { data: waitlistUsers } = await supabaseClient
        .from('event_waitlist')
        .select('user_id')
        .eq('event_id', eventId)
        .not('user_id', 'is', null);

      if (waitlistUsers && waitlistUsers.length > 0) {
        const userIds = waitlistUsers.map(w => w.user_id).filter(Boolean);
        
        for (const userId of userIds) {
          try {
            const pushUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`;
            await fetch(pushUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                userId,
                title: '🎉 Billets disponibles !',
                body: `Les billets pour ${event.title} sont maintenant en vente. Tu as un accès prioritaire !`,
                url: `/club/${event.venue_id}`,
              }),
            });
          } catch (pushErr) {
            console.error(`Push error for user ${userId}:`, pushErr);
          }
        }
        logStep("Push notifications sent", { userCount: userIds.length });
      }
    }

    logStep("Notifications sent", { notifiedCount, total: entries.length });

    return new Response(
      JSON.stringify({ success: true, notified: notifiedCount, total: entries.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[NOTIFY-EVENT-WAITLIST] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
