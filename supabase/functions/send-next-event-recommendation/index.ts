import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { EmailLanguage, t, wrapEmailWithBranding, escapeHtml } from "../_shared/email-branding.ts";
import { loadOptIns, optInToken, unsubscribeHeaders } from "../_shared/email-compliance.ts";
import { buildNextEventRec, fmtDateParts } from "../_shared/email-templates.ts";

import { authorizeCronRequest } from "../_shared/cron-auth.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[NEXT-EVENT-REC] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
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

    const now = new Date().toISOString();
    const twoWeeksFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const d = new Date();
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7);
    const weekKey = `${d.getFullYear()}-W${weekNum}`;

    const { data: upcomingEvents } = await supabaseAdmin
      .from('events')
      .select('id, title, start_at, venue_id, organizer_user_id, music_genre, music_genres, poster_url, ticketing_enabled, venues(name)')
      .eq('is_active', true)
      .gt('start_at', now)
      .lt('start_at', twoWeeksFromNow)
      .order('start_at', { ascending: true })
      .limit(20);

    if (!upcomingEvents || upcomingEvents.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No upcoming events" }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentAttendees } = await supabaseAdmin
      .from('tickets')
      .select('user_id, user_email, event_id')
      .in('status', ['used', 'paid'])
      .gte('created_at', sixtyDaysAgo)
      .not('user_id', 'is', null);

    if (!recentAttendees || recentAttendees.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No recent attendees" }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const pastEventIds = [...new Set(recentAttendees.map(a => a.event_id))];
    const { data: pastEvents } = await supabaseAdmin
      .from('events')
      .select('id, venue_id, music_genre, music_genres')
      .in('id', pastEventIds.slice(0, 50));

    const pastEventMap = new Map(pastEvents?.map(e => [e.id, e]) || []);

    const userEvents = new Map<string, { email: string; venueIds: Set<string>; genres: Set<string> }>();
    for (const a of recentAttendees) {
      if (!a.user_id || !a.user_email) continue;
      let user = userEvents.get(a.user_id);
      if (!user) {
        user = { email: a.user_email, venueIds: new Set(), genres: new Set() };
        userEvents.set(a.user_id, user);
      }
      const pastEvent = pastEventMap.get(a.event_id);
      if (pastEvent) {
        user.venueIds.add(pastEvent.venue_id);
        if (pastEvent.music_genre) user.genres.add(pastEvent.music_genre.toLowerCase());
        if (pastEvent.music_genres) pastEvent.music_genres.forEach((g: string) => user!.genres.add(g.toLowerCase()));
      }
    }

    const optins = await loadOptIns(supabaseAdmin, [...userEvents.values()].map(u => u.email));

    let sentCount = 0;

    for (const [userId, userData] of userEvents) {
      try {
        const alreadySent = await wasAlreadySent(supabaseAdmin, userId, 'next_event_rec', weekKey);
        if (alreadySent) continue;

        const { data: existingTickets } = await supabaseAdmin
          .from('tickets')
          .select('event_id')
          .eq('user_id', userId)
          .in('status', ['paid', 'used'])
          .in('event_id', upcomingEvents.map(e => e.id));

        const ticketedEventIds = new Set(existingTickets?.map(t => t.event_id) || []);

        const scoredEvents = upcomingEvents
          .filter(e => !ticketedEventIds.has(e.id))
          .map(e => {
            let score = 0;
            if (userData.venueIds.has(e.venue_id)) score += 3;
            const eventGenres = [e.music_genre, ...(e.music_genres || [])].map(g => g?.toLowerCase()).filter(Boolean);
            for (const g of eventGenres) {
              if (userData.genres.has(g!)) { score += 2; break; }
            }
            return { ...e, score };
          })
          .filter(e => e.score > 0)
          // Marketing: only recommend events from venues/organizers the user opted in to.
          .filter(e => optInToken(optins, userData.email, { venueId: e.venue_id, organizerUserId: (e as any).organizer_user_id }) !== null)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

        if (scoredEvents.length === 0) continue;

        const unsubToken = optInToken(optins, userData.email, { venueId: scoredEvents[0].venue_id, organizerUserId: (scoredEvents[0] as any).organizer_user_id });

        let lang: EmailLanguage = 'fr';
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('first_name, preferred_language')
          .eq('id', userId)
          .single();
        if (profile?.preferred_language && ['en', 'es', 'fr'].includes(profile.preferred_language)) {
          lang = profile.preferred_language as EmailLanguage;
        }

        const dateLocales: Record<EmailLanguage, string> = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR' };

        const eventsHtml = scoredEvents.map(e => {
          const vName = (e.venues as any)?.name || '';
          const date = new Date(e.start_at).toLocaleDateString(dateLocales[lang], { weekday: 'short', day: 'numeric', month: 'short' });
          const imgUrl = e.poster_url;
          return `
            <table width="100%" cellpadding="0" cellspacing="0" style="background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 12px; overflow: hidden;">
              ${imgUrl ? `<tr><td><img src="${imgUrl}" alt="${escapeHtml(e.title)}" style="width:100%;max-height:120px;object-fit:cover;display:block;" /></td></tr>` : ''}
              <tr><td style="padding: 16px 20px;">
                <p style="color: #fff; font-weight: 700; font-size: 16px; margin: 0 0 4px;">${escapeHtml(e.title)}</p>
                <p style="color: #999; font-size: 13px; margin: 0 0 12px;">${date} · ${escapeHtml(vName)}</p>
                <a href="https://yunoapp.eu/club/${e.venue_id}" style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 8px 20px; border-radius: 8px; font-weight: 600; font-size: 13px;">
                  ${t('nextEvent.getTickets', lang)}
                </a>
              </td></tr>
            </table>
          `;
        }).join('');

        const nameStr = profile?.first_name ? ` ${profile.first_name}` : '';

        const emailContent = `
          <!-- Header gradient -->
          <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 24px 28px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 22px;">${t('nextEvent.title', lang)}</h1>
          </div>

          <!-- Content -->
          <div style="padding: 28px;">
            <p style="color: #fff; font-size: 16px; margin-bottom: 16px;">
              ${nameStr ? `${t('ticket.greeting', lang)}${nameStr}!` : `${t('ticket.greeting', lang)}!`}
            </p>

            <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">${t('nextEvent.body', lang)}</p>
            
            ${eventsHtml}

            <!-- Footer -->
            <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
              <p style="color: #666; font-size: 13px; margin: 0;">${t('nextEvent.teamSign', lang)}</p>
            </div>
          </div>
        `;

        const unsubUrl = `${Deno.env.get('PUBLIC_URL') || Deno.env.get('APP_BASE_URL') || 'https://yunoapp.eu'}/unsubscribe?token=${unsubToken}`;
        const mail = buildNextEventRec({
          lang,
          firstName: profile?.first_name || undefined,
          events: scoredEvents.map((e) => {
            const dp = fmtDateParts(e.start_at, lang);
            const vName = (e.venues as any)?.name || '';
            return { title: e.title, meta: `${dp.day} ${dp.month}${vName ? ' · ' + vName : ''}`, url: `https://yunoapp.eu/event/${e.id}`, img: e.poster_url || undefined };
          }),
          unsubscribeUrl: unsubUrl,
          recipientEmail: userData.email,
        });
        const html = mail.html;
        const subject = mail.subject;

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` },
          body: JSON.stringify({ from, to: [userData.email], subject, html, headers: unsubscribeHeaders(unsubToken) }),
        });
        if (res.ok) {
          await markSent(supabaseAdmin, userId, 'next_event_rec', weekKey);
          sentCount++;
        }
      } catch (err) {
        console.error(`Next event rec error for ${userId}:`, err);
      }
    }

    logStep("Completed", { sentCount });
    return new Response(
      JSON.stringify({ success: true, sent: sentCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[NEXT-EVENT-REC] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
