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
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

type Lang = "fr" | "en" | "es";
type LocalizedText = { title: string; body: string };
type AutomationConfig = {
  scope: "event_tickets" | "checked_in" | "followers" | "ticket_no_table";
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
    fr: { title: "Merci d'être venus ❤️", body: "{venue} — cette soirée était spéciale. À très vite." },
    en: { title: "Thanks for coming ❤️", body: "{venue} — tonight was special. See you next time." },
    es: { title: "Gracias por venir ❤️", body: "{venue}: esta noche fue especial. Hasta la próxima." },
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
  // Upsell table VIP à J-2 : détenteurs de billet SANS table (scope
  // ticket_no_table). Le plus gros panier de la nuit tient dans un push.
  vip_upsell: {
    scope: "ticket_no_table",
    fr: { title: "🥂 {event} — passe en VIP", body: "Ta soirée est réservée. Ta table aussi ? Les meilleures partent en premier au {venue}." },
    en: { title: "🥂 {event} — go VIP", body: "Your night is booked. Your table too? The best ones go first at {venue}." },
    es: { title: "🥂 {event} — pásate a VIP", body: "Tu noche está reservada. ¿Y tu mesa? Las mejores vuelan en {venue}." },
  },
};

// Nouvel événement publié → followers. {name} = nom du club ou de l'organisateur.
// Le titre reste court et de longueur stable : iOS le tronque vers 30 caractères,
// et « {name} annonce : {event} » y perdait systématiquement le nom de la soirée.
// Le nom de l'événement passe donc dans le corps, qui dispose de deux lignes.
const NEW_EVENT_TPL: Record<Lang, LocalizedText> = {
  fr: { title: "📅 Nouveau chez {name}", body: "{event} — {date}. Sois dans les premiers à réserver." },
  en: { title: "📅 New at {name}", body: "{event} — {date}. Be one of the first to book." },
  es: { title: "📅 Novedad en {name}", body: "{event} — {date}. Sé de los primeros en reservar." },
};

// Nouvelle soirée d'un RP suivi → ses abonnés. {name} = nom de l'agence.
const NEW_EVENT_AGENCY_TPL: Record<Lang, LocalizedText> = {
  fr: { title: "📅 {name} présente", body: "{event} — {date}. Réserve ta place dès maintenant." },
  en: { title: "📅 {name} presents", body: "{event} — {date}. Book your spot now." },
  es: { title: "📅 {name} presenta", body: "{event} — {date}. Reserva tu lugar ahora." },
};

export function render(text: string, vars: Record<string, string>): string {
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

// Lecture paginée d'une colonne user_id. Le select PostgREST plafonne à ~1000
// lignes : sans .range(), toute audience au-delà était silencieusement tronquée
// (les abonnés au-delà du 1000e n'étaient jamais notifiés). Le thunk reconstruit
// la requête pour chaque page — un builder Supabase n'est thenable qu'une fois.
async function collectUserIds(
  makeQuery: (from: number, to: number) => PromiseLike<{
    data: Array<{ user_id: string | null }> | null;
    error: { message: string } | null;
  }>,
): Promise<string[]> {
  const out = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1);
    if (error) throw new Error(`paginated user_id read failed: ${error.message}`);
    for (const d of data || []) if (d.user_id) out.add(d.user_id);
    if (!data || data.length < PAGE) break;
  }
  return [...out];
}

// Abonnés de l'app grand public uniquement. Les automatisations club et les
// annonces de soirée sont du marketing client : un membre du staff qui n'a que
// Yuno Pro ne doit pas les recevoir (et n'était comptabilisé que comme échec).
export async function subscriberSet(admin: SupabaseClient): Promise<Set<string>> {
  return new Set(await collectUserIds((from, to) =>
    admin.from("push_subscriptions").select("user_id").eq("platform", "ios").range(from, to)));
}

/** Clés désactivées par le super admin (platform_notification_settings). */
export async function disabledKeySet(admin: SupabaseClient): Promise<Set<string>> {
  try {
    const { data } = await admin
      .from("platform_notification_settings")
      .select("notification_key")
      .eq("enabled", false);
    return new Set((data || []).map((d: { notification_key: string }) => d.notification_key));
  } catch {
    return new Set(); // fail-open
  }
}

async function resolveAudience(
  admin: SupabaseClient,
  venueId: string,
  eventId: string,
  scope: AutomationConfig["scope"],
  subscribers: Set<string>,
): Promise<string[]> {
  const ids = new Set<string>();
  const add = (arr: string[]) => { for (const id of arr) ids.add(id); };

  if (scope === "event_tickets") {
    add(await collectUserIds((f, t) => admin
      .from("tickets").select("user_id")
      .eq("event_id", eventId).eq("status", "paid").not("user_id", "is", null).range(f, t)));
    add(await collectUserIds((f, t) => admin
      .from("table_reservations").select("user_id")
      .eq("event_id", eventId).eq("status", "paid").not("user_id", "is", null).range(f, t)));
  } else if (scope === "checked_in") {
    add(await collectUserIds((f, t) => admin
      .from("tickets").select("user_id")
      .eq("event_id", eventId).eq("status", "paid").eq("entry_scanned", true).not("user_id", "is", null).range(f, t)));
  } else if (scope === "ticket_no_table") {
    // Détenteurs de billet payé SANS réservation de table payée sur la soirée.
    add(await collectUserIds((f, t) => admin
      .from("tickets").select("user_id")
      .eq("event_id", eventId).eq("status", "paid").not("user_id", "is", null).range(f, t)));
    const tableHolders = new Set(await collectUserIds((f, t) => admin
      .from("table_reservations").select("user_id")
      .eq("event_id", eventId).eq("status", "paid").not("user_id", "is", null).range(f, t)));
    for (const id of tableHolders) ids.delete(id);
  } else { // followers
    add(await collectUserIds((f, t) => admin
      .from("favorites").select("user_id")
      .eq("venue_id", venueId).not("user_id", "is", null).range(f, t)));
  }

  return [...ids].filter((id) => subscribers.has(id));
}

/**
 * Fan-out commun : envoie la campagne à chaque destinataire DANS SA LANGUE,
 * journalise sent/failed + notification_log, met à jour les compteurs.
 * Renvoie le nombre d'envois réussis.
 */
export async function fanoutCampaign(
  admin: SupabaseClient,
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
    (data || []).forEach((p: { id: string; preferred_language: string | null }) => {
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
            // Automatisations club et annonces : app Yuno grand public uniquement.
            platforms: ["ios"],
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
export async function dispatchPushAutomations(
  admin: SupabaseClient,
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
    // vip_upsell atterrit sur la page soirée : le bloc tables y est le CTA naturel.

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
export async function dispatchNewEventPushes(
  admin: SupabaseClient,
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
      // D'abord le nom public de l'organisateur : c'est celui que le client
      // connaît, et un compte organisateur a rarement first_name/last_name
      // renseignés — d'où les notifications signées « Yuno » au lieu du nom
      // de la soirée. Les prénom/nom ne servent que de repli.
      const { data: op } = await admin
        .from("organizer_profiles").select("display_name").eq("user_id", ev.organizer_user_id).maybeSingle();
      hostName = (op?.display_name || "").trim();
      if (!hostName) {
        const { data: p } = await admin
          .from("profiles").select("first_name, last_name").eq("id", ev.organizer_user_id).maybeSingle();
        hostName = `${p?.first_name || ""} ${p?.last_name || ""}`.trim();
      }
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
      for (const id of await collectUserIds((f, t) => admin
        .from("favorites").select("user_id")
        .eq("venue_id", ev.venue_id).not("user_id", "is", null).range(f, t))) ids.add(id);
    }
    if (ev.organizer_user_id) {
      for (const id of await collectUserIds((f, t) => admin
        .from("organizer_profile_followers").select("user_id")
        .eq("organizer_user_id", ev.organizer_user_id).range(f, t))) ids.add(id);
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

/**
 * Automatisation RP 'agency_new_event' : une soirée fraîche (< 48 h, à venir)
 * rattachée à une agence PAR CONTRAT ACTIF (agency_venue_contracts) déclenche UN
 * push vers les abonnés de cette agence — mais uniquement si l'agence a activé
 * son toggle (agency_push_automations, opt-in, éteint par défaut). Une soirée
 * peut concerner plusieurs agences : une campagne par (soirée, agence), dédupée
 * par le template_key `agency_new_event:<agency_id>` (index unique existant sur
 * (event_id, template_key) WHERE source='auto'). Gated en plus par le kill
 * switch plateforme (clé 'agency_new_event'). Distinct du push club 'new_event' :
 * ce sont deux audiences possédées différentes (followers du club vs de l'RP).
 */
export async function dispatchNewEventAgencyPushes(
  admin: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
): Promise<{ processed: number; sent: number }> {
  if (!(await isAutoPushEnabled(admin, "agency_new_event"))) return { processed: 0, sent: 0 };

  // Opt-in par agence : sans une seule agence ayant activé, rien à faire.
  const { data: toggles } = await admin
    .from("agency_push_automations")
    .select("agency_id")
    .eq("automation_key", "new_event")
    .eq("enabled", true);
  const enabledAgencies = new Set((toggles || []).map((r: { agency_id: string }) => r.agency_id));
  if (enabledAgencies.size === 0) return { processed: 0, sent: 0 };

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
    // Contrats actifs qui rattachent cette soirée à une agence (par club OU orga).
    const orParts: string[] = [];
    if (ev.venue_id) orParts.push(`venue_id.eq.${ev.venue_id}`);
    if (ev.organizer_user_id) orParts.push(`organizer_user_id.eq.${ev.organizer_user_id}`);
    if (orParts.length === 0) continue;

    const { data: contracts } = await admin
      .from("agency_venue_contracts")
      .select("agency_id, agencies(name, is_active)")
      .eq("status", "active")
      .or(orParts.join(","));
    if (!contracts?.length) continue;

    // Une agence peut avoir plusieurs contrats matchant (club + orga) → dédup.
    const seen = new Set<string>();
    for (const c of contracts as Array<{ agency_id: string; agencies: { name: string; is_active: boolean } | { name: string; is_active: boolean }[] | null }>) {
      const agencyId = c.agency_id;
      if (!enabledAgencies.has(agencyId) || seen.has(agencyId)) continue;
      seen.add(agencyId);
      const ag = Array.isArray(c.agencies) ? c.agencies[0] : c.agencies;
      if (!ag || ag.is_active === false) continue;
      const agencyName = (ag.name || "").trim() || "Yuno";

      const targetUrl = ev.venue_id && ev.slug ? `/events/${ev.venue_id}/${ev.slug}` : `/event/${ev.id}`;
      const dateByLang = localizedDate(ev.start_at);
      const varsFor = (lang: Lang) => ({ name: agencyName, event: ev.title || "", date: dateByLang[lang] || "" });

      // Verrou anti-double-fire : template_key par agence sur l'index unique.
      const templateKey = `agency_new_event:${agencyId}`;
      const { data: inserted, error: insErr } = await admin
        .from("push_campaigns")
        .insert({
          title: render(NEW_EVENT_AGENCY_TPL.fr.title, varsFor("fr")),
          body: render(NEW_EVENT_AGENCY_TPL.fr.body, varsFor("fr")),
          url: targetUrl,
          segment: "followers",
          venue_id: ev.venue_id ?? null,
          agency_id: agencyId,
          event_id: ev.id,
          template_key: templateKey,
          source: "auto",
          status: "sending",
          audience: { scope: "followers", agency_id: agencyId },
          targeted_count: 0,
          sent_count: 0,
        })
        .select("id")
        .maybeSingle();
      if (insErr || !inserted) continue; // déjà notifié pour cette (soirée, agence)
      const campaignId = inserted.id as string;

      const ids = new Set(await collectUserIds((f, t) => admin
        .from("agency_followers").select("user_id")
        .eq("agency_id", agencyId).not("user_id", "is", null).range(f, t)));
      const userIds = [...ids].filter((id) => subscribers.has(id));

      const sent = await fanoutCampaign(
        admin, pushUrl, serviceKey, campaignId, userIds, targetUrl,
        (lang) => ({
          title: render(NEW_EVENT_AGENCY_TPL[lang].title, varsFor(lang)),
          body: render(NEW_EVENT_AGENCY_TPL[lang].body, varsFor(lang)),
        }),
        render(NEW_EVENT_AGENCY_TPL.fr.title, varsFor("fr")),
      );

      processed++;
      totalSent += sent;
      console.log(`[AGENCY-NEW-EVENT-PUSH] event ${ev.id} · agency ${agencyId} → ${sent}/${userIds.length} sent`);
    }
  }

  return { processed, sent: totalSent };
}
