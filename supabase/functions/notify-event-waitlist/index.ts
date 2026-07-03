import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { wrapEmailWithBranding, t, escapeHtml, type EmailLanguage } from '../_shared/email-branding.ts';
import { buildWaitlistOpen, fmtDateParts } from "../_shared/email-templates.ts";

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
  const dp = eventDate ? fmtDateParts(eventDate, lang) : null;
  const meta = dp ? [`${dp.day} ${dp.month}`.trim(), dp.time].filter(Boolean).join(' · ') : '';

  const mail = buildWaitlistOpen({
    lang,
    eventTitle,
    venueName,
    posterUrl: eventImageUrl || undefined,
    meta,
    url: eventUrl || '',
  });

  return { subject: mail.subject, html: mail.html };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseClient = createClient(supabaseUrl, serviceRoleKey);

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'noreply@yunoapp.eu';

    const { eventId, type, email: targetEmail } = await req.json();

    if (!eventId) {
      throw new Error('eventId is required');
    }

    logStep("Request data", { eventId, type, targetEmail });

    const { data: event, error: eventError } = await supabaseClient
      .from('events')
      .select('title, start_at, venue_id, poster_url, description, organizer_user_id, venues(name)')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      throw new Error('Event not found');
    }

    // Authorization. Two callers:
    //  - Public "confirmation": a fan who just joined the waitlist gets ONE email
    //    to their own address. Left unauthenticated but strictly scoped to a single
    //    targetEmail (see below), so it can't be used to blast the whole list.
    //  - Anything else ("open"): blasts the FULL waitlist + push + flips
    //    presale_access=true. This MUST be the event's owner/organizer (or an
    //    internal service-role/cron call). Previously unauthenticated → anyone with
    //    just an eventId could spam the list and open presale early.
    const authHeader = req.headers.get('Authorization') || '';
    const bearer = authHeader.replace('Bearer ', '').trim();
    const isServiceCall = !!bearer && bearer === serviceRoleKey;

    if (type === 'confirmation') {
      if (!targetEmail) throw new Error('targetEmail is required for a confirmation email');
    } else {
      let authorized = isServiceCall;
      if (!authorized && bearer) {
        const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user } } = await userClient.auth.getUser();
        if (user) {
          if ((event as any).organizer_user_id && (event as any).organizer_user_id === user.id) {
            authorized = true;
          } else {
            const { data: ownedVenue } = await supabaseClient
              .from('venues').select('id').eq('id', event.venue_id).eq('owner_id', user.id).maybeSingle();
            if (ownedVenue) authorized = true;
          }
        }
      }
      if (!authorized) {
        logStep('Unauthorized waitlist blast attempt', { eventId });
        throw new Error('Unauthorized: only the event owner or organizer can open the waitlist');
      }
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
      const eventImageUrl = (event as any).poster_url || null;
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
