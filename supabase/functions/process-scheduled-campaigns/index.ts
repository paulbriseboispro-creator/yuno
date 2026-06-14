import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { authorizeCronRequest } from "../_shared/cron-auth.ts";
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
    // SECURITY: scheduled function — require shared cron secret or super-admin JWT
    const _cronAuth = await authorizeCronRequest(req);
    if (!_cronAuth.ok) {
      return new Response(
        JSON.stringify({ error: _cronAuth.message }),
        { status: _cronAuth.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: campaigns } = await admin
      .from('email_campaigns')
      .select('id')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString())
      .limit(20);

    let processed = 0;
    for (const c of campaigns || []) {
      try {
        // Mark as sending to avoid double-fire
        await admin.from('email_campaigns').update({ status: 'sending' }).eq('id', c.id).eq('status', 'scheduled');
        // Invoke send-campaign with service role
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-campaign`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'apikey': SERVICE_KEY,
          },
          body: JSON.stringify({ campaign_id: c.id, scheduled: true }),
        });
        if (!res.ok) {
          await admin.from('email_campaigns').update({ status: 'failed', error_message: `Cron send failed: ${res.status}` }).eq('id', c.id);
        }
        processed++;
      } catch (e) {
        await admin.from('email_campaigns').update({ status: 'failed', error_message: String(e) }).eq('id', c.id);
      }
    }
    return new Response(JSON.stringify({ processed }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
