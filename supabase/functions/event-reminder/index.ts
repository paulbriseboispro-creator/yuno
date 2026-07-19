import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const now = new Date();

    // T-4h window: events starting between 3.5h and 4.5h from now
    const t4hStart = new Date(now.getTime() + 3.5 * 60 * 60 * 1000).toISOString();
    const t4hEnd = new Date(now.getTime() + 4.5 * 60 * 60 * 1000).toISOString();

    // T-30min window: events starting between 15min and 45min from now
    const t30mStart = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    const t30mEnd = new Date(now.getTime() + 45 * 60 * 1000).toISOString();

    let totalSent = 0;

    // Kill switches plateforme (/admin/notifications) — lus une fois par run.
    const reminder4hEnabled = await isAutoPushEnabled(supabase, 'event_reminder_4h');
    const reminder30mEnabled = await isAutoPushEnabled(supabase, 'event_reminder_30m');

    // --- T-4h Reminders ---
    const { data: events4h } = await supabase
      .from('events')
      .select('id, title, start_at, venue_id')
      .gte('start_at', t4hStart)
      .lte('start_at', t4hEnd)
      .eq('is_active', true);

    for (const event of reminder4hEnabled ? (events4h || []) : []) {
      // Get ticket holders for this event
      const { data: tickets } = await supabase
        .from('tickets')
        .select('user_id')
        .eq('event_id', event.id)
        .eq('status', 'paid');

      const userIds = [...new Set((tickets || []).map(t => t.user_id).filter(Boolean))];

      const startTime = new Date(event.start_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

      for (const userId of userIds) {
        // Anti-spam: check if already notified for this event
        const { data: existing } = await supabase
          .from('notification_log')
          .select('id')
          .eq('user_id', userId)
          .eq('notification_type', 'reminder')
          .gte('sent_at', new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (existing && existing.length > 0) continue;

        // Registre auto (clé 'event_reminder_4h') : langue du client + tracking
        // ?an=. Le helper journalise aussi notification_log type 'reminder'
        // (même sémantique anti-spam que l'insert manuel qu'il remplace).
        try {
          const res = await sendAutoPush(supabase, {
            key: 'event_reminder_4h',
            userId,
            url: `/club/venue/event/${event.id}`,
            vars: { event: event.title || '', time: startTime },
          });
          if (res.sent > 0) totalSent++;
        } catch (e) { console.error('[REMINDER] T-4h error:', e); }
      }
    }

    // --- T-30min Reminders ---
    const { data: events30m } = await supabase
      .from('events')
      .select('id, title, start_at, venue_id')
      .gte('start_at', t30mStart)
      .lte('start_at', t30mEnd)
      .eq('is_active', true);

    for (const event of reminder30mEnabled ? (events30m || []) : []) {
      const { data: tickets } = await supabase
        .from('tickets')
        .select('user_id')
        .eq('event_id', event.id)
        .eq('status', 'paid');

      const userIds = [...new Set((tickets || []).map(t => t.user_id).filter(Boolean))];

      for (const userId of userIds) {
        // Check if T-30min already sent
        const { data: existing } = await supabase
          .from('notification_log')
          .select('id')
          .eq('user_id', userId)
          .eq('notification_type', 'reminder')
          .gte('sent_at', new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (existing && existing.length > 0) continue;

        // Registre auto (clé 'event_reminder_30m') : langue + tracking ?an=.
        try {
          const res = await sendAutoPush(supabase, {
            key: 'event_reminder_30m',
            userId,
            url: `/my-orders?tab=tickets`,
            vars: { event: event.title || '' },
          });
          if (res.sent > 0) totalSent++;
        } catch (e) { console.error('[REMINDER] T-30m error:', e); }
      }
    }

    // ── Owner notifications: event starting (T-30min) ────────────────────
    // Fire once per event — dedup by checking staff_notifications in last 2h
    for (const event of events30m || []) {
      if (!event.venue_id) continue;
      try {
        const { count: alreadyFired } = await supabase
          .from('staff_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('venue_id', event.venue_id)
          .eq('notification_type', 'event_starting')
          .eq('event_id', event.id)
          .gte('created_at', new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString());

        if ((alreadyFired ?? 0) === 0) {
          const startTime = new Date(event.start_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          await supabase.from('staff_notifications').insert({
            venue_id: event.venue_id,
            target_role: 'owner',
            notification_type: 'event_starting',
            title: `Soirée dans 30 min — ${event.title}`,
            message: `"${event.title}" démarre à ${startTime}. Préparez l'équipe.`,
            priority: 'urgent',
            reference_type: 'event',
            reference_id: event.id,
            event_id: event.id,
            metadata: { start_at: event.start_at, event_title: event.title },
          });
          console.log(`[EVENT-REMINDER] Owner event_starting notif for ${event.id}`);
        }
      } catch (ownerNotifErr) {
        console.error('[REMINDER] Owner event_starting error:', ownerNotifErr);
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    console.log(`[EVENT-REMINDER] Sent ${totalSent} reminders`);

    return new Response(JSON.stringify({ success: true, sent: totalSent }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error';
    console.error('[EVENT-REMINDER] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
