import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { authorizeCronRequest } from "../_shared/cron-auth.ts";
import { sendAutoPush, isAutoPushEnabled } from "../_shared/auto-push.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Yuno Taste Engine — moteur d'envoi ADAPTATIF (cron horaire) ─────────────
// À chaque heure, on ne traite que les users dont user_send_profiles dit que
// c'est LEUR moment de pointe (jour + heure, calculés par histogramme dans
// refresh_user_send_profiles). Cadence par user (adaptée à l'engagement), reco
// via le cerveau unique (get_taste_events_for_user = quiz ⊕ comportement), et
// rotation des 8 variantes de copie. Zéro lundi/jeudi fixe.
//
// Body optionnel {test_user_id} : force l'envoi à UN user (ignore fenêtre +
// cadence) pour tester sur device.

const VARIANTS = ['genres_led', 'event_led', 'city_led', 'curated', 'fomo', 'direct', 'agenda', 'profile'];

/** dow (0=dim … 6=sam, convention Postgres extract(dow)) + hour, heure de Paris. */
function parisNow(): { dow: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Thu';
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '18';
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = parseInt(hourStr, 10);
  if (hour === 24) hour = 0; // certains runtimes rendent minuit en 24
  return { dow: dowMap[wd] ?? 4, hour };
}

function pickVariant(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h + userId.charCodeAt(i)) | 0;
  const day = Math.floor(Date.now() / 86400000);
  return VARIANTS[Math.abs(h + day) % VARIANTS.length];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const _cronAuth = await authorizeCronRequest(req);
  if (!_cronAuth.ok) {
    return new Response(JSON.stringify({ error: _cronAuth.message }),
      { status: _cronAuth.status, headers: { 'Content-Type': 'application/json' } });
  }
  const json = (p: unknown, s = 200) =>
    new Response(JSON.stringify(p), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (!(await isAutoPushEnabled(supabase, 'taste_discovery'))) {
      return json({ success: true, sent: 0, skipped: 'disabled' });
    }

    let testUserId: string | undefined;
    try { testUserId = (await req.json())?.test_user_id; } catch { /* pas de body */ }

    const now = new Date();
    const { dow, hour } = parisNow();

    // Cibles : soit le user de test, soit ceux dont c'est le moment de pointe.
    let targets: { user_id: string; cadence_days: number; last_sent_at: string | null }[];
    if (testUserId) {
      targets = [{ user_id: testUserId, cadence_days: 0, last_sent_at: null }];
    } else {
      const { data } = await supabase
        .from('user_send_profiles')
        .select('user_id, cadence_days, last_sent_at')
        .eq('preferred_dow', dow)
        .eq('preferred_hour', hour);
      targets = data ?? [];
    }
    if (!targets.length) return json({ success: true, dow, hour, targets: 0, sent: 0 });

    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    let sent = 0;
    let considered = 0;

    for (const t of targets) {
      // Cadence adaptative (sauf en test).
      if (!testUserId && t.last_sent_at) {
        const elapsedDays = (now.getTime() - new Date(t.last_sent_at).getTime()) / 86400000;
        if (elapsedDays < (t.cadence_days || 12)) continue;
      }
      considered++;

      // Cap global : 3 non-transactionnelles / jour.
      if (!testUserId) {
        const { data: today } = await supabase
          .from('notification_log').select('id')
          .eq('user_id', t.user_id).in('notification_type', ['marketing', 'campaign', 'reminder'])
          .gte('sent_at', dayAgo);
        if ((today?.length || 0) >= 3) continue;
      }

      // Reco du cerveau unique (gère aussi l'opt-out découverte → renvoie vide).
      const { data: events, error: rpcErr } = await supabase
        .rpc('get_taste_events_for_user', { p_user_id: t.user_id, p_limit: 3, p_days: 21 });
      if (rpcErr) { console.error('[TASTE] rpc error:', rpcErr.message); continue; }
      const list = (events || []) as {
        event_id: string; title: string; venue_id: string | null;
        city: string | null; slug: string | null; music_genres: string[] | null;
      }[];
      if (list.length < 2) continue; // on ne pousse que sur une vraie sélection (grammaire + valeur)

      // Genres agrégés (dédup, top 2) : « House, Open Format ».
      const genreSet: string[] = [];
      for (const ev of list) for (const g of (ev.music_genres || [])) if (g && !genreSet.includes(g)) genreSet.push(g);
      const genres = genreSet.slice(0, 2).join(', ');
      const top = list[0];
      const url = top.slug && top.venue_id ? `/events/${top.venue_id}/${top.slug}` : `/event/${top.event_id}`;

      try {
        const res = await sendAutoPush(supabase, {
          key: 'taste_discovery',
          variant: pickVariant(t.user_id),
          userId: t.user_id,
          url,
          vars: {
            count: String(list.length),
            genres: genres || 'nightlife',
            event: top.title || '',
            city: top.city || '',
          },
        });
        if (res.sent > 0) {
          sent++;
          // Dédup : ne plus repousser ces soirées à ce user.
          await supabase.from('discovery_event_notifications').upsert(
            list.map((ev) => ({ user_id: t.user_id, event_id: ev.event_id })),
            { onConflict: 'user_id,event_id', ignoreDuplicates: true },
          );
          // Cadence : on repart de maintenant.
          await supabase.from('user_send_profiles')
            .update({ last_sent_at: now.toISOString() })
            .eq('user_id', t.user_id);
        }
      } catch (e) { console.error('[TASTE] send error:', e); }
    }

    console.log(`[TASTE-ENGINE] paris dow=${dow} h=${hour} targets=${targets.length} considered=${considered} sent=${sent}`);
    return json({ success: true, dow, hour, targets: targets.length, considered, sent });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
