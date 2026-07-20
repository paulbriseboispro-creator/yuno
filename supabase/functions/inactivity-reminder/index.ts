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

    for (const userId of inactiveUsers) {
      // Anti-spam: max 1 inactivity reminder per 30 days
      const { data: existing } = await supabase
        .from('notification_log')
        .select('id')
        .eq('user_id', userId)
        .eq('notification_type', 'marketing')
        .gte('sent_at', thirtyDaysAgo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Anti-spam: max 3 non-transactional per day
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const { data: todayNotifs } = await supabase
        .from('notification_log')
        .select('id')
        .eq('user_id', userId)
        .in('notification_type', ['marketing', 'campaign', 'reminder'])
        .gte('sent_at', dayAgo);

      if ((todayNotifs?.length || 0) >= 3) continue;

      // Registre auto (clé 'inactivity_reminder') : langue + tracking ?an=.
      // Le helper journalise notification_log type 'marketing' (mêmes plafonds).
      try {
        const res = await sendAutoPush(supabase, {
          key: 'inactivity_reminder',
          userId,
          url: '/',
        });
        if (res.sent > 0) sentCount++;
      } catch (e) { console.error('[INACTIVITY] Error:', e); }
    }

    console.log(`[INACTIVITY-REMINDER] Sent ${sentCount}/${inactiveUsers.length}`);

    return new Response(JSON.stringify({ success: true, sent: sentCount }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
