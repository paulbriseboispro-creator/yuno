import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    let bodyAction: string | null = null;
    let token: string | null = null;
    let bodyCampaignId: string | null = null;
    if (req.method === 'GET') {
      token = url.searchParams.get('token');
    } else {
      const body = await req.json().catch(() => ({}));
      token = body.token || url.searchParams.get('token');
      if (typeof body.action === 'string') bodyAction = body.action;
      if (typeof body.campaign_id === 'string') bodyCampaignId = body.campaign_id;
    }
    const action = url.searchParams.get('action') || bodyAction || (req.method === 'POST' ? 'unsubscribe' : 'preview');
    // Optional explicit campaign attribution (link can carry ?c=<id>); falls back to the
    // most recent campaign that emailed this subscriber.
    const explicitCampaignId = bodyCampaignId || url.searchParams.get('c');
    if (!token) return new Response(JSON.stringify({ error: 'token required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    if (action === 'preview') {
      const { data, error } = await admin.rpc('preview_unsubscribe', { p_token: token });
      if (error) throw error;
      const row = (data as any[])?.[0];
      if (!row) return new Response(JSON.stringify({ found: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ found: true, ...row }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Capture prior opt-in state so we only count a genuine opt-in → opt-out
    // transition (repeat clicks / List-Unsubscribe retries must not double-count).
    const { data: subBefore } = await admin
      .from('newsletter_subscriptions')
      .select('opted_in')
      .eq('unsubscribe_token', token)
      .maybeSingle();
    const wasOptedIn = subBefore?.opted_in === true;

    const { data, error } = await admin.rpc('unsubscribe_by_token', { p_token: token });
    if (error) throw error;
    const row = (data as any[])?.[0];

    // Attribute the unsubscribe to a campaign and bump its counter.
    if (row?.success && wasOptedIn) {
      let campaignId: string | null = explicitCampaignId;
      if (!campaignId) {
        // No explicit id on the link → credit the most recent campaign that emailed
        // this subscriber (the one they almost certainly just clicked from).
        const { data: rec } = await admin
          .from('email_campaign_recipients')
          .select('campaign_id')
          .eq('unsubscribe_token', token)
          .order('sent_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        campaignId = rec?.campaign_id || null;
      }
      if (campaignId) {
        const { data: c } = await admin
          .from('email_campaigns').select('unsubscribes_count').eq('id', campaignId).maybeSingle();
        await admin.from('email_campaigns')
          .update({ unsubscribes_count: (c?.unsubscribes_count || 0) + 1 })
          .eq('id', campaignId);
      }
    }

    return new Response(JSON.stringify(row || { success: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
