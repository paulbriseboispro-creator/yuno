import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { authorizeCronRequest } from "../_shared/cron-auth.ts";
import { dispatchPushAutomations } from "../_shared/push-automations.ts";
import { refreshEventEmbeddings } from "../_shared/event-embeddings.ts";
import { dispatchLiveOpsAlerts } from "../_shared/live-ops-alerts.ts";
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

    // Campagnes PUSH planifiées (admin + clubs) — même mécanique que l'email :
    // marquer 'sending' (anti double-fire) puis déléguer à send-push-campaign.
    let pushProcessed = 0;
    const { data: pushCampaigns } = await admin
      .from('push_campaigns')
      .select('id')
      .eq('status', 'scheduled')
      .lte('scheduled_at', new Date().toISOString())
      .limit(20);

    for (const c of pushCampaigns || []) {
      try {
        await admin.from('push_campaigns').update({ status: 'sending' }).eq('id', c.id).eq('status', 'scheduled');
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push-campaign`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'apikey': SERVICE_KEY,
          },
          body: JSON.stringify({ campaign_id: c.id }),
        });
        if (!res.ok) {
          await admin.from('push_campaigns').update({ status: 'failed' }).eq('id', c.id);
        }
        pushProcessed++;
      } catch (_e) {
        await admin.from('push_campaigns').update({ status: 'failed' }).eq('id', c.id);
      }
    }

    // Notifications push AUTOMATIQUES (cycle de vie des soirées) — activées par
    // les clubs, envoyées au bon moment. Best-effort : un échec ici ne casse
    // pas le traitement des campagnes planifiées ci-dessus.
    let autoPush = { processed: 0, sent: 0 };
    try {
      autoPush = await dispatchPushAutomations(admin, SUPABASE_URL, SERVICE_KEY);
    } catch (e) {
      console.error('[AUTO-PUSH] dispatch failed:', String(e));
    }

    // Embeddings des events (fondation des recos « Pour toi ») — best-effort,
    // ne touche que les events créés/modifiés depuis le dernier run.
    let embeddings = { scanned: 0, updated: 0 };
    try {
      const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
      if (OPENAI_API_KEY) {
        embeddings = await refreshEventEmbeddings(admin, OPENAI_API_KEY);
      }
    } catch (e) {
      console.error('[EMBEDDINGS] refresh failed:', String(e));
    }

    // Alertes live ops du centre de commandement (events actifs uniquement) —
    // best-effort : persiste en staff_notifications, push owner sur les urgentes.
    let liveOps = { events: 0, alerts: 0, pushed: 0 };
    try {
      liveOps = await dispatchLiveOpsAlerts(admin, SUPABASE_URL, SERVICE_KEY);
    } catch (e) {
      console.error('[LIVE-OPS] dispatch failed:', String(e));
    }

    return new Response(JSON.stringify({ processed, pushProcessed, autoPush, embeddings, liveOps }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
