import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { Resend } from "https://esm.sh/resend@2.0.0";

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

        // Send bulk email to all waitlist entries with Yuno branding
        for (const entry of waitlistEntries) {
          // Mark as notified (no expiry for bulk notification - first come first served)
          await supabaseClient
            .from('ticket_waitlist')
            .update({ notified_at: now.toISOString() })
            .eq('id', entry.id);

          try {
            await resend.emails.send({
              from: "Yuno <notifications@resend.dev>",
              to: [entry.email],
              subject: `🚨 Dernière chance - ${event.title} commence bientôt!`,
              html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="utf-8">
                  <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #050505; color: #fff; }
                    .container { max-width: 500px; margin: 0 auto; background: #0a0a0a; border-radius: 16px; padding: 32px; border: 1px solid rgba(255,255,255,0.05); }
                    .logo { text-align: center; margin-bottom: 24px; font-size: 28px; font-weight: bold; color: #dc2626; }
                    h1 { color: #fff; margin: 0 0 16px 0; font-size: 24px; }
                    p { color: #a0a0a0; line-height: 1.6; margin: 0 0 16px 0; }
                    .highlight { color: #dc2626; font-weight: bold; }
                    .stats { background: #1a1a1a; border-radius: 12px; padding: 20px; margin: 20px 0; display: flex; justify-content: space-around; text-align: center; }
                    .stat-value { font-size: 28px; font-weight: bold; color: #fff; }
                    .stat-label { font-size: 12px; color: #888; margin-top: 4px; }
                    .urgent { background: #dc2626; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center; }
                    .urgent p { color: #fff; margin: 0; font-weight: bold; font-size: 16px; }
                    .button { display: inline-block; background: #dc2626; color: #fff !important; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: bold; font-size: 16px; margin: 24px 0; }
                    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 12px; color: #666; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="logo">YUNO</div>
                    <h1>🚨 Dernière chance!</h1>
                    <p><span class="highlight">${event.title}</span> commence dans moins de 2 heures et des places se sont libérées!</p>
                    
                    <div class="stats">
                      <div>
                        <div class="stat-value">${availableTickets}</div>
                        <div class="stat-label">places disponibles</div>
                      </div>
                      <div>
                        <div class="stat-value">${round.price}€</div>
                        <div class="stat-label">par place</div>
                      </div>
                    </div>
                    
                    <div class="urgent">
                      <p>⚡ Premier arrivé, premier servi!</p>
                    </div>
                    
                    <center>
                      <a href="${purchaseUrl}" class="button">Réserver maintenant →</a>
                    </center>
                    
                    <div class="footer">
                      <p>Vous recevez cet email car vous étiez inscrit sur la liste d'attente pour ${event.title}.</p>
                    </div>
                  </div>
                </body>
                </html>
              `,
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
