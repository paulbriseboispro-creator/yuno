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
  console.log(`[NOTIFY-WAITLIST] ${step}${detailsStr}`);
};

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

    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    const { roundId, ticketsFreed = 1 } = await req.json();
    
    if (!roundId) {
      throw new Error('roundId is required');
    }

    logStep("Request data", { roundId, ticketsFreed, callerUserId: user.id });

    // Get round and event details
    const { data: round, error: roundError } = await supabaseClient
      .from('ticket_rounds')
      .select('*, events(id, title, start_at, venue_id)')
      .eq('id', roundId)
      .single();

    if (roundError || !round) {
      throw new Error('Round not found');
    }

    // Verify caller is owner or manager of the venue
    const venueId = round.events.venue_id;
    const { data: canManage } = await supabaseClient.rpc('can_manage_venue', {
      _user_id: user.id,
      _venue_id: venueId,
    });

    if (!canManage) {
      return new Response(JSON.stringify({ error: 'Unauthorized: you must be the venue owner or manager' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get venue details
    const { data: venue } = await supabaseClient
      .from('venues')
      .select('id, name')
      .eq('id', venueId)
      .single();

    // Find the last active round price for waitlist purchases
    const { data: lastActiveRound } = await supabaseClient
      .from('ticket_rounds')
      .select('price, name')
      .eq('event_id', round.event_id)
      .eq('is_active', true)
      .order('position', { ascending: false })
      .limit(1)
      .single();

    const purchasePrice = lastActiveRound?.price || round.price;

    logStep("Round found", { roundName: round.name, eventTitle: round.events.title, purchasePrice });

    // Find next person in waitlist who hasn't been notified or whose notification expired
    const now = new Date().toISOString();
    const { data: nextInLine, error: waitlistError } = await supabaseClient
      .from('ticket_waitlist')
      .select('*')
      .eq('ticket_round_id', roundId)
      .eq('purchased', false)
      .or(`notified_at.is.null,expired_at.lt.${now}`)
      .order('position', { ascending: true })
      .limit(ticketsFreed);

    if (waitlistError) {
      throw waitlistError;
    }

    if (!nextInLine || nextInLine.length === 0) {
      logStep("No one in waitlist to notify");
      return new Response(
        JSON.stringify({ success: true, notified: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logStep("Found people to notify", { count: nextInLine.length });

    const appUrl = Deno.env.get("APP_BASE_URL") || "https://yunoapp.eu";

    let notifiedCount = 0;
    for (const entry of nextInLine) {
      // Set expiration to 30 minutes from now
      const expiredAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      // Update waitlist entry
      const { error: updateError } = await supabaseClient
        .from('ticket_waitlist')
        .update({
          notified_at: now,
          expired_at: expiredAt,
        })
        .eq('id', entry.id);

      if (updateError) {
        console.error('Error updating waitlist entry:', updateError);
        continue;
      }

      // Build purchase URL
      const purchaseUrl = `${appUrl}/club/${venue?.id || venueId}/event/${round.event_id}/tickets/${roundId}?waitlist=true`;

      // Build meta (date · time) from event start
      const lang = 'fr';
      const dp = fmtDateParts(round.events.start_at, lang);
      const meta = [`${dp.day} ${dp.month}`.trim(), dp.time].filter(Boolean).join(' · ');

      // Send email with Yuno editorial template
      try {
        const mail = buildWaitlistOpen({
          lang,
          eventTitle: round.events.title,
          venueName: venue?.name || 'Yuno',
          meta,
          url: purchaseUrl,
        });
        const emailResponse = await resend.emails.send({
          from: "Yuno <noreply@yunoapp.eu>",
          to: [entry.email],
          subject: mail.subject,
          html: mail.html,
        });

        logStep("Email sent", { email: entry.email, position: entry.position });
        notifiedCount++;
      } catch (emailError) {
        console.error('Error sending email:', emailError);
      }
    }

    logStep("Notifications complete", { notifiedCount });

    return new Response(
      JSON.stringify({ success: true, notified: notifiedCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[NOTIFY-WAITLIST] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
