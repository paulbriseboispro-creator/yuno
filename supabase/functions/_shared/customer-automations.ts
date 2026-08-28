// Automations CRM user-scopées (win_back, birthday) — le pendant « client »
// des automatisations de soirée de push-automations.ts.
//
// Pas de soirée porteuse ⇒ pas de verrou (event_id, template_key) : la dédup
// est PAR UTILISATEUR, en deux couches côté base + une côté dispatcher :
//   1. get_due_customer_automation_targets() ne renvoie que les clients hors
//      cooldown (ledger venue_automation_sends), LIMIT 500 par famille ;
//   2. try_claim_customer_automation() pose le claim ATOMIQUE (deux runs de
//      cron concurrents ne peuvent pas gagner tous les deux) ;
//   3. le cap global 3 push non transactionnels / 24 h (notification_log),
//      même sonde que inactivity-reminder / weekly-digest.
// Le kill-switch plateforme (platform_notification_settings) reste au-dessus
// de tout : une clé coupée par le super admin ne part plus.
//
// Appelé par process-scheduled-campaigns (cron */5 min) — jamais en direct.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { disabledKeySet, fanoutCampaign, render, subscriberSet } from "./push-automations.ts";

type Lang = "fr" | "en" | "es";
type LocalizedText = { title: string; body: string };

const TEMPLATES: Record<string, Record<Lang, LocalizedText>> = {
  win_back: {
    fr: { title: "On ne t'a pas vu depuis un moment 👀", body: "{venue} — la nuit n'est pas pareille sans toi. Regarde ce qui arrive." },
    en: { title: "We haven't seen you in a while 👀", body: "{venue} — the night isn't the same without you. See what's coming up." },
    es: { title: "Hace tiempo que no te vemos 👀", body: "{venue} — la noche no es igual sin ti. Mira lo que viene." },
  },
  birthday: {
    fr: { title: "🎂 Joyeux anniversaire !", body: "{venue} te souhaite une année de folie. Viens la commencer avec nous ce week-end." },
    en: { title: "🎂 Happy birthday!", body: "{venue} wishes you a wild year. Come start it with us this weekend." },
    es: { title: "🎂 ¡Feliz cumpleaños!", body: "{venue} te desea un año increíble. Ven a empezarlo con nosotros este finde." },
  },
};

// Cooldowns du claim (jours) — alignés sur les fenêtres du NOT EXISTS de la RPC.
const COOLDOWN_DAYS: Record<string, number> = { win_back: 90, birthday: 300 };

type DueTarget = {
  venue_id: string;
  venue_name: string;
  automation_key: string;
  user_id: string;
  first_name: string | null;
  params: Record<string, unknown> | null;
};

/** user_ids ayant encore de la marge sous le cap 3 push non transactionnels / 24 h. */
async function underDailyCap(admin: SupabaseClient, userIds: string[]): Promise<Set<string>> {
  const counts = new Map<string, number>();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  for (let i = 0; i < userIds.length; i += 500) {
    const { data } = await admin
      .from("notification_log")
      .select("user_id")
      .in("user_id", userIds.slice(i, i + 500))
      .in("notification_type", ["marketing", "campaign", "reminder"])
      .gte("sent_at", dayAgo);
    (data || []).forEach((row: { user_id: string }) => {
      counts.set(row.user_id, (counts.get(row.user_id) || 0) + 1);
    });
  }
  return new Set(userIds.filter((id) => (counts.get(id) || 0) < 3));
}

export async function dispatchCustomerAutomations(
  admin: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ processed: number; sent: number }> {
  const { data: due, error } = await admin.rpc("get_due_customer_automation_targets");
  if (error) {
    console.error("[CUSTOMER-AUTO] get_due_customer_automation_targets failed:", error.message);
    return { processed: 0, sent: 0 };
  }

  const targets = (due || []) as DueTarget[];
  if (targets.length === 0) return { processed: 0, sent: 0 };

  const disabled = await disabledKeySet(admin);
  const subscribers = await subscriberSet(admin);
  const pushUrl = `${supabaseUrl}/functions/v1/send-push-notification`;

  // Groupement par (club, automation) → une campagne AUTO par groupe et par run.
  const groups = new Map<string, { venueId: string; venueName: string; key: string; users: string[] }>();
  for (const row of targets) {
    if (disabled.has(row.automation_key)) continue;
    if (!TEMPLATES[row.automation_key]) continue;
    if (!subscribers.has(row.user_id)) continue; // pas d'app iOS = pas de push
    const gk = `${row.venue_id}::${row.automation_key}`;
    let g = groups.get(gk);
    if (!g) { g = { venueId: row.venue_id, venueName: row.venue_name, key: row.automation_key, users: [] }; groups.set(gk, g); }
    g.users.push(row.user_id);
  }

  let processed = 0;
  let totalSent = 0;

  for (const g of groups.values()) {
    try {
      // Cap quotidien d'abord (sans consommer le claim), puis claim atomique.
      const capped = await underDailyCap(admin, g.users);
      const claimed: string[] = [];
      for (const uid of g.users) {
        if (!capped.has(uid)) continue;
        const { data: won } = await admin.rpc("try_claim_customer_automation", {
          p_venue_id: g.venueId,
          p_key: g.key,
          p_user_id: uid,
          p_cooldown_days: COOLDOWN_DAYS[g.key] ?? 90,
        });
        if (won === true) claimed.push(uid);
      }
      if (claimed.length === 0) continue;

      const tpl = TEMPLATES[g.key];
      const vars = { venue: g.venueName || "" };
      const targetUrl = `/club/${g.venueId}`;

      // Campagne AUTO sans event_id : le ledger par user est la vraie dédup —
      // plusieurs petites campagnes du même type peuvent coexister dans
      // l'historique (volume borné par LIMIT 500 + cooldowns).
      const { data: inserted, error: insErr } = await admin
        .from("push_campaigns")
        .insert({
          title: render(tpl.fr.title, vars),
          body: render(tpl.fr.body, vars),
          url: targetUrl,
          segment: g.key,
          venue_id: g.venueId,
          event_id: null,
          template_key: g.key,
          source: "auto",
          status: "sending",
          audience: { scope: g.key },
          targeted_count: 0,
          sent_count: 0,
        })
        .select("id")
        .maybeSingle();
      if (insErr || !inserted) continue;

      const sent = await fanoutCampaign(
        admin, pushUrl, serviceKey, inserted.id as string, claimed, targetUrl,
        (lang) => ({
          title: render((tpl[lang] || tpl.fr).title, vars),
          body: render((tpl[lang] || tpl.fr).body, vars),
        }),
        render(tpl.fr.title, vars),
      );

      processed++;
      totalSent += sent;
      console.log(`[CUSTOMER-AUTO] ${g.key} · venue ${g.venueId} → ${sent}/${claimed.length} sent`);
    } catch (e) {
      // Best-effort : un club qui échoue n'empêche pas les autres.
      console.error(`[CUSTOMER-AUTO] ${g.key} · venue ${g.venueId} failed:`, e);
    }
  }

  return { processed, sent: totalSent };
}
