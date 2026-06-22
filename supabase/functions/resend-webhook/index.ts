import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET'); // Svix secret from Resend dashboard (whsec_...)

// Verify the Svix signature Resend sends on every webhook. Returns true when the
// payload is authentic. If no secret is configured we fail OPEN (log a warning and
// accept) so existing open/click tracking keeps working until the secret is set —
// set RESEND_WEBHOOK_SECRET to enforce strict verification.
async function verifySvix(rawBody: string, headers: Headers): Promise<boolean> {
  if (!WEBHOOK_SECRET) {
    console.warn('resend-webhook: RESEND_WEBHOOK_SECRET not set — accepting unverified payload');
    return true;
  }
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const sigHeader = headers.get('svix-signature');
  if (!id || !timestamp || !sigHeader) return false;

  // Reject stale timestamps (>5 min skew) to blunt replay.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  try {
    const secretBytes = Uint8Array.from(atob(WEBHOOK_SECRET.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signed = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`);
    const mac = await crypto.subtle.sign('HMAC', key, signed);
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    // Header is space-separated "v1,<sig> v1,<sig>" — accept if any matches.
    return sigHeader.split(' ').some((part) => part.split(',')[1] === expected);
  } catch (e) {
    console.error('resend-webhook: signature verification error', e);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const rawBody = await req.text();
    if (!(await verifySvix(rawBody, req.headers))) {
      return new Response(JSON.stringify({ error: 'invalid signature' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const payload = JSON.parse(rawBody);
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
