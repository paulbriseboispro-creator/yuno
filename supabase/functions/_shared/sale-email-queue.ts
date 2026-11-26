// Passage « e-mails de vente » de process-scheduled-campaigns (aucun nouveau cron) :
//   1. file D6 : rejoue les e-mails de vente que Resend avait refusés (+15 min, +1 h, demain 8 h Paris) ;
//   2. effets rejouables d'une table payée (P2.7) : un effet manquant (e-mail, notification, promoteur) est relancé
//      par verify-table-payment, qui ne rejoue que ce qui manque ;
//   3. P6.6 : alerte super admin pour une table payée depuis 30 min sans e-mail.
// La base décide de tout (échéances, bail, démo, dédoublonnage) ; ce module ne fait que déclencher les appels.
// Best-effort : une panne ici ne casse jamais le reste du passage.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { SALE_EMAIL_REPLAY_HEADER } from "./sale-email.ts";

type QueueRow = { id: string; kind: "ticket" | "table"; sale_id: string; email_type: string; payload: Record<string, unknown> | null };

export interface SaleEmailQueueResult { replayed: number; sent: number; retry: number; dropped: number; effectsReplayed: number; alerts: number; recaps: number }

export async function dispatchSaleEmailQueue(
  admin: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
  opts: { timeBudgetMs?: number } = {},
): Promise<SaleEmailQueueResult> {
  const out: SaleEmailQueueResult = { replayed: 0, sent: 0, retry: 0, dropped: 0, effectsReplayed: 0, alerts: 0, recaps: 0 };
  const deadline = Date.now() + (opts.timeBudgetMs ?? 25_000);
  const headers = {
    "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json", "apikey": serviceKey,
    [SALE_EMAIL_REPLAY_HEADER]: "1",
  };

  // 3. alertes d'abord (une requête SQL, bornée)
  try {
    const { data } = await admin.rpc("sale_effects_sweep");
    out.alerts = typeof data === "number" ? data : 0;
  } catch (e) {
    console.error("[SALE-EMAIL-QUEUE] sale_effects_sweep:", e);
  }

  // 3 bis. récap de la veille des tables VIP (cloche, une notification par soirée et par partie ; la base garde la fenêtre 16 h – 22 h)
  try {
    const { data } = await admin.rpc("tables_eve_recap_run");
    out.recaps = typeof data === "number" ? data : 0;
  } catch (e) {
    console.error("[SALE-EMAIL-QUEUE] tables_eve_recap_run:", e);
  }

  // 1. file des e-mails de vente
  try {
    const { data } = await admin.rpc("claim_sale_email_queue", { p_limit: 20 });
    for (const row of (data ?? []) as QueueRow[]) {
      if (Date.now() > deadline) break;
      out.replayed++;
      try {
        const payload = row.payload ?? {};
        const res = row.kind === "table"
          ? await fetch(`${supabaseUrl}/functions/v1/send-vip-confirmation`, {
              method: "POST", headers,
              body: JSON.stringify({ reservation_id: row.sale_id, type: row.email_type, ...(typeof payload.changes === "string" ? { changes: payload.changes } : {}) }),
              signal: AbortSignal.timeout(20_000),
            })
          : await fetch(`${supabaseUrl}/functions/v1/send-ticket-confirmation`, {
              method: "POST", headers,
              body: JSON.stringify({ ...payload, ticketId: row.sale_id }),
              signal: AbortSignal.timeout(30_000),
            });
        const text = await res.text();
        // 2xx : parti. 409 / 410 (l'état ne correspond plus) : close sans envoi. 429 / 5xx / 503 « retry » : on retentera.
        // Autre 4xx (réservation introuvable, adresse absente) : définitif, rien à retenter.
        let result: "sent" | "dropped" | "retry" = "retry";
        if (res.ok) result = "sent";
        else if (res.status === 409 || res.status === 410 || res.status === 403) result = "dropped";
        else if (res.status === 400 && !/Resend|network/i.test(text)) result = "dropped";
        await admin.rpc("finish_sale_email_queue", { p_id: row.id, p_result: result, p_error: result === "sent" ? null : `${res.status} ${text}`.slice(0, 400) });
        out[result]++;
      } catch (e) {
        await admin.rpc("finish_sale_email_queue", { p_id: row.id, p_result: "retry", p_error: String(e).slice(0, 400) });
        out.retry++;
      }
    }
  } catch (e) {
    console.error("[SALE-EMAIL-QUEUE] queue:", e);
  }

  // 2. effets d'une table payée à relancer (verify-table-payment ne rejoue que les effets manquants)
  try {
    const { data } = await admin.rpc("claim_table_effects_replays", { p_limit: 10 });
    for (const row of (data ?? []) as Array<{ reservation_id: string; stripe_session_id: string | null }>) {
      if (Date.now() > deadline || !row.stripe_session_id) break;
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/verify-table-payment`, {
          method: "POST", headers,
          body: JSON.stringify({ sessionId: row.stripe_session_id, reservationId: row.reservation_id }),
          signal: AbortSignal.timeout(30_000),
        });
        await res.text();
        out.effectsReplayed++;
      } catch (e) {
        console.error("[SALE-EMAIL-QUEUE] effects replay:", row.reservation_id, e);
      }
    }
  } catch (e) {
    console.error("[SALE-EMAIL-QUEUE] effects:", e);
  }
  return out;
}
