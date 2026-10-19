import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { type EmailLanguage } from '../_shared/email-branding.ts';
import { buildWaitlistOpen, buildWaitlistJoined, fmtDateParts } from "../_shared/email-templates.ts";
import { sendAutoPush } from "../_shared/auto-push.ts";
import { demoPreviewGuard } from "../_shared/demo-guard.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[NOTIFY-EVENT-WAITLIST] ${step}${detailsStr}`);
};

// Colonnes du select sur events (requête typée par .returns<…>() : sans schéma,
// l'inférence supabase-js type l'embed venues en tableau).
interface WaitlistEventRow {
  title: string;
  start_at: string | null;
  venue_id: string | null;
  organizer_user_id: string | null;
  poster_url: string | null;
  description: string | null;
  timezone: string | null;
  venues: { name: string | null } | null;
}

/** Langue d'un email sans profil : celle du pays de la soirée, sinon l'anglais. */
function langForTimezone(tz: string | null): EmailLanguage {
  if (tz === 'Europe/Madrid' || tz === 'Atlantic/Canary') return 'es';
  if (tz === 'Europe/Paris') return 'fr';
  return 'en';
}

function buildWaitlistConfirmationEmail(
  entry: { full_name?: string | null },
  eventTitle: string,
  venueName: string,
  posterUrl: string | null,
  eventDate: string | null,
  lang: EmailLanguage = 'fr'
): { subject: string; html: string } {
  const dp = eventDate ? fmtDateParts(eventDate, lang) : null;
  const meta = dp ? [`${dp.day} ${dp.month}`.trim(), dp.time].filter(Boolean).join(' · ') : undefined;
  const mail = buildWaitlistJoined({
    lang,
    firstName: (entry.full_name || '').trim().split(' ')[0] || undefined,
    eventTitle,
    venueName,
    posterUrl: posterUrl || undefined,
    meta,
  });
  return { subject: mail.subject, html: mail.html };
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
  // Lien démo : lecture seule garantie côté serveur (_shared/demo-guard.ts).
  const demoRefusal = await demoPreviewGuard(req, corsHeaders);
  if (demoRefusal) return demoRefusal;

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
      .select('title, start_at, venue_id, poster_url, description, organizer_user_id, timezone, venues!events_venue_id_fkey(name)')
      .eq('id', eventId)
      .returns<WaitlistEventRow[]>()
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
          if (event.organizer_user_id && event.organizer_user_id === user.id) {
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
      .select('id, email, full_name, user_id')
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
      // Soirée sans club : c'est l'organisateur qui signe, et le lien mène à la
      // soirée elle-même (/event/<id> se résout toujours). Avant : « Yuno » et
      // https://yunoapp.eu/club/null — le bouton « Acheter » de l'email ouvrait
      // une page introuvable.
      let hostName = event.venues?.name || null;
      if (!hostName && event.organizer_user_id) {
        const { data: org } = await supabaseClient
          .from('organizer_profiles').select('display_name')
          .eq('user_id', event.organizer_user_id).maybeSingle();
        hostName = org?.display_name || null;
      }
      const venueName = hostName || 'Yuno';
      const eventUrl = `https://yunoapp.eu/event/${eventId}`;
      const eventImageUrl = event.poster_url || null;
      // Langue : celle du compte quand la personne en a un, sinon celle du pays
      // de la soirée (jamais le français d'office pour une soirée à Ségovie).
      const fallbackLang = langForTimezone(event.timezone);
      const userIds = [...new Set(entries.map((e) => e.user_id).filter((id): id is string => !!id))];
      const langByUser = new Map<string, EmailLanguage>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabaseClient
          .from('profiles').select('id, preferred_language').in('id', userIds);
        for (const p of profiles ?? []) {
          const l = p.preferred_language;
          if (l === 'en' || l === 'fr' || l === 'es') langByUser.set(p.id, l);
        }
      }

      for (const entry of entries) {
        const lang: EmailLanguage = (entry.user_id && langByUser.get(entry.user_id)) || fallbackLang;
        try {
          const emailData = type === 'confirmation'
            ? buildWaitlistConfirmationEmail(entry, event.title, venueName, eventImageUrl, event.start_at, lang)
            : buildWaitlistOpeningEmail(entry, event.title, venueName, eventUrl, eventImageUrl, event.start_at, event.description, lang);

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
      // Registre auto (clé 'waitlist_presale') : gate super admin + langue du
      // destinataire + tracking ?an=. NB : l'ancien appel envoyait un corps
      // { userId, title, ... } que le relay ne comprend pas ({ user_id, payload }
      // attendu) — le push waitlist ne partait donc JAMAIS. Corrigé ici.
      const { data: waitlistUsers } = await supabaseClient
        .from('event_waitlist')
        .select('user_id')
        .eq('event_id', eventId)
        .not('user_id', 'is', null);

      if (waitlistUsers && waitlistUsers.length > 0) {
        const userIds = [...new Set(waitlistUsers.map(w => w.user_id).filter(Boolean))];

        let pushSent = 0;
        for (const userId of userIds) {
          try {
            const res = await sendAutoPush(supabaseClient, {
              key: 'waitlist_presale',
              userId,
              url: `/event/${eventId}`,
              vars: { event: event.title || '' },
            });
            if (res.sent > 0) pushSent++;
          } catch (pushErr) {
            console.error(`Push error for user ${userId}:`, pushErr);
          }
        }
        logStep("Push notifications sent", { userCount: userIds.length, pushSent });
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
