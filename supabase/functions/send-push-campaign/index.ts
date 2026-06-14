import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Auth check - must be super admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Check super admin
    const { data: isSA } = await supabaseAuth.rpc('is_super_admin');
    if (!isSA) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { title, body, url, segment } = await req.json();

    if (!title || !body) {
      return new Response(JSON.stringify({ error: 'title and body required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get user IDs based on segment
    let userIds: string[] = [];

    if (segment === 'all') {
      const { data } = await supabase.from('push_subscriptions').select('user_id');
      userIds = [...new Set((data || []).map((d: any) => d.user_id))];
    } else if (segment === 'active_30d') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase.from('orders').select('user_id').gte('created_at', thirtyDaysAgo);
      const { data: ticketData } = await supabase.from('tickets').select('user_id').gte('created_at', thirtyDaysAgo);
      const activeUsers = new Set([
        ...(data || []).map((d: any) => d.user_id),
        ...(ticketData || []).map((d: any) => d.user_id),
      ]);
      // Filter to those with push subscriptions
      const { data: subs } = await supabase.from('push_subscriptions').select('user_id');
      const subUsers = new Set((subs || []).map((s: any) => s.user_id));
      userIds = [...activeUsers].filter(id => subUsers.has(id));
    } else if (segment === 'inactive_30d') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: subs } = await supabase.from('push_subscriptions').select('user_id');
      const allSubUsers = [...new Set((subs || []).map((s: any) => s.user_id))];
      const { data: recentOrders } = await supabase.from('orders').select('user_id').gte('created_at', thirtyDaysAgo);
      const { data: recentTickets } = await supabase.from('tickets').select('user_id').gte('created_at', thirtyDaysAgo);
      const activeSet = new Set([
        ...(recentOrders || []).map((d: any) => d.user_id),
        ...(recentTickets || []).map((d: any) => d.user_id),
      ]);
      userIds = allSubUsers.filter(id => !activeSet.has(id));
    } else if (segment === 'ticket_holders') {
      const { data } = await supabase.from('tickets').select('user_id').eq('status', 'paid');
      const ticketUsers = new Set((data || []).map((d: any) => d.user_id));
      const { data: subs } = await supabase.from('push_subscriptions').select('user_id');
      const subUsers = new Set((subs || []).map((s: any) => s.user_id));
      userIds = [...ticketUsers].filter(id => subUsers.has(id));
    } else if (segment === 'vip') {
      const { data } = await supabase.from('table_reservations').select('user_id').eq('status', 'paid');
      const vipUsers = new Set((data || []).map((d: any) => d.user_id));
      const { data: subs } = await supabase.from('push_subscriptions').select('user_id');
      const subUsers = new Set((subs || []).map((s: any) => s.user_id));
      userIds = [...vipUsers].filter(id => subUsers.has(id));
    } else if (segment === 'loyal') {
      const { data } = await supabase.from('customer_loyalty').select('user_id').in('tier', ['silver', 'gold', 'platinum']);
      const loyalUsers = new Set((data || []).map((d: any) => d.user_id));
      const { data: subs } = await supabase.from('push_subscriptions').select('user_id');
      const subUsers = new Set((subs || []).map((s: any) => s.user_id));
      userIds = [...loyalUsers].filter(id => subUsers.has(id));
    } else {
      const { data } = await supabase.from('push_subscriptions').select('user_id');
      userIds = [...new Set((data || []).map((d: any) => d.user_id))];
    }

    console.log(`[CAMPAIGN] Segment: ${segment}, users: ${userIds.length}`);

    let sentCount = 0;
    const pushUrl = `${supabaseUrl}/functions/v1/send-push-notification`;

    // Send in batches of 10
    for (let i = 0; i < userIds.length; i += 10) {
      const batch = userIds.slice(i, i + 10);
      const promises = batch.map(userId =>
        fetch(pushUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify({
            user_id: userId,
            payload: { title, body, url: url || '/' }
          })
        }).then(async r => {
          const d = await r.json().catch(() => ({}));
          return d.sent || 0;
        }).catch(() => 0)
      );
      const results = await Promise.all(promises);
      sentCount += results.reduce((a, b) => a + b, 0);
    }

    // Log campaign
    await supabase.from('push_campaigns').insert({
      title, body, url: url || '/', segment,
      sent_count: sentCount,
      created_by: user.id,
    });

    // Log each notification for anti-spam
    for (const userId of userIds) {
      await supabase.from('notification_log').insert({
        user_id: userId,
        notification_type: 'campaign',
        title,
      });
    }

    return new Response(JSON.stringify({ success: true, sent: sentCount, total: userIds.length }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error';
    console.error('[CAMPAIGN] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
