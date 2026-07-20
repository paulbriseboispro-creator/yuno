import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

import { authorizeCronRequest } from "../_shared/cron-auth.ts";
import { dispatchPushAutomations, dispatchNewEventPushes } from "../_shared/push-automations.ts";
import { refreshEventEmbeddings, refreshDjEmbeddings } from "../_shared/event-embeddings.ts";
import { dispatchLiveOpsAlerts } from "../_shared/live-ops-alerts.ts";
import { dispatchPromoterPushes } from "../_shared/promoter-push.ts";
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

    // Nouvel événement publié → push aux followers du club + de l'organisateur.
    // Gated par le registre super admin (clé 'new_event'). Best-effort.
    let newEventPush = { processed: 0, sent: 0 };
    try {
      newEventPush = await dispatchNewEventPushes(admin, SUPABASE_URL, SERVICE_KEY);
    } catch (e) {
      console.error('[NEW-EVENT-PUSH] dispatch failed:', String(e));
    }

    // Embeddings — events (recos « Pour toi ») et profils DJ (matching DJ↔soirée).
    // Best-effort, ne touchent que ce qui a été créé/modifié depuis le dernier run.
    let embeddings = { scanned: 0, updated: 0 };
    let djEmbeddings = { scanned: 0, updated: 0 };
    try {
      const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
      if (OPENAI_API_KEY) {
        embeddings = await refreshEventEmbeddings(admin, OPENAI_API_KEY);
        djEmbeddings = await refreshDjEmbeddings(admin, OPENAI_API_KEY);
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

    // File de notifications promoteur (app Yuno Pro) — alimentee par des
    // triggers, vidangee ici. La coalescence a deja eu lieu a l'insertion, donc
    // un samedi a 50 ventes ne produit pas 50 push. Best-effort : une panne
    // d'envoi laisse les lignes en file pour le prochain passage.
    let promoterPush = { processed: 0, sent: 0 };
    try {
      promoterPush = await dispatchPromoterPushes(admin);
    } catch (e) {
      console.error('[PROMOTER-PUSH] dispatch failed:', String(e));
    }

    return new Response(JSON.stringify({ processed, pushProcessed, autoPush, newEventPush, embeddings, djEmbeddings, liveOps, promoterPush }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
