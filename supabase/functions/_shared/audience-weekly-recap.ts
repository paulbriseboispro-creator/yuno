import { sendAutoPush } from "./auto-push.ts";

// Récap hebdo poussé aux owners (audience 'pro') : « +142 abonnés, 2 push, 2 400€ ».
// L'habitude qui donne une raison de faire plus d'events. Une fois par semaine et par
// club, le lundi matin (UTC). Dédup RACE-SAFE via audience_recap_log (PK subject+semaine)
// : on RÉCLAME la ligne avant d'envoyer, donc deux crons de la fenêtre n'envoient pas
// deux fois. Drainé par process-scheduled-campaigns (cap edge 402 → pas de fonction dédiée).
// admin: any — même convention que les autres dispatchers (évite le skew de version
// SupabaseClient entre le createClient de l'appelant et les modules _shared).
// deno-lint-ignore no-explicit-any
export async function dispatchAudienceWeeklyRecaps(
  admin: any,
): Promise<{ processed: number; sent: number }> {
  const now = new Date();
  // Fenêtre : lundi (getUTCDay===1), 9h–12h UTC. Le dédup garantit un envoi unique.
  if (now.getUTCDay() !== 1 || now.getUTCHours() < 9 || now.getUTCHours() >= 12) {
    return { processed: 0, sent: 0 };
  }
  // Lundi 00:00 de la semaine courante = clé de dédup.
  const monday = new Date(now);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10);

  const { data: venues } = await admin
    .from("venues").select("id, owner_id").not("owner_id", "is", null);
  if (!venues?.length) return { processed: 0, sent: 0 };

  let processed = 0;
  let sent = 0;
  for (const v of venues as { id: string; owner_id: string }[]) {
    try {
      // Réclame la semaine AVANT d'envoyer (la PK rend l'insert atomique : le 2e perd).
      const { error: claimErr } = await admin
        .from("audience_recap_log")
        .insert({ subject_type: "venue", subject_id: v.id, week_start: weekStart });
      if (claimErr) continue; // déjà fait cette semaine (ou course perdue)

      const { data: recap } = await admin.rpc("audience_weekly_recap_data", {
        p_subject_type: "venue", p_subject_id: v.id,
      });
      const r = recap as { ok?: boolean; followers_net?: number; pushes?: number; revenue_net?: number } | null;
      if (!r?.ok) continue;

      const followers = Number(r.followers_net || 0);
      const pushes = Number(r.pushes || 0);
      const revenue = Number(r.revenue_net || 0);
      // Rien à raconter cette semaine → pas de récap vide (déjà réclamé, pas de retry).
      if (followers <= 0 && revenue <= 0 && pushes <= 0) continue;

      processed++;
      const res = await sendAutoPush(admin, {
        key: "audience_weekly_recap",
        userId: v.owner_id,
        url: "/owner/audience",
        vars: {
          followers: String(Math.max(0, followers)),
          pushes: String(pushes),
          revenue: `${Math.round(revenue).toLocaleString("fr-FR")} €`,
        },
      });
      sent += res.sent;
    } catch (e) {
      console.error(`[WEEKLY-RECAP] venue ${v.id} failed:`, String(e));
    }
  }
  return { processed, sent };
}
