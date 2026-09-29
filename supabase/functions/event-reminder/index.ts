// Version ÉPINGLÉE, comme les helpers _shared (auto-push) et 59 autres
// fonctions : l'import flottant "@2" résolvait une version dont les types
// divergeaient de ceux de sendAutoPush, laissant ce fichier non vérifiable.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

import { authorizeCronRequest } from "../_shared/cron-auth.ts";
import { formatEventTime } from "../_shared/event-time.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rappels d'EXPLOITATION seulement (owner à T-30 min, staff à ~6 h). Les
// rappels CLIENTS (jour J, ouverture des portes) sont des règles du moteur de
// notifications (_shared/push-engine.ts, event_day_reminder / doors_open) :
// rattachés à la soirée, arbitrés, et visibles par le club et l'organisateur.

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

    // T-30min window: events starting between 15min and 45min from now
    const t30mStart = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    const t30mEnd = new Date(now.getTime() + 45 * 60 * 1000).toISOString();

    // T-6h window: soirées démarrant entre 5.5h et 6.5h. Le cron est horaire et
    // la fenêtre fait 1h → chaque soirée est captée une fois exactement. Sert au
    // rappel opérationnel du staff (app Pro).
    const t6hStart = new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString();
    const t6hEnd = new Date(now.getTime() + 6.5 * 60 * 60 * 1000).toISOString();

    const { data: events30m } = await supabase
      .from('events')
      .select('id, title, start_at, venue_id, timezone')
      .gte('start_at', t30mStart)
      .lte('start_at', t30mEnd)
      .eq('is_active', true);

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
          const startTime = formatEventTime(event.start_at, event.timezone);
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

    // ── Staff : « soirée dans ~6h » (app Pro) ────────────────────────────────
    // L'inverse d'une pub : un rappel d'EXPLOITATION à TOUT le staff du club
    // pour préparer le service. Le marketing (new_event) reste, lui, sur l'app
    // grand public. Passe par staff_notifications → trg_staff_notification_push
    // → push Pro (target_role 'all_staff', type 'event_prep_6h').
    const { data: events6h } = await supabase
      .from('events')
      .select('id, title, start_at, venue_id, timezone')
      .gte('start_at', t6hStart)
      .lte('start_at', t6hEnd)
      .eq('is_active', true)
      .is('cancelled_at', null);

    for (const event of events6h || []) {
      if (!event.venue_id) continue; // pas de staff sans club
      try {
        // Dédup : une seule fois par soirée. Verrou de sécurité en plus du
        // couple cron-horaire / fenêtre-1h (qui ne recroise déjà pas la soirée).
        const { count: alreadyFired } = await supabase
          .from('staff_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('venue_id', event.venue_id)
          .eq('notification_type', 'event_prep_6h')
          .eq('event_id', event.id)
          .gte('created_at', new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString());

        if ((alreadyFired ?? 0) === 0) {
          const startTime = formatEventTime(event.start_at, event.timezone);
          await supabase.from('staff_notifications').insert({
            venue_id: event.venue_id,
            target_role: 'all_staff',
            notification_type: 'event_prep_6h',
            title: `Ce soir dans ~6h — ${event.title}`,
            message: `"${event.title}" démarre à ${startTime}. Prépare ton poste.`,
            priority: 'high',
            reference_type: 'event',
            reference_id: event.id,
            event_id: event.id,
            metadata: { start_at: event.start_at, event_title: event.title, start_time: startTime },
          });
          console.log(`[EVENT-REMINDER] Staff event_prep_6h notif for ${event.id}`);
        }
      } catch (staffNotifErr) {
        console.error('[REMINDER] Staff event_prep_6h error:', staffNotifErr);
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error';
    console.error('[EVENT-REMINDER] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
