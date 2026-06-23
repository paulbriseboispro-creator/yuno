import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { EmailLanguage } from "../_shared/email-branding.ts";
import { buildPreNightChecklist, fmtDateParts } from "../_shared/email-templates.ts";

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
    const from = rawFrom ? (rawFrom.includes('<') ? rawFrom : `Yuno <${rawFrom}>`) : 'Yuno <noreply@yunoapp.eu>';

    const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const fourHoursFromNow = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

    const { data: upcomingEvents } = await supabaseAdmin
      .from('events')
      .select('id, title, start_at, venue_id, poster_url, venues(name, address)')
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
      const eventImageUrl = event.poster_url || undefined;

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

          const dp = fmtDateParts(event.start_at, lang);

          const mail = buildPreNightChecklist({
            lang,
            firstName: firstName || undefined,
            eventTitle: event.title,
            venueName,
            posterUrl: eventImageUrl,
            doorsTime: dp.time || undefined,
            address: venueAddress || undefined,
            reference: qrCode || '',
            ticketUrl: `https://yunoapp.eu/club/${event.venue_id}`,
          });

          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` },
            body: JSON.stringify({ from, to: [email], subject: mail.subject, html: mail.html }),
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
