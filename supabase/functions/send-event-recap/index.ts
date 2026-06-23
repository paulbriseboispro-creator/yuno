import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { Resend } from "https://esm.sh/resend@2.0.0";
import { authorizeCronRequest } from "../_shared/cron-auth.ts";
import {
  UserStats,
  TicketDetail,
  DrinkDetail,
  selectBestStats
} from "../_shared/recap-stats.ts";
import {
  EmailLanguage
} from "../_shared/email-branding.ts";
import { buildEventRecap } from "../_shared/email-templates.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[EVENT-RECAP] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

    // SECURITY: scheduled function — require shared cron secret or super-admin JWT
    const _cronAuth = await authorizeCronRequest(req);
    if (!_cronAuth.ok) {
      return new Response(
        JSON.stringify({ error: _cronAuth.message }),
        { status: _cronAuth.status, headers: { 'Content-Type': 'application/json' } }
      );
    }


  try {
    logStep("Function started");

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const resendFrom = Deno.env.get('RESEND_FROM_EMAIL');

    const resend = new Resend(resendApiKey);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Find events that ended in the last 4 hours
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    
    const { data: endedEvents, error: eventsError } = await supabaseAdmin
      .from('events')
      .select('id, title, start_at, end_at, venue_id, venues(name)')
      .lte('end_at', now)
      .gte('end_at', fourHoursAgo);

    if (eventsError) {
      throw new Error(`Error fetching events: ${eventsError.message}`);
    }

    logStep("Found ended events", { count: endedEvents?.length || 0 });

    if (!endedEvents || endedEvents.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No events to process", sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let totalSent = 0;

    for (const event of endedEvents) {
      const venueData = event.venues as { name?: string };
      const venueName = venueData?.name || 'the club';
      const venueSlug = event.venue_id;

      logStep("Processing event", { eventId: event.id, title: event.title });

      // Get orders with full details
      const { data: orders } = await supabaseAdmin
        .from('orders')
        .select('user_id, user_email, total, items')
        .eq('event_id', event.id)
        .eq('status', 'served')
        .not('user_id', 'is', null);

      // Get tickets with round details
      const { data: tickets } = await supabaseAdmin
        .from('tickets')
        .select(`
          user_id, 
          user_email, 
          quantity, 
          unit_price, 
          total_price,
          drink_redeemed,
          drink_name,
          ticket_round_id
        `)
        .eq('event_id', event.id)
        .in('status', ['used', 'paid']);

      // Get ticket rounds for names
      const { data: ticketRounds } = await supabaseAdmin
        .from('ticket_rounds')
        .select('id, name, price, includes_drink')
        .eq('event_id', event.id);

      const roundMap = new Map(ticketRounds?.map(r => [r.id, r]) || []);

      // Get table reservations
      const { data: tableReservations } = await supabaseAdmin
        .from('table_reservations')
        .select('user_id, user_email, total_price')
        .eq('event_id', event.id)
        .eq('status', 'confirmed');

      // Collect all unique users with detailed data
      type UserData = {
        email: string;
        orders: { total: number; items: unknown }[];
        tickets: TicketDetail[];
        tablesCount: number;
        tableSavings: number;
      };
      
      const userMap = new Map<string, UserData>();
      
      const getOrCreateUser = (userId: string, email: string): UserData => {
        const existing = userMap.get(userId);
        if (existing) {
          existing.email = existing.email || email;
          return existing;
        }
        const newUser: UserData = { 
          email, 
          orders: [], 
          tickets: [], 
          tablesCount: 0, 
          tableSavings: 0 
        };
        userMap.set(userId, newUser);
        return newUser;
      };

      // Process orders
      for (const order of orders || []) {
        if (!order.user_id) continue;
        const user = getOrCreateUser(order.user_id, order.user_email);
        user.orders.push({ total: order.total, items: order.items });
      }

      // Process tickets with details
      for (const ticket of tickets || []) {
        if (!ticket.user_id) continue;
        const user = getOrCreateUser(ticket.user_id, ticket.user_email);
        const round = roundMap.get(ticket.ticket_round_id);
        user.tickets.push({
          roundName: round?.name || 'Ticket',
          quantity: ticket.quantity || 1,
          unitPrice: ticket.unit_price || 0,
          totalPrice: ticket.total_price || 0,
          includesDrink: round?.includes_drink || false,
          drinkName: ticket.drink_name || undefined,
          drinkRedeemed: ticket.drink_redeemed || false
        });
      }

      // Process table reservations
      for (const table of tableReservations || []) {
        if (!table.user_id) continue;
        const user = getOrCreateUser(table.user_id, table.user_email);
        user.tablesCount += 1;
      }

      logStep("Users to process", { count: userMap.size });

      for (const [userId, userData] of userMap) {
        // Check if already sent
        const { data: alreadySent } = await supabaseAdmin
          .from('event_recap_sent')
          .select('id')
          .eq('event_id', event.id)
          .eq('user_id', userId)
          .single();

        if (alreadySent) continue;
        if (!userData.email) continue;

        // Get user profile with language preference
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('first_name, preferred_language')
          .eq('id', userId)
          .single();

        // Determine user's preferred language
        let lang: EmailLanguage = 'fr';
        if (profile?.preferred_language && ['en', 'es', 'fr'].includes(profile.preferred_language)) {
          lang = profile.preferred_language as EmailLanguage;
        }

        // Get loyalty data
        const { data: loyalty } = await supabaseAdmin
          .from('customer_loyalty')
          .select('current_balance, total_points_earned, tier')
          .eq('venue_id', event.venue_id)
          .eq('user_id', userId)
          .single();

        // Count visits
        const { count: visitCount } = await supabaseAdmin
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('venue_id', event.venue_id)
          .eq('user_id', userId)
          .eq('status', 'served');

        // Parse drink details from orders
        const drinkDetails: DrinkDetail[] = [];
        for (const order of userData.orders) {
          const items = order.items as { name?: string; qty?: number; quantity?: number; category?: string }[];
          if (items) {
            for (const item of items) {
              drinkDetails.push({
                name: item.name || 'Drink',
                quantity: item.qty || item.quantity || 1,
                category: item.category || 'autres'
              });
            }
          }
        }

        // Calculate stats
        const drinksCount = drinkDetails.reduce((sum, d) => sum + d.quantity, 0);
        const totalSpent = userData.orders.reduce((sum, o) => sum + (o.total || 0), 0);
        const ticketsCount = userData.tickets.reduce((sum, t) => sum + t.quantity, 0);
        const pointsEarned = Math.floor(totalSpent);

        // Lifetime stats
        const { data: lifetimeOrders } = await supabaseAdmin
          .from('orders')
          .select('total')
          .eq('venue_id', event.venue_id)
          .eq('user_id', userId)
          .eq('status', 'served');

        const lifetimeSpent = lifetimeOrders?.reduce((sum, o) => sum + (o.total || 0), 0) || 0;

        const userStats: UserStats = {
          drinksCount,
          totalSpent,
          ticketsCount,
          tablesCount: userData.tablesCount,
          pointsEarned,
          currentBalance: loyalty?.current_balance || 0,
          tier: loyalty?.tier || 'bronze',
          visitCount: visitCount || 1,
          lifetimeSpent,
          lifetimePoints: loyalty?.total_points_earned || 0,
          favoriteCategory: null,
          isFirstVisit: (visitCount || 1) === 1,
          ticketDetails: userData.tickets,
          drinkDetails,
          tableSavings: 0
        };

        // Select the best stats to surface (localized wording lives in selectBestStats)
        const bestStats = selectBestStats(userStats);

        logStep("Selected for user", {
          userId,
          stats: bestStats.map(s => s.label),
          drinks: drinksCount,
          tickets: ticketsCount,
          lang
        });

        const mail = buildEventRecap({
          lang,
          firstName: profile?.first_name || undefined,
          eventTitle: event.title,
          venueName,
          stats: bestStats.map(s => ({ k: s.label, v: s.value })),
          venueUrl: `https://yunoapp.eu/club/${venueSlug}`,
        });

        try {
          const from = resendFrom
            ? (resendFrom.includes('<') ? resendFrom : `Yuno <${resendFrom}>`)
            : 'Yuno <noreply@yunoapp.eu>';

          const sendResp = await resend.emails.send({
            from,
            to: [userData.email],
            subject: mail.subject,
            html: mail.html
          });

          if (sendResp?.error) {
            throw sendResp.error;
          }

          await supabaseAdmin
            .from('event_recap_sent')
            .insert({
              event_id: event.id,
              user_id: userId,
              email: userData.email
            });

          logStep("Email sent", { email: userData.email, lang });
          totalSent++;
        } catch (emailError) {
          console.error('Error sending email:', emailError);
        }
      }
    }

    logStep("Completed", { totalSent });

    return new Response(
      JSON.stringify({ success: true, sent: totalSent }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in event recap:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
