// Moteur de notifications Yuno — le passage du cron (process-scheduled-campaigns,
// toutes les 5 min). Design : docs/designs/NOTIFICATION_ENGINE_PLAN.md.
//
//   1. COLLECTE   push_engine_collect()  — chaque règle (annonce, dernières
//                 places, c'est ce soir, panier abandonné, upsell VIP, rappels,
//                 merci) ajoute ses candidats à la file, une fois par soirée.
//   2. ARBITRAGE  push_engine_claim()    — une notification marketing au plus
//                 par personne et par passage, la plus utile ; plafonds, heures
//                 calmes, fatigue, budget par soirée. Le reste est REPORTÉ.
//   3. RÉDACTION  push-engine-text.ts    — texte de la règle, de la variante et
//                 de la RAISON (abonné, ancien client, fan du DJ…), dans la
//                 langue et le fuseau de la personne / de la soirée.
//   4. ENVOI      send-push-notification (app Yuno, iOS), 20 en parallèle.
//   5. SUIVI      push_engine_record()   — file, journal anti-spam
//                 (notification_log), push_campaign_events, compteurs de la
//                 campagne AUTO (event, règle) : le pro la voit dans sa Console.
//
// Best-effort : une panne ne casse jamais le reste du cron. Une ligne réservée
// mais pas envoyée (worker tué) est reprise par l'arbitre après 15 min.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  composeEngineNotification,
  indexTemplates,
  logTypeFor,
  withCampaign,
  type ClaimedRow,
  type EngineTemplate,
  type TemplateIndex,
} from "./push-engine-text.ts";

export interface PushEngineReport {
  collect: unknown;
  claimed: number;
  sent: number;
  failed: number;
  noDevice: number;
  campaigns: number;
  error: string | null;
}

const CONCURRENCY = 20;

async function loadTemplates(admin: SupabaseClient): Promise<TemplateIndex> {
  try {
    const { data, error } = await admin
      .from("push_rule_templates")
      .select("rule_key, variant, reason, lang, title, body");
    if (error) throw error;
    return indexTemplates((data ?? []) as EngineTemplate[]);
  } catch (e) {
    console.error("[PUSH-ENGINE] templates unavailable, fallback text:", e);
    return indexTemplates([]);
  }
}

async function deliverGroup(
  admin: SupabaseClient,
  pushUrl: string,
  serviceKey: string,
  rows: ClaimedRow[],
  templates: TemplateIndex,
  report: PushEngineReport,
): Promise<void> {
  const first = rows[0];
  const ids = rows.map((r) => r.candidate_id);

  // Toutes les règles du moteur portent sur une soirée ; une ligne sans soirée
  // ne peut pas être rattachée à une campagne : on la clôt en échec.
  if (!first.event_id) {
    await admin.rpc("push_engine_record", {
      p_campaign_id: null, p_sent: [], p_failed: ids, p_nodevice: [],
      p_log_type: logTypeFor(first.family), p_title: "",
    });
    report.failed += ids.length;
    return;
  }

  // Texte « vitrine » de la campagne (historique du pro) : la version française
  // de la raison la plus courante du lot.
  const preview = composeEngineNotification({ ...first, lang: "fr" }, templates);
  const { data: campaignId, error: campErr } = await admin.rpc("push_engine_campaign", {
    p_rule: first.rule_key,
    p_event_id: first.event_id,
    p_title: preview.title,
    p_body: preview.body,
    p_url: preview.url,
  });
  if (campErr || !campaignId) {
    // Les lignes restent « réservées » : l'arbitre les reprendra dans 15 min.
    console.error(`[PUSH-ENGINE] campaign ${first.rule_key}/${first.event_id} failed:`, campErr?.message);
    return;
  }

  const sent: number[] = [];
  const failed: number[] = [];
  const none: number[] = [];

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const slice = rows.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async (row) => {
      const n = composeEngineNotification(row, templates);
      try {
        const r = await fetch(pushUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
          body: JSON.stringify({
            user_id: row.user_id,
            // Notification client : l'app Yuno, jamais Yuno Pro.
            platforms: ["ios"],
            payload: { title: n.title, body: n.body, url: withCampaign(n.url, campaignId as string) },
          }),
        });
        if (!r.ok) { failed.push(row.candidate_id); return; }
        const d = await r.json().catch(() => ({} as Record<string, unknown>));
        const s = Number(d.sent || 0);
        const total = Number(d.total || 0);
        if (s > 0) sent.push(row.candidate_id);
        else if (total > 0) failed.push(row.candidate_id);
        else none.push(row.candidate_id);
      } catch {
        failed.push(row.candidate_id);
      }
    }));
  }

  const { error: recErr } = await admin.rpc("push_engine_record", {
    p_campaign_id: campaignId,
    p_sent: sent,
    p_failed: failed,
    p_nodevice: none,
    p_log_type: logTypeFor(first.family),
    p_title: preview.title,
  });
  if (recErr) console.error(`[PUSH-ENGINE] record ${first.rule_key}/${first.event_id} failed:`, recErr.message);

  report.sent += sent.length;
  report.failed += failed.length;
  report.noDevice += none.length;
  report.campaigns += 1;
}

export async function runPushEngine(
  admin: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
  opts: { timeBudgetMs?: number; batch?: number } = {},
): Promise<PushEngineReport> {
  const budget = opts.timeBudgetMs ?? 40_000;
  const batch = opts.batch ?? 600;
  const t0 = Date.now();
  const report: PushEngineReport = {
    collect: null, claimed: 0, sent: 0, failed: 0, noDevice: 0, campaigns: 0, error: null,
  };

  try {
    const { data, error } = await admin.rpc("push_engine_collect");
    report.collect = error ? { error: error.message } : data;
  } catch (e) {
    report.collect = { error: String(e) };
  }

  const templates = await loadTemplates(admin);
  const pushUrl = `${supabaseUrl}/functions/v1/send-push-notification`;

  while (Date.now() - t0 < budget) {
    const { data, error } = await admin.rpc("push_engine_claim", { p_limit: batch });
    if (error) {
      report.error = error.message;
      console.error("[PUSH-ENGINE] claim failed:", error.message);
      break;
    }
    // Pilier boissons en pause (2026-10-01, miroir de src/lib/drinksPillar.ts) : la
    // variante « boissons » du rappel du jour J (choisie en SQL sur menu_enabled)
    // se rend comme la variante par défaut, texte et lien compris.
    const DRINKS_PILLAR_LIVE = false;
    const rows = ((data ?? []) as ClaimedRow[]).map((r) =>
      !DRINKS_PILLAR_LIVE && r.variant === "drinks" ? { ...r, variant: "default" } : r,
    );
    if (rows.length === 0) break;
    report.claimed += rows.length;

    // Une campagne AUTO par (règle, soirée) : le lot s'envoie groupe par groupe.
    const groups = new Map<string, ClaimedRow[]>();
    for (const row of rows) {
      const key = `${row.rule_key}|${row.event_id ?? "-"}`;
      const list = groups.get(key);
      if (list) list.push(row); else groups.set(key, [row]);
    }
    for (const list of groups.values()) {
      try {
        await deliverGroup(admin, pushUrl, serviceKey, list, templates, report);
      } catch (e) {
        console.error("[PUSH-ENGINE] group failed:", e);
      }
    }

    if (rows.length < batch) break;
  }

  console.log(`[PUSH-ENGINE] claimed ${report.claimed} → sent ${report.sent}, failed ${report.failed}, no device ${report.noDevice}`);
  return report;
}

/**
 * Ajout au line-up : les fans de ces DJ entrent dans l'annonce de la soirée
 * (zone, grain personne, jamais deux fois la même personne). L'envoi suit la
 * politique du moteur au passage suivant — plus jamais un push à 2 h du matin.
 */
export async function enqueueLineupAnnouncement(
  admin: SupabaseClient,
  eventId: string,
  djIds: string[],
): Promise<number> {
  const { data, error } = await admin.rpc("push_engine_enqueue_lineup", { p_event_id: eventId, p_dj_ids: djIds });
  if (error) {
    console.error("[PUSH-ENGINE] enqueue lineup failed:", error.message);
    return 0;
  }
  return Number(data ?? 0);
}
