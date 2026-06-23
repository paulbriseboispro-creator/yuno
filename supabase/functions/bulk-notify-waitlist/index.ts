import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { Resend } from "https://esm.sh/resend@2.0.0";
import { buildWaitlistOpen, fmtDateParts } from "../_shared/email-templates.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[BULK-NOTIFY-WAITLIST] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started - checking events starting in 2 hours");

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Authenticate caller
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid authentication' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller is a super admin or venue owner
    const { data: isSuperAdmin } = await supabaseClient.rpc('is_super_admin');
    const { data: isOwnerOfAny } = await supabaseClient.rpc('is_owner_of_any_venue', { _user_id: user.id });

    if (!isSuperAdmin && !isOwnerOfAny) {
      return new Response(JSON.stringify({ error: 'Unauthorized: admin or venue owner required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    // Find events starting within the next 2 hours
    const now = new Date();
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const { data: upcomingEvents, error: eventsError } = await supabaseClient
      .from('events')
      .select('id, title, start_at, venue_id')
      .eq('is_active', true)
      .gte('start_at', now.toISOString())
      .lte('start_at', twoHoursFromNow.toISOString());

    if (eventsError) {
      throw eventsError;
    }

    if (!upcomingEvents || upcomingEvents.length === 0) {
      logStep("No events starting in the next 2 hours");
      return new Response(
        JSON.stringify({ success: true, eventsProcessed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If not super admin, filter to only events for venues the user owns
    let filteredEvents = upcomingEvents;
    if (!isSuperAdmin) {
      const { data: ownedVenueIds } = await supabaseClient.rpc('get_owner_venue_ids', { _owner_id: user.id });
      const venueIdSet = new Set(ownedVenueIds || []);
      filteredEvents = upcomingEvents.filter(e => venueIdSet.has(e.venue_id));
    }

    logStep("Found upcoming events", { count: filteredEvents.length });

    let totalNotified = 0;

    for (const event of filteredEvents) {
      // Get venue info
      const { data: venue } = await supabaseClient
        .from('venues')
        .select('id, name')
        .eq('id', event.venue_id)
        .single();

      // Find rounds with available tickets for this event
      const { data: rounds, error: roundsError } = await supabaseClient
        .from('ticket_rounds')
        .select('*')
        .eq('event_id', event.id)
        .eq('is_active', true);

      if (roundsError || !rounds) continue;

      for (const round of rounds) {
        const availableTickets = round.max_tickets - round.tickets_sold;
        if (availableTickets <= 0) continue;

        // Find all waitlist entries that haven't purchased yet
        const { data: waitlistEntries, error: waitlistError } = await supabaseClient
          .from('ticket_waitlist')
          .select('*')
          .eq('ticket_round_id', round.id)
          .eq('purchased', false)
          .order('position', { ascending: true });

        if (waitlistError || !waitlistEntries || waitlistEntries.length === 0) continue;

        logStep("Processing waitlist for round", { 
          roundId: round.id, 
          roundName: round.name,
          availableTickets,
          waitlistCount: waitlistEntries.length 
        });

        const appUrl = Deno.env.get("APP_BASE_URL") || "https://yunoapp.eu";
        const purchaseUrl = `${appUrl}/club/${venue?.id || event.venue_id}/event/${event.id}/tickets/${round.id}?waitlist=true`;

        // Build meta (date · time) from event start
        const lang = 'fr';
        const dp = fmtDateParts(event.start_at, lang);
        const meta = [`${dp.day} ${dp.month}`.trim(), dp.time].filter(Boolean).join(' · ');

        // Send bulk email to all waitlist entries with Yuno editorial template
        for (const entry of waitlistEntries) {
          // Mark as notified (no expiry for bulk notification - first come first served)
          await supabaseClient
            .from('ticket_waitlist')
            .update({ notified_at: now.toISOString() })
            .eq('id', entry.id);

          try {
            const mail = buildWaitlistOpen({
              lang,
              eventTitle: event.title,
              venueName: venue?.name || 'Yuno',
              meta,
              url: purchaseUrl,
            });
            await resend.emails.send({
              from: "Yuno <noreply@yunoapp.eu>",
              to: [entry.email],
              subject: mail.subject,
              html: mail.html,
            });
            totalNotified++;
          } catch (emailError) {
            console.error('Error sending email:', emailError);
          }
        }
      }
    }

    logStep("Bulk notification complete", { totalNotified });

    return new Response(
      JSON.stringify({ success: true, eventsProcessed: filteredEvents.length, totalNotified }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[BULK-NOTIFY-WAITLIST] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
