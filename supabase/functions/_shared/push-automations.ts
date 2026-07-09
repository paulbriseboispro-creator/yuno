// Dispatcher des notifications push AUTOMATIQUES.
//
// Appelé par process-scheduled-campaigns (cron */5 min, déjà déployé — évite le
// cap 402 sur les nouvelles fonctions). Lit get_due_push_automations(), et pour
// chaque soirée « due » : crée la campagne (source='auto', dédupée par index
// unique), résout l'audience, envoie à chacun DANS SA LANGUE via
// send-push-notification, puis journalise sent/failed + met à jour les compteurs.
//
// Le texte localisé par destinataire est le miroir serveur des clés i18n
// pushTpl.* du front (même pattern que le trigger de bienvenue Mode Live, qui
// inline aussi FR/EN/ES). La colonne title/body stockée sur la campagne est en
// français, seulement pour l'affichage de l'historique owner.

type Lang = "fr" | "en" | "es";
type LocalizedText = { title: string; body: string };
type AutomationConfig = {
  scope: "event_tickets" | "checked_in" | "followers";
  fr: LocalizedText;
  en: LocalizedText;
  es: LocalizedText;
};

const AUTOMATIONS: Record<string, AutomationConfig> = {
  reminder_day_of: {
    scope: "event_tickets",
    fr: { title: "🎟️ Ce soir : {event}", body: "Rendez-vous au {venue}. Prépare-toi, ça commence bientôt." },
    en: { title: "🎟️ Tonight: {event}", body: "See you at {venue}. Get ready, it starts soon." },
    es: { title: "🎟️ Esta noche: {event}", body: "Nos vemos en {venue}. Prepárate, empieza pronto." },
  },
  event_live: {
    scope: "event_tickets",
    fr: { title: "🔥 {event} c'est maintenant", body: "Les portes sont ouvertes au {venue}. On t'attend." },
    en: { title: "🔥 {event} is on right now", body: "Doors are open at {venue}. See you inside." },
    es: { title: "🔥 {event} es ahora", body: "Las puertas están abiertas en {venue}. Te esperamos." },
  },
  thank_you: {
    scope: "checked_in",
    fr: { title: "Merci d'être venus 🖤", body: "{venue} — cette soirée était spéciale. À très vite." },
    en: { title: "Thanks for coming 🖤", body: "{venue} — tonight was special. See you next time." },
    es: { title: "Gracias por venir 🖤", body: "{venue}: esta noche fue especial. Hasta la próxima." },
  },
  almost_sold_out: {
    scope: "followers",
    fr: { title: "⚡ {event} — bientôt complet", body: "Les dernières places partent vite au {venue}. Réserve la tienne." },
    en: { title: "⚡ {event} — almost sold out", body: "The last tickets are going fast at {venue}. Grab yours." },
    es: { title: "⚡ {event} — casi agotado", body: "Las últimas entradas vuelan en {venue}. Consigue la tuya." },
  },
};

function render(text: string, vars: { event: string; venue: string }): string {
  return text
    .replace(/\{event\}/g, vars.event ?? "")
    .replace(/\{venue\}/g, vars.venue ?? "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type DueRow = {
  venue_id: string;
  venue_name: string | null;
  event_id: string;
  event_title: string | null;
  event_slug: string | null;
  automation_key: string;
};

// deno-lint-ignore no-explicit-any
async function subscriberSet(admin: any): Promise<Set<string>> {
  const { data } = await admin.from("push_subscriptions").select("user_id");
  // deno-lint-ignore no-explicit-any
  return new Set((data || []).map((d: any) => d.user_id));
}

// deno-lint-ignore no-explicit-any
async function resolveAudience(
  admin: any,
  venueId: string,
  eventId: string,
  scope: AutomationConfig["scope"],
  subscribers: Set<string>,
): Promise<string[]> {
  const ids = new Set<string>();

  if (scope === "event_tickets") {
    const { data: tk } = await admin
      .from("tickets").select("user_id")
      .eq("event_id", eventId).eq("status", "paid").not("user_id", "is", null);
    // deno-lint-ignore no-explicit-any
    (tk || []).forEach((d: any) => ids.add(d.user_id));
    const { data: tr } = await admin
      .from("table_reservations").select("user_id")
      .eq("event_id", eventId).eq("status", "paid").not("user_id", "is", null);
    // deno-lint-ignore no-explicit-any
    (tr || []).forEach((d: any) => ids.add(d.user_id));
  } else if (scope === "checked_in") {
    const { data } = await admin
      .from("tickets").select("user_id")
      .eq("event_id", eventId).eq("status", "paid").eq("entry_scanned", true).not("user_id", "is", null);
    // deno-lint-ignore no-explicit-any
    (data || []).forEach((d: any) => ids.add(d.user_id));
  } else { // followers
    const { data } = await admin
      .from("favorites").select("user_id")
      .eq("venue_id", venueId).not("user_id", "is", null);
    // deno-lint-ignore no-explicit-any
    (data || []).forEach((d: any) => ids.add(d.user_id));
  }

  return [...ids].filter((id) => subscribers.has(id));
}

/**
 * Traite toutes les automatisations dues. Best-effort : une soirée qui échoue
 * n'empêche pas les autres. Renvoie un petit résumé pour les logs du cron.
 */
// deno-lint-ignore no-explicit-any
export async function dispatchPushAutomations(
  admin: any,
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ processed: number; sent: number }> {
  const { data: due, error } = await admin.rpc("get_due_push_automations");
  if (error) {
    console.error("[AUTO-PUSH] get_due_push_automations failed:", error.message);
    return { processed: 0, sent: 0 };
  }

  const rows = (due || []) as DueRow[];
  if (rows.length === 0) return { processed: 0, sent: 0 };

  const subscribers = await subscriberSet(admin);
  const pushUrl = `${supabaseUrl}/functions/v1/send-push-notification`;
  let processed = 0;
  let totalSent = 0;

  for (const row of rows) {
    const cfg = AUTOMATIONS[row.automation_key];
    if (!cfg) continue;

    const vars = { event: row.event_title || "", venue: row.venue_name || "" };
    // event_live renvoie vers le Mode Live ; les autres vers la page soirée.
    const targetUrl = row.automation_key === "event_live"
      ? "/live"
      : (row.event_slug ? `/events/${row.venue_id}/${row.event_slug}` : `/club/${row.venue_id}`);

    // Insert de la campagne AVANT l'envoi : l'index unique (event_id, template_key)
    // WHERE source='auto' fait office de verrou anti-double-fire. En cas de
    // conflit, un autre run a déjà pris la main → on saute.
    const { data: inserted, error: insErr } = await admin
      .from("push_campaigns")
      .insert({
        title: render(cfg.fr.title, vars),
        body: render(cfg.fr.body, vars),
        url: targetUrl,
        segment: cfg.scope,
        venue_id: row.venue_id,
        event_id: row.event_id,
        template_key: row.automation_key,
        source: "auto",
        status: "sending",
        audience: { scope: cfg.scope },
        targeted_count: 0,
        sent_count: 0,
      })
      .select("id")
      .maybeSingle();

    if (insErr || !inserted) continue; // conflit d'unicité => déjà envoyé ailleurs
    const campaignId = inserted.id as string;

    const userIds = await resolveAudience(admin, row.venue_id, row.event_id, cfg.scope, subscribers);
    const trackedUrl = targetUrl.includes("?") ? `${targetUrl}&pc=${campaignId}` : `${targetUrl}?pc=${campaignId}`;

    // Langue de chaque destinataire (défaut fr) pour un push dans sa langue.
    const langByUser = new Map<string, Lang>();
    for (let i = 0; i < userIds.length; i += 500) {
      const { data } = await admin
        .from("profiles").select("id, preferred_language").in("id", userIds.slice(i, i + 500));
      // deno-lint-ignore no-explicit-any
      (data || []).forEach((p: any) => {
        const l = (p.preferred_language as Lang) || "fr";
        langByUser.set(p.id, l === "en" || l === "es" ? l : "fr");
      });
    }

    let sent = 0;
    let failed = 0;
    const events: Array<{ campaign_id: string; user_id: string; event_type: string }> = [];

    for (let i = 0; i < userIds.length; i += 10) {
      const batch = userIds.slice(i, i + 10);
      const results = await Promise.all(batch.map(async (uid) => {
        const lang = langByUser.get(uid) || "fr";
        const tpl = cfg[lang] || cfg.fr;
        try {
          const r = await fetch(pushUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
            body: JSON.stringify({
              user_id: uid,
              payload: { title: render(tpl.title, vars), body: render(tpl.body, vars), url: trackedUrl },
            }),
          });
          const d = await r.json().catch(() => ({}));
          return { uid, sent: Number(d.sent || 0) };
        } catch {
          return { uid, sent: 0 };
        }
      }));
      for (const { uid, sent: s } of results) {
        if (s > 0) { sent++; events.push({ campaign_id: campaignId, user_id: uid, event_type: "sent" }); }
        else { failed++; events.push({ campaign_id: campaignId, user_id: uid, event_type: "failed" }); }
      }
    }

    for (let i = 0; i < events.length; i += 500) {
      await admin.from("push_campaign_events")
        .upsert(events.slice(i, i + 500), { onConflict: "campaign_id,user_id,event_type", ignoreDuplicates: true });
    }
    for (let i = 0; i < userIds.length; i += 500) {
      await admin.from("notification_log").insert(
        userIds.slice(i, i + 500).map((uid) => ({
          user_id: uid,
          notification_type: "campaign",
          title: render(cfg.fr.title, vars),
        })),
      );
    }

    await admin.from("push_campaigns").update({
      status: "sent",
      sent_count: sent,
      failed_count: failed,
      targeted_count: userIds.length,
    }).eq("id", campaignId);

    processed++;
    totalSent += sent;
    console.log(`[AUTO-PUSH] ${row.automation_key} · event ${row.event_id} → ${sent}/${userIds.length} sent`);
  }

  return { processed, sent: totalSent };
}
