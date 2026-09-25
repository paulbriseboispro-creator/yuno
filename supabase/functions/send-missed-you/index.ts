import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { EmailLanguage, t, wrapEmailWithBranding, escapeHtml } from "../_shared/email-branding.ts";
import { loadOptIns, optInToken, unsubscribeHeaders } from "../_shared/email-compliance.ts";
import { buildWinBack, fmtDateParts } from "../_shared/email-templates.ts";
import { isAutoPushEnabled } from "../_shared/auto-push.ts";
import { emailSendPolicy, logMarketingEmail, automationCoversEvent } from "../_shared/email-policy.ts";
import { formatEventDate } from "../_shared/event-time.ts";

import { authorizeCronRequest } from "../_shared/cron-auth.ts";
import { isDemoEmail, loadDemoEventIds } from "../_shared/demo-scope.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: unknown) => {
  console.log(`[MISSED-YOU] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

interface MissedYouEvent {
  id: string;
  title: string;
  start_at: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  poster_url: string | null;
  venues: { name: string | null } | null;
}

interface TicketContactRow { user_id: string | null; user_email: string | null }

async function wasAlreadySent(supabase: SupabaseClient, userId: string, notifType: string, key: string): Promise<boolean> {
  const { data } = await supabase
    .from('notification_log')
    .select('id')
    .eq('user_id', userId)
    .eq('notification_type', notifType)
    .eq('title', key)
    .limit(1);
  return !!(data && data.length > 0);
}

async function markSent(supabase: SupabaseClient, userId: string, notifType: string, key: string) {
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

    // Registre super admin (/admin/notifications, clé 'email_missed_you').
    if (!(await isAutoPushEnabled(supabaseAdmin, 'email_missed_you'))) {
      return new Response(JSON.stringify({ success: true, sent: 0, skipped: 'disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

    const demoIds = await loadDemoEventIds(supabaseAdmin);
    if (!demoIds) {
      return new Response(
        JSON.stringify({ success: false, sent: 0, message: "demo scope unavailable" }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const { data: recentRaw } = await supabaseAdmin
      .from('events')
      .select('id, title, start_at, venue_id, organizer_user_id, poster_url, venues!events_venue_id_fkey(name)')
      .lte('end_at', twelveHoursAgo)
      .gte('end_at', fortyEightHoursAgo);
    // Jamais la démo (comptes @womber.fr, invités semés @demo.womber.fr).
    // Embarquement many-to-one : `venues` arrive en OBJET (le typage générique
    // de supabase-js, sans schéma, le suppose en tableau).
    const recentEvents = ((recentRaw ?? []) as unknown as MissedYouEvent[]).filter((e) => !demoIds.has(e.id));

    if (!recentEvents || recentEvents.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No recent events" }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let sentCount = 0;

    for (const event of recentEvents) {
      // Une recette « On t'a manqué » (club, organisateur ou Yuno) couvre cette
      // soirée : une seule voix par soirée, cette version historique s'efface.
      if (await automationCoversEvent(supabaseAdmin, event.id, 'post_event_missed')) continue;
      const venueName = event.venues?.name || '';
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
      const attendedUserIds = new Set((attendedRows || []).map((r: TicketContactRow) => r.user_id).filter(Boolean));
      const attendedEmails = new Set((attendedRows || []).map((r: TicketContactRow) => r.user_email).filter(Boolean));

      const attendeeCount = attendedRows?.length ?? 0;

      // Soirée d'un organisateur (sans club) : sa prochaine date à lui —
      // `.eq('venue_id', null)` ne trouvait jamais rien.
      const nextQuery = supabaseAdmin
        .from('events')
        .select('id, title, start_at, timezone');
      const { data: nextEvents } = await (event.venue_id
        ? nextQuery.eq('venue_id', event.venue_id)
        : nextQuery.eq('organizer_user_id', event.organizer_user_id ?? ''))
        .eq('is_active', true)
        .gt('start_at', new Date().toISOString())
        .order('start_at', { ascending: true })
        .limit(1);

      const nextEvent = nextEvents?.[0];
      // Le bouton mène au club ; sans club, à la prochaine soirée de
      // l'organisateur, sinon au feed — jamais « /club/null ».
      const ctaUrl = event.venue_id
        ? `https://yunoapp.eu/club/${event.venue_id}`
        : nextEvent ? `https://yunoapp.eu/event/${nextEvent.id}` : 'https://yunoapp.eu/explore';

      const optins = await loadOptIns(supabaseAdmin, noShowTickets.map((tk: TicketContactRow) => tk.user_email));

      const seen = new Set<string>();
      for (const ticket of noShowTickets) {
        if (!ticket.user_email || !ticket.user_id || seen.has(ticket.user_email)) continue;
        if (isDemoEmail(ticket.user_email)) continue;
        if (attendedUserIds.has(ticket.user_id) || attendedEmails.has(ticket.user_email)) continue;
        // Marketing: send ONLY to recipients who opted in for this venue/organizer.
        const unsubToken = optInToken(optins, ticket.user_email, { venueId: event.venue_id, organizerUserId: event.organizer_user_id });
        if (unsubToken === null) continue;
        seen.add(ticket.user_email);

        const alreadySent = await wasAlreadySent(supabaseAdmin, ticket.user_id, 'missed_you', event.id);
        if (alreadySent) continue;
        // Règles Yuno : pression, fatigue, aversion — tous expéditeurs confondus.
        if (await emailSendPolicy(supabaseAdmin, ticket.user_email, 'missed_you')) continue;

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
            const nextDate = formatEventDate(nextEvent.start_at, { weekday: 'short', day: 'numeric', month: 'short' }, nextEvent.timezone, dateLocales[lang]);
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

              <a href="${ctaUrl}" style="display: inline-block; background: #dc2626; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px; margin-top: 16px;">
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
            meta: (() => { const dp = fmtDateParts(nextEvent.start_at, lang, nextEvent.timezone || undefined); return `${dp.day} ${dp.month}`; })(),
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
            venueUrl: ctaUrl,
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
            await logMarketingEmail(supabaseAdmin, ticket.user_email, 'missed_you', { venueId: event.venue_id, organizerUserId: event.organizer_user_id });
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
