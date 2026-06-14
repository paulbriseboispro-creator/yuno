/**
 * event-ended — cron function (same schedule as event-reminder, e.g. every 15 min)
 *
 * Detects events that ended in the last 15-minute window and fires:
 *   1. event_ended — owner notification with a full stats report in metadata
 *
 * Stats attached in metadata:
 *   tickets_sold, ticket_revenue, scan_count, scan_rate,
 *   orders_count, order_revenue, table_reservations, table_revenue,
 *   total_revenue
 *
 * Deduplication: checks staff_notifications for an event_ended notif on
 * this event_id in the last 48h before inserting.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { authorizeCronRequest } from '../_shared/cron-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const cronAuth = await authorizeCronRequest(req);
  if (!cronAuth.ok) {
    return new Response(JSON.stringify({ error: cronAuth.message }), {
      status: cronAuth.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    // Window: events that ended between 15min and 30min ago (15-min cron)
    const windowStart = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    const windowEnd   = new Date(now.getTime() - 15 * 60 * 1000).toISOString();

    const { data: endedEvents } = await supabase
      .from('events')
      .select('id, title, start_at, end_at, venue_id, poster_url')
      .gte('end_at', windowStart)
      .lte('end_at', windowEnd)
      .eq('is_active', true);

    let processed = 0;

    for (const event of endedEvents ?? []) {
      if (!event.venue_id) continue;

      // Dedup — skip if already fired for this event in last 48h
      const { count: alreadyFired } = await supabase
        .from('staff_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', event.venue_id)
        .eq('notification_type', 'event_ended')
        .eq('event_id', event.id)
        .gte('created_at', new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString());

      if ((alreadyFired ?? 0) > 0) continue;

      // ── Compute stats ─────────────────────────────────────────────────

      // Tickets
      const { data: tickets } = await supabase
        .from('tickets')
        .select('quantity, total_price, service_fee, scanned_at')
        .eq('event_id', event.id)
        .eq('status', 'paid');

      const ticketsSold = (tickets ?? []).reduce((s, t) => s + (t.quantity ?? 1), 0);
      const ticketRevenue = (tickets ?? []).reduce(
        (s, t) => s + Number(t.total_price ?? 0) - Number(t.service_fee ?? 0), 0
      );
      const scannedCount = (tickets ?? []).filter(t => t.scanned_at).length;
      const scanRate = ticketsSold > 0 ? Math.round((scannedCount / ticketsSold) * 100) : 0;

      // Drink orders
      const { data: orders } = await supabase
        .from('orders')
        .select('total, service_fee')
        .eq('event_id', event.id)
        .in('status', ['paid', 'served']);

      const ordersCount = (orders ?? []).length;
      const orderRevenue = (orders ?? []).reduce(
        (s, o) => s + Number(o.total ?? 0) - Number(o.service_fee ?? 0), 0
      );

      // Table reservations
      const { data: tables } = await supabase
        .from('table_reservations')
        .select('deposit, service_fee')
        .eq('event_id', event.id)
        .in('status', ['paid', 'confirmed']);

      const tableCount = (tables ?? []).length;
      const tableRevenue = (tables ?? []).reduce(
        (s, t) => s + Number(t.deposit ?? 0) - Number(t.service_fee ?? 0), 0
      );

      const totalRevenue = ticketRevenue + orderRevenue + tableRevenue;

      // ── Format durations ──────────────────────────────────────────────
      const startDate = new Date(event.start_at);
      const endDate = new Date(event.end_at);
      const durationHours = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60) * 10) / 10;

      const parts: string[] = [];
      if (ticketsSold > 0)  parts.push(`${ticketsSold} billet${ticketsSold > 1 ? 's' : ''}`);
      if (ordersCount > 0)  parts.push(`${ordersCount} commande${ordersCount > 1 ? 's' : ''}`);
      if (tableCount > 0)   parts.push(`${tableCount} table${tableCount > 1 ? 's' : ''} VIP`);

      const summary = parts.length > 0
        ? `${parts.join(' · ')} — ${totalRevenue.toFixed(2)} € CA net`
        : `Aucune activité enregistrée`;

      // ── Insert notification ───────────────────────────────────────────
      await supabase.from('staff_notifications').insert({
        venue_id: event.venue_id,
        target_role: 'owner',
        notification_type: 'event_ended',
        title: `Soirée terminée — ${event.title}`,
        message: summary,
        priority: 'normal',
        reference_type: 'event',
        reference_id: event.id,
        event_id: event.id,
        metadata: {
          event_title: event.title,
          start_at: event.start_at,
          end_at: event.end_at,
          duration_hours: durationHours,
          // Tickets
          tickets_sold: ticketsSold,
          ticket_revenue: Math.round(ticketRevenue * 100) / 100,
          scan_count: scannedCount,
          scan_rate: scanRate,
          // Orders
          orders_count: ordersCount,
          order_revenue: Math.round(orderRevenue * 100) / 100,
          // Tables
          table_reservations: tableCount,
          table_revenue: Math.round(tableRevenue * 100) / 100,
          // Total
          total_revenue: Math.round(totalRevenue * 100) / 100,
        },
      });

      console.log(`[EVENT-ENDED] Notif sent for event ${event.id} — revenue: ${totalRevenue.toFixed(2)} €`);
      processed++;
    }

    return new Response(JSON.stringify({ success: true, processed }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error';
    console.error('[EVENT-ENDED] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
