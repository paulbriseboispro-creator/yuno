import { renderAutoTpl, resolveUserLang, sendAutoPush, type AutoPushLang, type AutoPushVar } from "./auto-push.ts";

// Bilan du lendemain (plan de simplification de l'analyse, lot 7) : le
// lendemain d'une soirée, à partir de 11 h à Paris, le pro reçoit ses trois
// chiffres (entrées / attendus, CA, dépense par tête) et l'écart avec la
// soirée précédente, avec un lien vers le Rapport de soirée.
//
// Deux canaux, un seul texte (clé AUTO_PUSH `night_recap`, rendu dans la
// langue du destinataire) :
//   - la cloche de la Console (emit_staff_notification côté club,
//     emit_organizer_notification côté organisateur) — toujours ;
//   - un push sur Yuno Pro — gaté par le registre /admin/notifications
//     (clé semée ÉTEINTE), et jamais pour une soirée démo.
// Dédup RACE-SAFE : la soirée est RÉCLAMÉE dans night_recap_log (PK) avant
// tout envoi ; un passage qui perd la course ne fait rien. Une soirée sans
// personne attendue est réclamée et tue (pas de bilan vide).
// Drainé par process-scheduled-campaigns (même convention que le récap hebdo).
// deno-lint-ignore no-explicit-any
export async function dispatchNightRecaps(admin: any): Promise<{ processed: number; sent: number; inApp: number }> {
  const { data: due, error } = await admin.rpc("night_recap_due");
  if (error || !Array.isArray(due) || due.length === 0) return { processed: 0, sent: 0, inApp: 0 };

  let processed = 0;
  let sent = 0;
  let inApp = 0;
  for (const row of due as (string | { night_recap_due?: string })[]) {
    const eventId = typeof row === "string" ? row : row?.night_recap_due;
    if (!eventId) continue;
    try {
      const { error: claimErr } = await admin.from("night_recap_log").insert({ event_id: eventId });
      if (claimErr) continue; // déjà fait (ou course perdue)

      const { data: raw } = await admin.rpc("night_recap_data", { p_event_id: eventId });
      const d = raw as NightRecap | null;
      if (!d?.ok || (d.expected <= 0 && d.entered <= 0)) continue;
      processed++;

      const vars = recapVars(d);
      const variant = d.revenue > 0 ? "default" : "free";
      const path = d.venue_id
        ? `/owner/analytics?tab=sales&view=event&event=${eventId}`
        : `/organizer-app/analytics?tab=sales&view=event&event=${eventId}`;

      // 1. La cloche, dans la langue du destinataire.
      const lang = await resolveUserLang(admin, d.recipient);
      const tpl = renderAutoTpl("night_recap", lang, vars, variant);
      if (tpl) {
        const common = {
          p_type: "night_recap", p_title: tpl.title, p_message: tpl.body, p_priority: "normal",
          p_reference_type: "event", p_reference_id: eventId, p_event_id: eventId,
          p_metadata: { entered: d.entered, expected: d.expected, revenue: d.revenue, spend: d.spend },
          p_dedup_key: `night_recap:${eventId}`,
        };
        const { error: notifErr } = d.venue_id
          ? await admin.rpc("emit_staff_notification", { p_venue_id: d.venue_id, p_target_role: "owner", ...common })
          : await admin.rpc("emit_organizer_notification", { p_organizer_user_id: d.organizer_user_id, ...common });
        if (notifErr) console.error(`[NIGHT-RECAP] in-app ${eventId}:`, notifErr.message);
        else inApp++;
      }

      // 2. Le push (registre + jamais la démo).
      if (!d.demo) {
        const res = await sendAutoPush(admin, { key: "night_recap", userId: d.recipient, url: path, vars, variant });
        sent += res.sent;
      }
    } catch (e) {
      console.error(`[NIGHT-RECAP] event ${eventId} failed:`, String(e));
    }
  }
  return { processed, sent, inApp };
}

interface NightRecap {
  ok: boolean;
  event_id: string;
  title: string;
  venue_id: string | null;
  organizer_user_id: string | null;
  recipient: string;
  entered: number;
  expected: number;
  target: number | null;
  revenue: number;
  spend: number | null;
  prev_title: string | null;
  prev_entered: number | null;
  demo: boolean;
}

const LOCALE: Record<AutoPushLang, string> = { fr: "fr-FR", en: "en-GB", es: "es-ES" };

/** Une valeur formatée dans chaque langue. */
function perLang(f: (locale: string, lang: AutoPushLang) => string): Record<AutoPushLang, string> {
  return { fr: f(LOCALE.fr, "fr"), en: f(LOCALE.en, "en"), es: f(LOCALE.es, "es") };
}

function recapVars(d: NightRecap): Record<string, AutoPushVar> {
  const n = (v: number) => perLang((l) => new Intl.NumberFormat(l, { maximumFractionDigits: 0 }).format(v));
  const eur = (v: number, digits: number) => perLang((l) => new Intl.NumberFormat(l, {
    style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(v));

  // « , +12 % d'entrées vs Amore Night » — seulement avec une référence qui a vu du monde.
  let compare: AutoPushVar = "";
  if (d.prev_title && d.prev_entered && d.prev_entered > 0 && d.entered > 0) {
    const pct = Math.round(((d.entered - d.prev_entered) / d.prev_entered) * 100);
    const sign = pct > 0 ? "+" : pct < 0 ? "−" : "±";
    const abs = Math.abs(pct);
    compare = {
      fr: `, ${sign}${abs} % d'entrées vs ${d.prev_title}`,
      en: `, ${sign}${abs}% entries vs ${d.prev_title}`,
      es: `, ${sign}${abs} % de accesos vs ${d.prev_title}`,
    };
  }
  return {
    event: d.title,
    entered: n(d.entered),
    expected: n(d.expected),
    revenue: eur(d.revenue, 0),
    spend: d.spend ? eur(d.spend, 2) : "",
    compare,
  };
}
