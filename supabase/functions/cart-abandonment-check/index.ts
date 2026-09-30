import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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

    // Panier BOISSONS seulement. Un checkout billet / table abandonné est une
    // règle du moteur de notifications (checkout_abandoned) : rattachée à la
    // soirée, retirée si la personne achète entre-temps, visible par le pro.
    // Kill switch plateforme (/admin/notifications, clé 'cart_abandonment_drinks').
    if (!(await isAutoPushEnabled(supabase, 'cart_abandonment_drinks'))) {
      return new Response(JSON.stringify({ success: true, sent: 0, skipped: 'disabled' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const now = new Date();
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

    const { data: cartSnapshots } = await supabase
      .from('cart_snapshots')
      .select('id, user_id')
      .is('notified_at', null)
      .eq('converted', false)
      .lte('updated_at', thirtyMinAgo)
      .gte('updated_at', twoHoursAgo);

    let sentCount = 0;
    const notifiedUsers = new Set<string>();

    for (const snapshot of cartSnapshots || []) {
      if (!snapshot.user_id || notifiedUsers.has(snapshot.user_id)) continue;
      notifiedUsers.add(snapshot.user_id);

      // Même porte anti-spam que toute notification client non transactionnelle
      // (opt-out marketing, heures calmes, plafonds du moteur, cooldown 3 j).
      const { data: policy } = await supabase.rpc('client_push_policy', {
        p_user_id: snapshot.user_id,
        p_key: 'cart_abandonment_drinks',
      });
      const verdict = Array.isArray(policy) ? policy[0] : policy;
      if (!verdict?.allowed) continue;

      try {
        const res = await sendAutoPush(supabase, {
          key: 'cart_abandonment_drinks',
          userId: snapshot.user_id,
          url: '/cart',
        });
        if (res.sent > 0) sentCount++;
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
