import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { authorizeCronRequest } from "../_shared/cron-auth.ts";
import { sendAutoPush, isAutoPushEnabled } from "../_shared/auto-push.ts";
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

    // Kill switch plateforme (/admin/notifications, clé 'cart_abandonment').
    if (!(await isAutoPushEnabled(supabase, 'cart_abandonment'))) {
      return new Response(JSON.stringify({ success: true, sent: 0, skipped: 'disabled' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

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

      // Registre auto (clé 'cart_abandonment', variante billet) : langue +
      // tracking ?an=. Le helper journalise notification_log type 'marketing'
      // (mêmes plafonds anti-spam que l'insert manuel qu'il remplace).
      try {
        const eventTitle = (ticket as any).events?.title
          || { fr: 'cet événement', en: 'this event', es: 'este evento' };
        const res = await sendAutoPush(supabase, {
          key: 'cart_abandonment',
          variant: 'ticket',
          userId: ticket.user_id,
          url: `/my-orders?tab=tickets`,
          vars: { event: eventTitle },
        });
        if (res.sent > 0) sentCount++;
        notifiedUsers.add(ticket.user_id);
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

      // Registre auto (clé 'cart_abandonment', variante boissons).
      try {
        const res = await sendAutoPush(supabase, {
          key: 'cart_abandonment',
          variant: 'drinks',
          userId: snapshot.user_id,
          url: '/cart',
        });
        if (res.sent > 0) sentCount++;

        // Mark as notified
        await supabase.from('cart_snapshots').update({ notified_at: now.toISOString() }).eq('id', snapshot.id);
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
