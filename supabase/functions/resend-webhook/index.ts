import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const payload = await req.json();
    const eventType: string = payload.type || '';
    const data = payload.data || {};
    const tags: Array<{ name: string; value: string }> = data.tags || [];
    const campaignId = tags.find((t) => t.name === 'campaign_id')?.value;
    const recipient = Array.isArray(data.to) ? data.to[0] : data.to;
    const resendEmailId = data.email_id || data.id;

    if (!campaignId) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const map: Record<string, string> = {
      'email.delivered': 'delivered',
      'email.opened': 'opened',
      'email.clicked': 'clicked',
      'email.bounced': 'bounced',
      'email.complained': 'complained',
    };
    const evt = map[eventType];
    if (!evt) return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    await admin.from('email_campaign_events').insert({
      campaign_id: campaignId,
      recipient_email: recipient || 'unknown',
      event_type: evt,
      resend_email_id: resendEmailId,
      metadata: data,
    });

    // Increment counters (only count first opened per email)
    if (evt === 'opened') {
      const { count } = await admin
        .from('email_campaign_events')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('event_type', 'opened')
        .eq('recipient_email', recipient);
      if (count === 1) {
        const { data: c } = await admin.from('email_campaigns').select('opens_count').eq('id', campaignId).single();
        await admin.from('email_campaigns').update({ opens_count: (c?.opens_count || 0) + 1 }).eq('id', campaignId);
      }
    } else if (evt === 'clicked') {
      const { data: c } = await admin.from('email_campaigns').select('clicks_count').eq('id', campaignId).single();
      await admin.from('email_campaigns').update({ clicks_count: (c?.clicks_count || 0) + 1 }).eq('id', campaignId);
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('resend-webhook error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
