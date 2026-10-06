// Webhooks Octopush — accusés de réception, STOP et réponses des SMS marketing.
//
// Trois URL, une fonction (le quota de fonctions edge est atteint) :
//   …/functions/v1/sms-inbound-webhook?k=dlr&t=<OCTOPUSH_WEBHOOK_TOKEN>      (livraisons)
//   …/functions/v1/sms-inbound-webhook?k=stop&t=<OCTOPUSH_WEBHOOK_TOKEN>     (numéros en liste noire = STOP au 30101)
//   …/functions/v1/sms-inbound-webhook?k=inbound&t=<OCTOPUSH_WEBHOOK_TOKEN>  (réponses)
// Posées par scripts/sms/octopush-setup.mjs (ou dans le back-office Octopush,
// menu Callbacks, en JSON).
//
// Octopush ne signe pas ses appels et ne publie pas ses IP : le jeton secret
// de l'URL est la seule porte, comparé en temps constant. Sans lui, n'importe
// qui pourrait désinscrire en masse les contacts des clubs ou réécrire des
// statuts de livraison.
//
// L'art. L34-5 al. 4 CPCE impose d'offrir l'opposition dans chaque message de
// prospection ; encore faut-il la traiter quand elle arrive. Octopush tient la
// liste noire de TOUT son compte : un STOP désinscrit donc de tous les clubs
// et organisateurs (sms_stop_unsubscribe + liste STOP globale de Yuno).
//
// Octopush attend une réponse en ~1 s, corps vide : le travail tient en une
// RPC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { parseOctopushCallback, sameSecret } from "../_shared/sms-octopush.ts";

// Réponse entrante qui vaut opposition (message ENTIER, pas une inclusion :
// « je ne veux pas stopper mes invitations » ne désinscrit personne).
const STOP_KEYWORDS = [
  "stop", "stopsms", "stop sms", "arret", "arrêt", "arreter", "arrêter",
  "unsubscribe", "desabonnement", "désabonnement", "baja", "cancelar",
];

const ok = () => new Response(null, { status: 200 });

async function readBody(req: Request): Promise<Record<string, unknown>[]> {
  const raw = await req.text();
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((x) => x && typeof x === "object");
  } catch {
    // payload_type « html » : formulaire encodé.
    const form = new URLSearchParams(raw);
    const out: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) out[k] = v;
    return [out];
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = Deno.env.get("OCTOPUSH_WEBHOOK_TOKEN") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !serviceKey) {
    console.error("[sms-webhook] configuration incomplète");
    return new Response(null, { status: 500 });
  }

  const url = new URL(req.url);
  if (!sameSecret(url.searchParams.get("t") ?? "", secret)) {
    console.warn("[sms-webhook] jeton absent ou faux — rejeté");
    return new Response(null, { status: 403 });
  }
  const k = url.searchParams.get("k");

  try {
    const events = await readBody(req);
    const admin = createClient(supabaseUrl, serviceKey);
    for (const body of events) {
      const ev = parseOctopushCallback(k, body);
      if (!ev) continue;

      if (ev.kind === "dlr") {
        if (ev.status) {
          const { error } = await admin.rpc("apply_sms_delivery_status", {
            p_message_id: ev.messageId, p_phone: ev.phone, p_status: ev.status,
            p_error_code: ev.status === "delivered" ? null : ev.raw, p_error_message: null,
          });
          if (error) { console.error("[sms-webhook] accusé", error.message); return new Response(null, { status: 500 }); }
        }
        // Numéro en liste noire chez Octopush : il a dit STOP, Yuno l'oublie aussi.
        if (ev.blacklisted) await admin.rpc("sms_stop_unsubscribe", { _phone: ev.phone });
        continue;
      }

      if (ev.kind === "inbound") {
        const text = ev.text.toLowerCase().replace(/[.!,;:]/g, "").trim();
        if (!STOP_KEYWORDS.includes(text)) continue;
      }

      // STOP au 30101, ou réponse « STOP ».
      const { data, error } = await admin.rpc("sms_stop_unsubscribe", { _phone: ev.phone });
      if (error) { console.error("[sms-webhook] STOP", error.message); return new Response(null, { status: 500 }); }
      console.log(`[sms-webhook] STOP traité : ${data ?? 0} contact(s) désinscrit(s)`);
    }
    return ok();
  } catch (err) {
    console.error("[sms-webhook] erreur", err instanceof Error ? err.message : err);
    return new Response(null, { status: 500 });
  }
});
