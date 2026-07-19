// Dispatcher des notifications push AUTOMATIQUES.
//
// Appelé par process-scheduled-campaigns (cron */5 min, déjà déployé — évite le
// cap 402 sur les nouvelles fonctions). Deux familles :
//   • Automatisations CLUB (get_due_push_automations) : opt-in par owner
//     (venue_push_automations), fenêtres de tir en SQL.
//   • Automatisation PLATEFORME 'new_event' : nouvel événement publié → push
//     aux followers du club (favorites) ET de l'organisateur
//     (organizer_profile_followers). Pilotée uniquement par le super admin.
//
// Les DEUX familles sont sous le kill switch global du super admin
// (platform_notification_settings, page /admin/notifications) — une clé
// désactivée ne part plus, même si des clubs l'ont activée.
//
// Mécanique commune : créer la campagne (source='auto', dédupée par l'index
// unique (event_id, template_key)), résoudre l'audience, envoyer à chacun DANS
// SA LANGUE via send-push-notification, journaliser sent/failed
// (push_campaign_events) + notification_log, mettre à jour les compteurs.
// Le tracking clic passe par ?pc=<campaign_id> (PushClickTracker) ; la RPC
// get_auto_push_stats() agrège le tout par template_key pour la page admin.

import { isAutoPushEnabled, localizedDate } from "./auto-push.ts";

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
  drinks_preorder: {
    scope: "event_tickets",
    fr: { title: "🍸 Ce soir : zéro file au bar", body: "{event} — commande tes boissons dans l'app dès maintenant, elles t'attendent au {venue}." },
    en: { title: "🍸 Tonight: skip the bar queue", body: "{event} — order your drinks in the app now, they'll be waiting at {venue}." },
    es: { title: "🍸 Esta noche: sin cola en la barra", body: "{event} — pide tus copas en la app ahora, te esperan en {venue}." },
  },
};

// Nouvel événement publié → followers. {name} = nom du club ou de l'organisateur.
const NEW_EVENT_TPL: Record<Lang, LocalizedText> = {
  fr: { title: "📅 {name} annonce : {event}", body: "{date} — sois dans les premiers à réserver." },
  en: { title: "📅 {name} just announced: {event}", body: "{date} — be one of the first to book." },
  es: { title: "📅 {name} anuncia: {event}", body: "{date} — sé de los primeros en reservar." },
};

function render(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v ?? "");
  }
  return out.replace(/\s{2,}/g, " ").trim();
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

/** Clés désactivées par le super admin (platform_notification_settings). */
// deno-lint-ignore no-explicit-any
async function disabledKeySet(admin: any): Promise<Set<string>> {
  try {
    const { data } = await admin
      .from("platform_notification_settings")
      .select("notification_key")
      .eq("enabled", false);
    // deno-lint-ignore no-explicit-any
    return new Set((data || []).map((d: any) => d.notification_key));
  } catch {
    return new Set(); // fail-open
  }
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
 * Fan-out commun : envoie la campagne à chaque destinataire DANS SA LANGUE,
 * journalise sent/failed + notification_log, met à jour les compteurs.
 * Renvoie le nombre d'envois réussis.
 */
// deno-lint-ignore no-explicit-any
async function fanoutCampaign(
  admin: any,
  pushUrl: string,
  serviceKey: string,
  campaignId: string,
  userIds: string[],
  targetUrl: string,
  textFor: (lang: Lang) => LocalizedText,
  logTitle: string,
): Promise<number> {
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
      const tpl = textFor(langByUser.get(uid) || "fr");
      try {
        const r = await fetch(pushUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
          body: JSON.stringify({
            user_id: uid,
            payload: { title: tpl.title, body: tpl.body, url: trackedUrl },
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
        title: logTitle,
      })),
    );
  }

  await admin.from("push_campaigns").update({
    status: "sent",
    sent_count: sent,
    failed_count: failed,
    targeted_count: userIds.length,
  }).eq("id", campaignId);

  return sent;
}

/**
 * Traite toutes les automatisations CLUB dues. Best-effort : une soirée qui
 * échoue n'empêche pas les autres. Renvoie un petit résumé pour les logs du cron.
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

  // Kill switch plateforme : une clé coupée par le super admin ne part plus,
  // même si le club a activé son toggle.
  const disabled = await disabledKeySet(admin);

  const subscribers = await subscriberSet(admin);
  const pushUrl = `${supabaseUrl}/functions/v1/send-push-notification`;
  let processed = 0;
  let totalSent = 0;

  for (const row of rows) {
    const cfg = AUTOMATIONS[row.automation_key];
    if (!cfg) continue;
    if (disabled.has(row.automation_key)) continue;

    const vars = { event: row.event_title || "", venue: row.venue_name || "" };
    // event_live renvoie vers le Mode Live, drinks_preorder vers la page
    // d'achat boissons de la soirée ; les autres vers la page soirée.
    const targetUrl = row.automation_key === "event_live"
      ? "/live"
      : row.automation_key === "drinks_preorder"
        ? `/order/upsell?event=${row.event_id}`
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

    const sent = await fanoutCampaign(
      admin, pushUrl, serviceKey, campaignId, userIds, targetUrl,
      (lang) => ({
        title: render((cfg[lang] || cfg.fr).title, vars),
        body: render((cfg[lang] || cfg.fr).body, vars),
      }),
      render(cfg.fr.title, vars),
    );

    processed++;
    totalSent += sent;
    console.log(`[AUTO-PUSH] ${row.automation_key} · event ${row.event_id} → ${sent}/${userIds.length} sent`);
  }

  return { processed, sent: totalSent };
}

/**
 * Automatisation PLATEFORME 'new_event' : un événement publié depuis moins de
 * 48 h (et à venir) déclenche UN push vers les followers du club + de
 * l'organisateur. Dédup par le même index unique (event_id, template_key)
 * WHERE source='auto' — la fenêtre 48 h évite de notifier tout le back
 * catalogue au premier déploiement.
 */
// deno-lint-ignore no-explicit-any
export async function dispatchNewEventPushes(
  admin: any,
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ processed: number; sent: number }> {
  if (!(await isAutoPushEnabled(admin, "new_event"))) return { processed: 0, sent: 0 };

  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data: events } = await admin
    .from("events")
    .select("id, title, slug, venue_id, organizer_user_id, start_at")
    .eq("is_active", true)
    .is("cancelled_at", null)
    .gt("start_at", nowIso)
    .gte("created_at", cutoff);
  if (!events?.length) return { processed: 0, sent: 0 };

  const subscribers = await subscriberSet(admin);
  const pushUrl = `${supabaseUrl}/functions/v1/send-push-notification`;
  let processed = 0;
  let totalSent = 0;

  for (const ev of events) {
    // Nom de l'hôte : club, sinon organisateur.
    let hostName = "";
    if (ev.venue_id) {
      const { data: v } = await admin.from("venues").select("name").eq("id", ev.venue_id).maybeSingle();
      hostName = v?.name || "";
    } else if (ev.organizer_user_id) {
      const { data: p } = await admin
        .from("profiles").select("first_name, last_name").eq("id", ev.organizer_user_id).maybeSingle();
      hostName = `${p?.first_name || ""} ${p?.last_name || ""}`.trim();
    }
    if (!hostName) hostName = "Yuno";

    const targetUrl = ev.venue_id && ev.slug ? `/events/${ev.venue_id}/${ev.slug}` : `/event/${ev.id}`;
    const dateByLang = localizedDate(ev.start_at);
    const varsFor = (lang: Lang) => ({
      name: hostName,
      event: ev.title || "",
      date: dateByLang[lang] || "",
    });

    // Verrou anti-double-fire (index unique) — insert AVANT l'envoi.
    const { data: inserted, error: insErr } = await admin
      .from("push_campaigns")
      .insert({
        title: render(NEW_EVENT_TPL.fr.title, varsFor("fr")),
        body: render(NEW_EVENT_TPL.fr.body, varsFor("fr")),
        url: targetUrl,
        segment: "followers",
        venue_id: ev.venue_id ?? null,
        event_id: ev.id,
        template_key: "new_event",
        source: "auto",
        status: "sending",
        audience: { scope: "followers" },
        targeted_count: 0,
        sent_count: 0,
      })
      .select("id")
      .maybeSingle();
    if (insErr || !inserted) continue; // déjà notifié
    const campaignId = inserted.id as string;

    // Audience : followers du club + followers de l'organisateur.
    const ids = new Set<string>();
    if (ev.venue_id) {
      const { data } = await admin
        .from("favorites").select("user_id")
        .eq("venue_id", ev.venue_id).not("user_id", "is", null);
      // deno-lint-ignore no-explicit-any
      (data || []).forEach((d: any) => ids.add(d.user_id));
    }
    if (ev.organizer_user_id) {
      const { data } = await admin
        .from("organizer_profile_followers").select("user_id")
        .eq("organizer_user_id", ev.organizer_user_id);
      // deno-lint-ignore no-explicit-any
      (data || []).forEach((d: any) => ids.add(d.user_id));
    }
    const userIds = [...ids].filter((id) => subscribers.has(id));

    const sent = await fanoutCampaign(
      admin, pushUrl, serviceKey, campaignId, userIds, targetUrl,
      (lang) => ({
        title: render(NEW_EVENT_TPL[lang].title, varsFor(lang)),
        body: render(NEW_EVENT_TPL[lang].body, varsFor(lang)),
      }),
      render(NEW_EVENT_TPL.fr.title, varsFor("fr")),
    );

    processed++;
    totalSent += sent;
    console.log(`[NEW-EVENT-PUSH] event ${ev.id} → ${sent}/${userIds.length} sent`);
  }

  return { processed, sent: totalSent };
}
