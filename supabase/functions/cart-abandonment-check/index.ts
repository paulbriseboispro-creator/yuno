import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { authorizeCronRequest } from "../_shared/cron-auth.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

    // Find pending tickets (created 30min-2h ago, still pending = abandoned checkout)
    const { data: pendingTickets } = await supabase
      .from('tickets')
      .select('user_id, event_id, events!inner(title)')
      .eq('status', 'pending')
      .lte('created_at', thirtyMinAgo)
      .gte('created_at', twoHoursAgo);

    // Also check cart_snapshots for drink carts
    const { data: cartSnapshots } = await supabase
      .from('cart_snapshots')
      .select('*')
      .is('notified_at', null)
      .eq('converted', false)
      .lte('updated_at', thirtyMinAgo)
      .gte('updated_at', twoHoursAgo);

    let sentCount = 0;
    const notifiedUsers = new Set<string>();

    // Ticket abandonment notifications
    for (const ticket of pendingTickets || []) {
      if (!ticket.user_id || notifiedUsers.has(ticket.user_id)) continue;

      // Anti-spam: check daily limit
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const { data: todayNotifs } = await supabase
        .from('notification_log')
        .select('id')
        .eq('user_id', ticket.user_id)
        .in('notification_type', ['marketing', 'campaign', 'reminder'])
        .gte('sent_at', dayAgo);

      if ((todayNotifs?.length || 0) >= 3) continue;

      // 4h cooldown
      const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();
      const { data: recentNotif } = await supabase
        .from('notification_log')
        .select('id')
        .eq('user_id', ticket.user_id)
        .in('notification_type', ['marketing', 'campaign'])
        .gte('sent_at', fourHoursAgo)
        .limit(1);

      if (recentNotif && recentNotif.length > 0) continue;

      try {
        const eventTitle = (ticket as any).events?.title || 'cet événement';
        await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify({
            user_id: ticket.user_id,
            payload: {
              title: 'Toujours dispo 🎟️',
              body: `Tes tickets pour ${eventTitle} sont encore disponibles.`,
              url: `/my-orders?tab=tickets`
            }
          })
        });
        sentCount++;
        notifiedUsers.add(ticket.user_id);

        await supabase.from('notification_log').insert({
          user_id: ticket.user_id, notification_type: 'marketing', title: 'Cart abandonment: ticket'
        });
      } catch (e) { console.error('[CART-ABANDON] Ticket error:', e); }
    }

    // Drink cart abandonment
    for (const snapshot of cartSnapshots || []) {
      if (notifiedUsers.has(snapshot.user_id)) continue;

      // Anti-spam checks same as above
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const { data: todayNotifs } = await supabase
        .from('notification_log')
        .select('id')
        .eq('user_id', snapshot.user_id)
        .in('notification_type', ['marketing', 'campaign', 'reminder'])
        .gte('sent_at', dayAgo);

      if ((todayNotifs?.length || 0) >= 3) continue;

      try {
        await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify({
            user_id: snapshot.user_id,
            payload: {
              title: 'Finaliser ta commande ? 🍹',
              body: 'Tes cocktails sont toujours dans ton panier.',
              url: '/cart'
            }
          })
        });
        sentCount++;

        // Mark as notified
        await supabase.from('cart_snapshots').update({ notified_at: now.toISOString() }).eq('id', snapshot.id);

        await supabase.from('notification_log').insert({
          user_id: snapshot.user_id, notification_type: 'marketing', title: 'Cart abandonment: drink'
        });
      } catch (e) { console.error('[CART-ABANDON] Drink error:', e); }
    }

    console.log(`[CART-ABANDONMENT] Sent ${sentCount} notifications`);

    return new Response(JSON.stringify({ success: true, sent: sentCount }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
