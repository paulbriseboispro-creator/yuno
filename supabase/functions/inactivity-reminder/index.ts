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

    // Kill switch plateforme (/admin/notifications, clé 'inactivity_reminder').
    if (!(await isAutoPushEnabled(supabase, 'inactivity_reminder'))) {
      return new Response(JSON.stringify({ success: true, sent: 0, skipped: 'disabled' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Abonnés de l'app grand public uniquement : la relance est du marketing
    // client, elle n'a rien à faire sur l'app Yuno Pro du staff.
    const { data: subs } = await supabase
      .from('push_subscriptions').select('user_id').eq('platform', 'ios');
    const allSubUsers = [...new Set((subs || []).map(s => s.user_id))];

    // Get recently active users (orders or tickets in last 30 days)
    const { data: recentOrders } = await supabase.from('orders').select('user_id').gte('created_at', thirtyDaysAgo);
    const { data: recentTickets } = await supabase.from('tickets').select('user_id').gte('created_at', thirtyDaysAgo);
    const activeSet = new Set([
      ...(recentOrders || []).map(d => d.user_id),
      ...(recentTickets || []).map(d => d.user_id),
    ]);

    // Inactive = subscribed but no activity in 30d
    const inactiveUsers = allSubUsers.filter(id => !activeSet.has(id));

    let sentCount = 0;

    const skipped: Record<string, number> = {};
    const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1; };

    for (const userId of inactiveUsers) {
      // Porte anti-spam unique : opt-out, heures calmes, 1/24 h, 3/7 j,
      // cooldown 21 j sur cette clé (client_push_policy).
      const { data: pol, error: polErr } = await supabase
        .rpc('client_push_policy', { p_user_id: userId, p_key: 'inactivity_reminder' });
      const verdict = (Array.isArray(pol) ? pol[0] : pol) as { allowed: boolean; reason: string } | undefined;
      if (polErr) { console.error('[INACTIVITY] policy error:', polErr.message); skip('policy_error'); continue; }
      if (!verdict?.allowed) { skip(verdict?.reason || 'policy'); continue; }

      // Relance HONNÊTE : on ne dit « ça bouge dans ta ville » que si c'est
      // vrai. Inventaire réel (clubs visibles + soirées partenaires) sur 14 j
      // dans la zone du client ; zone inconnue ou vide → pas de push.
      const { data: zone } = await supabase
        .rpc('count_zone_events_for_user', { p_user_id: userId, p_days: 14 });
      const z = (Array.isArray(zone) ? zone[0] : zone) as { city_label: string | null; n: number } | undefined;
      if (!z || !z.city_label || (z.n || 0) < 2) { skip('no_inventory'); continue; }

      // Registre auto (clé 'inactivity_reminder') : langue + tracking ?an=.
      // Le helper journalise notification_log type 'marketing' (mêmes plafonds).
      try {
        const res = await sendAutoPush(supabase, {
          key: 'inactivity_reminder',
          variant: 'zone',
          userId,
          url: `/explore?city=${encodeURIComponent(z.city_label)}`,
          vars: { count: String(z.n), city: z.city_label },
        });
        if (res.sent > 0) sentCount++; else skip('no_device');
      } catch (e) { console.error('[INACTIVITY] Error:', e); skip('send_error'); }
    }
    console.log(`[INACTIVITY-REMINDER] skipped=${JSON.stringify(skipped)}`);

    console.log(`[INACTIVITY-REMINDER] Sent ${sentCount}/${inactiveUsers.length}`);

    return new Response(JSON.stringify({ success: true, sent: sentCount }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
