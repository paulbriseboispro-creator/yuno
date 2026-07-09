// Notify staff/owner when a Top 100 customer is scanned at the door.
// Called from Bouncer.tsx after a successful entry scan.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { venue_id, organizer_user_id, user_id, full_name, event_id } = await req.json();

    if (!user_id || (!venue_id && !organizer_user_id)) {
      return new Response(JSON.stringify({ error: 'missing scope or user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Determine rank from client_scores (venue scope) — Top 100 only
    let rank: number | null = null;
    let tier: string = 'bronze';
    let totalSpent = 0;

    if (venue_id) {
      const { data: score } = await supabase
        .from('client_scores')
        .select('rank, total_score')
        .eq('venue_id', venue_id)
        .eq('user_id', user_id)
        .maybeSingle();
      rank = score?.rank ?? null;

      const { data: vc } = await supabase
        .from('venue_customers')
        .select('total_spent')
        .eq('venue_id', venue_id)
        .eq('user_id', user_id)
        .maybeSingle();
      totalSpent = Number(vc?.total_spent ?? 0);
      tier = totalSpent >= 1000 ? 'platinum' : totalSpent >= 500 ? 'gold' : totalSpent >= 200 ? 'silver' : 'bronze';
    }

    if (!rank || rank > 100) {
      return new Response(JSON.stringify({ skipped: true, rank }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find recipients: venue owner + venue staff (manager, vip_host)
    const recipients = new Set<string>();
    if (venue_id) {
      const { data: venue } = await supabase.from('venues').select('owner_id').eq('id', venue_id).maybeSingle();
      if (venue?.owner_id) recipients.add(venue.owner_id);

      const { data: staff } = await supabase
        .from('profiles')
        .select('id, user_roles!inner(role)')
        .eq('venue_id', venue_id)
        .in('user_roles.role', ['manager', 'vip_host']);
      staff?.forEach((s: any) => recipients.add(s.id));
    }
    if (organizer_user_id) recipients.add(organizer_user_id);

    if (recipients.size === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: 'no_recipients' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tierEmoji = tier === 'platinum' ? '💎' : tier === 'gold' ? '🥇' : tier === 'silver' ? '🥈' : '🥉';
    const title = `${tierEmoji} VIP Top ${rank} arrivé`;
    const body = `${full_name || 'Client VIP'} (${tier.toUpperCase()}) vient d'être scanné à l'entrée.`;

    // Trigger push notification per recipient via existing send-push-notification function.
    // Service-role bearer : le relay durci de send-push-notification exige
    // service-role OU un user à rôle privilégié — le bearer anon renvoyait 401.
    // Body au format attendu { user_id, payload } (title/body/url).
    const pushUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    await Promise.all(
      Array.from(recipients).map((uid) =>
        fetch(pushUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            user_id: uid,
            payload: { title, body, url: '/owner/live' },
          }),
        }).catch((e) => console.warn('push failed', uid, e))
      ),
    );

    // Persist to customer_activity_log for CRM timeline
    await supabase.from('customer_activity_log').insert({
      user_id,
      venue_id: venue_id ?? null,
      organizer_user_id: organizer_user_id ?? null,
      activity_type: 'vip_scan',
      metadata: { rank, tier, event_id, full_name },
    });

    return new Response(JSON.stringify({ ok: true, rank, tier, notified: recipients.size }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[notify-top-customer-scan]', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
