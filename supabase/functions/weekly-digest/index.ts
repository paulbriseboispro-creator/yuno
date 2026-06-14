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
    const weekendStart = new Date(now);
    // Find coming Friday
    const daysUntilFriday = (5 - weekendStart.getDay() + 7) % 7 || 7;
    weekendStart.setDate(weekendStart.getDate() + daysUntilFriday);
    weekendStart.setHours(0, 0, 0, 0);
    const weekendEnd = new Date(weekendStart);
    weekendEnd.setDate(weekendEnd.getDate() + 3); // Fri-Sun

    // Get upcoming weekend events
    const { data: events } = await supabase
      .from('events')
      .select('id, title, venue_id')
      .gte('start_at', weekendStart.toISOString())
      .lte('start_at', weekendEnd.toISOString())
      .eq('is_active', true);

    const eventCount = events?.length || 0;
    if (eventCount === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, reason: 'no events' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get all push subscribers
    const { data: subs } = await supabase.from('push_subscriptions').select('user_id');
    const userIds = [...new Set((subs || []).map(s => s.user_id))];

    let sentCount = 0;

    for (const userId of userIds) {
      // Anti-spam: max 1 digest per week
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: existing } = await supabase
        .from('notification_log')
        .select('id')
        .eq('user_id', userId)
        .eq('notification_type', 'marketing')
        .gte('sent_at', weekAgo)
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

      try {
        await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify({
            user_id: userId,
            payload: {
              title: 'Ton week-end commence ici 🎉',
              body: `${eventCount} soirée${eventCount > 1 ? 's' : ''} ce week-end. Découvre la programmation.`,
              url: '/'
            }
          })
        });
        sentCount++;

        await supabase.from('notification_log').insert({
          user_id: userId, notification_type: 'marketing', title: 'Weekly digest'
        });
      } catch (e) { console.error('[DIGEST] Error:', e); }
    }

    console.log(`[WEEKLY-DIGEST] Sent ${sentCount}/${userIds.length}`);

    return new Response(JSON.stringify({ success: true, sent: sentCount }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
