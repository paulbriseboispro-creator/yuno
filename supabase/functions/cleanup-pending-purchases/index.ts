import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.83.0';

import { authorizeCronRequest } from "../_shared/cron-auth.ts";
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const PENDING_TIMEOUT_MINUTES = 30;

Deno.serve(async (req) => {
    // SECURITY: scheduled function — require shared cron secret or super-admin JWT
    const _cronAuth = await authorizeCronRequest(req);
    if (!_cronAuth.ok) {
      return new Response(
        JSON.stringify({ error: _cronAuth.message }),
        { status: _cronAuth.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const cutoff = new Date(Date.now() - PENDING_TIMEOUT_MINUTES * 60 * 1000).toISOString();

    // Step 1: expire stale ticket capacity reservations FIRST (frees seats for new buyers)
    // These have a short TTL (10 min) — independent of the 30-min ticket cleanup below.
    let expiredReservations = 0;
    try {
      const { data: expiredCount, error: expireErr } = await supabase.rpc('expire_stale_ticket_reservations');
      if (expireErr) {
        console.error('Error expiring stale ticket reservations:', expireErr);
      } else {
        expiredReservations = Number(expiredCount) || 0;
        if (expiredReservations > 0) {
          console.log(`Expired ${expiredReservations} stale ticket capacity reservations`);
        }
      }
    } catch (e) {
      console.error('expire_stale_ticket_reservations RPC failed:', e);
    }

    // Step 2: clean up pending tickets older than 30 minutes without completed payment
    const { data: expiredTickets, error: ticketFetchError } = await supabase
      .from('tickets')
      .select('id')
      .eq('status', 'pending')
      .lt('created_at', cutoff);

    if (ticketFetchError) {
      console.error('Error fetching expired tickets:', ticketFetchError);
      return new Response(JSON.stringify({ error: ticketFetchError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const ticketIds = (expiredTickets || []).map(t => t.id);
    let deletedTickets = 0;
    if (ticketIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('tickets')
        .delete()
        .in('id', ticketIds);
      if (deleteError) {
        console.error('Error deleting expired tickets:', deleteError);
      } else {
        deletedTickets = ticketIds.length;
        console.log(`Deleted ${deletedTickets} expired pending tickets`);
      }
    }

    // Step 3: clean up pending VIP table reservations older than 30 minutes
    const { data: expiredVipRes, error: resFetchError } = await supabase
      .from('table_reservations')
      .select('id')
      .eq('status', 'pending')
      .lt('created_at', cutoff);

    if (resFetchError) {
      console.error('Error fetching expired reservations:', resFetchError);
      return new Response(JSON.stringify({ error: resFetchError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const reservationIds = (expiredVipRes || []).map(r => r.id);
    let deletedReservations = 0;
    if (reservationIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('table_reservations')
        .delete()
        .in('id', reservationIds);
      if (deleteError) {
        console.error('Error deleting expired reservations:', deleteError);
      } else {
        deletedReservations = reservationIds.length;
        console.log(`Deleted ${deletedReservations} expired pending reservations`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      expiredCapacityReservations: expiredReservations,
      deletedTickets,
      deletedReservations,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Unexpected error:', error);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
