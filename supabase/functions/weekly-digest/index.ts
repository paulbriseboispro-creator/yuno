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
// refresh_user_send_profiles). Cadence par user (adaptée à l'engagement).
//
// Depuis le 2026-09-06, la sélection est HONNÊTE et ATTERRIT :
//   • get_taste_events_for_user() v2 ne renvoie que des soirées de la ZONE du
//     client (profil + achats + clubs suivis), d'un inventaire RÉEL (jamais un
//     club caché ou décommissionné), au-dessus d'un plancher de pertinence
//     (genre déclaré, lieu suivi, ou affinité nette). Les soirées partenaires
//     (affiliés) entrent par genre.
//   • client_push_policy() est la porte anti-spam unique : opt-out, heures
//     calmes (22 h → 10 h Paris), 1 non-transactionnelle / 24 h, 3 / 7 j,
//     cooldown par clé.
//   • Le push écrit une ligne discovery_selections et pointe sur
//     /for-you/<id> : le tap ouvre EXACTEMENT les soirées annoncées, pas le
//     feed. Le titre dit « {count} soirées » avec le vrai compte, et ne cite
//     un genre que s'il décrit réellement la sélection.
//
// Body optionnel {test_user_id} : force l'envoi à UN user (ignore fenêtre +
// cadence, MAIS pas la sélection ni la porte anti-spam — un test qui ment ne
// teste rien).

type TasteRow = {
  event_id: string;
  is_affiliate: boolean;
  title: string;
  venue_id: string | null;
  venue_name: string | null;
  city: string | null;
  start_at: string;
  slug: string | null;
  music_genres: string[] | null;
  score: number;
  reason: 'genre' | 'follow' | 'taste';
};

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

function hashDay(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h + userId.charCodeAt(i)) | 0;
  return Math.abs(h + Math.floor(Date.now() / 86400000));
}

/**
 * Genre DOMINANT d'une sélection : cité seulement s'il couvre la majorité des
 * soirées (sinon « 3 soirées House » mentirait sur deux d'entre elles).
 */
function dominantGenre(list: TasteRow[]): string | null {
  const counts = new Map<string, { n: number; label: string }>();
  for (const ev of list) {
    const seen = new Set<string>();
    for (const g of ev.music_genres || []) {
      const k = g.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const cur = counts.get(k) ?? { n: 0, label: g.trim() };
      cur.n++;
      counts.set(k, cur);
    }
  }
  let best: { n: number; label: string } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  if (!best) return null;
  return best.n * 2 >= list.length ? best.label : null;
}

// Variantes qui citent un genre vs celles qui n'en ont pas besoin.
const GENRE_VARIANTS = ['genres_led', 'city_led', 'curated', 'direct', 'agenda', 'profile'];
const PLAIN_VARIANTS = ['event_led', 'fomo'];

function pickVariant(userId: string, hasGenre: boolean, hasCity: boolean): string {
  let pool = hasGenre ? [...GENRE_VARIANTS, ...PLAIN_VARIANTS] : PLAIN_VARIANTS;
  if (!hasCity) pool = pool.filter((v) => v !== 'city_led');
  return pool[hashDay(userId) % pool.length];
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

    let sent = 0;
    let considered = 0;
    const skipped: Record<string, number> = {};
    const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1; };

    for (const t of targets) {
      // Cadence adaptative (sauf en test).
      if (!testUserId && t.last_sent_at) {
        const elapsedDays = (now.getTime() - new Date(t.last_sent_at).getTime()) / 86400000;
        if (elapsedDays < (t.cadence_days || 12)) { skip('cadence'); continue; }
      }
      considered++;

      // Porte anti-spam unique (opt-out, heures calmes, plafonds, cooldown).
      const { data: pol, error: polErr } = await supabase
        .rpc('client_push_policy', { p_user_id: t.user_id, p_key: 'taste_discovery' });
      const verdict = (Array.isArray(pol) ? pol[0] : pol) as { allowed: boolean; reason: string } | undefined;
      if (polErr) { console.error('[TASTE] policy error:', polErr.message); skip('policy_error'); continue; }
      if (!verdict?.allowed) { skip(verdict?.reason || 'policy'); continue; }

      // Sélection honnête (zone + inventaire réel + plancher de pertinence).
      const { data: events, error: rpcErr } = await supabase
        .rpc('get_taste_events_for_user', { p_user_id: t.user_id, p_limit: 3, p_days: 21 });
      if (rpcErr) { console.error('[TASTE] rpc error:', rpcErr.message); skip('rpc_error'); continue; }
      const list = (events || []) as TasteRow[];
      if (list.length < 2) { skip('too_few'); continue; } // une vraie sélection, pas une soirée isolée

      const genre = dominantGenre(list);
      const top = list[0];
      const city = list.find((e) => e.city)?.city || null;

      // La sélection exacte, persistée : c'est elle que le tap ouvre.
      const { data: sel, error: selErr } = await supabase
        .from('discovery_selections')
        .insert({
          user_id: t.user_id,
          notification_key: 'taste_discovery',
          event_ids: list.filter((e) => !e.is_affiliate).map((e) => e.event_id),
          affiliate_event_ids: list.filter((e) => e.is_affiliate).map((e) => e.event_id),
          city,
          genres: genre ? [genre] : [],
        })
        .select('id')
        .maybeSingle();
      if (selErr || !sel) { console.error('[TASTE] selection insert failed:', selErr?.message); skip('selection_error'); continue; }

      try {
        const res = await sendAutoPush(supabase, {
          key: 'taste_discovery',
          variant: pickVariant(t.user_id, !!genre, !!city),
          userId: t.user_id,
          url: `/for-you/${sel.id}`,
          vars: {
            count: String(list.length),
            genres: genre || '',
            event: top.title || '',
            city: city || '',
          },
        });
        if (res.sent > 0) {
          sent++;
          // Dédup : ne plus repousser ces soirées à ce user.
          const { error: dedupErr } = await supabase.from('discovery_event_notifications').upsert(
            list.map((ev) => ({ user_id: t.user_id, event_id: ev.event_id })),
            { onConflict: 'user_id,event_id', ignoreDuplicates: true },
          );
          if (dedupErr) console.error('[TASTE] dedup upsert failed:', dedupErr.message);
          // Cadence : on repart de maintenant.
          await supabase.from('user_send_profiles')
            .update({ last_sent_at: now.toISOString() })
            .eq('user_id', t.user_id);
        } else {
          // Personne au bout du token : la sélection ne sert à rien.
          await supabase.from('discovery_selections').delete().eq('id', sel.id);
          skip('no_device');
        }
      } catch (e) { console.error('[TASTE] send error:', e); skip('send_error'); }
    }

    console.log(`[TASTE-ENGINE] paris dow=${dow} h=${hour} targets=${targets.length} considered=${considered} sent=${sent} skipped=${JSON.stringify(skipped)}`);
    return json({ success: true, dow, hour, targets: targets.length, considered, sent, skipped });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
