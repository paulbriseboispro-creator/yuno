// Webhook Twilio des SMS ENTRANTS — traite les désinscriptions « STOP ».
//
// L'art. L34-5 al. 4 CPCE impose d'offrir l'opposition dans chaque message de
// prospection ; encore faut-il la traiter quand elle arrive. send-sms-campaign
// ajoute la mention « STOP pour ne plus recevoir » à chaque envoi, ce webhook
// est l'autre moitié : sans lui, on promet une désinscription qu'on n'honore
// pas, ce qui est pire que de ne rien promettre.
//
// À configurer côté Twilio : Phone Numbers → le numéro → Messaging →
// « A MESSAGE COMES IN » → Webhook POST vers
//   https://<project>.supabase.co/functions/v1/sms-inbound-webhook
//
// Le numéro d'envoi étant partagé par tous les clubs, un STOP désinscrit de
// TOUS les clubs (cf. commentaire de sms_stop_unsubscribe dans la migration) :
// la personne n'a aucun moyen de désigner un club, et sur-honorer une
// opposition n'a jamais constitué un manquement.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// Mots-clés d'opposition. Twilio en intercepte certains nativement sur les
// numéros US, mais pas sur un numéro long européen : on les traite nous-mêmes.
// « ARRET » est la forme française attendue par les opérateurs, avec ses
// variantes accentuées et collées.
const STOP_KEYWORDS = [
  "stop",
  "stopsms",
  "stop sms",
  "arret",
  "arrêt",
  "arreter",
  "arrêter",
  "unsubscribe",
  "desabonnement",
  "désabonnement",
  "baja",
  "cancelar",
];

/**
 * Validation de la signature Twilio (X-Twilio-Signature).
 *
 * Indispensable : sans elle, n'importe qui peut POSTer ici et désinscrire en
 * masse les contacts marketing des clubs. C'est une écriture destructrice,
 * même si elle va dans le sens « sûr » pour la personne concernée.
 *
 * Algorithme Twilio : HMAC-SHA1 de (URL + concaténation des paires clé/valeur
 * triées par clé), clé = auth token, résultat en base64.
 */
async function isValidTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  const payload = url + Object.keys(params).sort().map((k) => k + params[k]).join("");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Comparaison à temps constant : une comparaison naïve laisse fuiter la
  // signature attendue octet par octet.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

// Twilio attend du TwiML. Une réponse vide = « ne rien répondre à l'expéditeur ».
// On n'envoie PAS d'accusé de réception : ce serait un SMS de plus vers
// quelqu'un qui vient précisément de demander à ne plus en recevoir, et il
// serait facturé.
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(status = 200): Response {
  return new Response(EMPTY_TWIML, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!authToken || !supabaseUrl || !serviceKey) {
      console.error("[sms-inbound] configuration incomplète");
      return twiml(500);
    }

    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = String(v);

    const signature = req.headers.get("X-Twilio-Signature") ?? "";
    if (!signature) {
      console.warn("[sms-inbound] requête sans signature — rejetée");
      return twiml(403);
    }

    // L'URL signée par Twilio est celle qu'il a appelée. Derrière le proxy
    // Supabase, req.url est fidèle, mais le protocole peut revenir en http :
    // Twilio a signé du https, on reconstruit donc en https.
    const url = new URL(req.url);
    url.protocol = "https:";
    const signedUrl = url.toString();

    if (!(await isValidTwilioSignature(authToken, signature, signedUrl, params))) {
      console.warn("[sms-inbound] signature invalide — rejetée");
      return twiml(403);
    }

    const from = (params.From ?? "").trim();
    const body = (params.Body ?? "").trim().toLowerCase().replace(/[.!,;:]/g, "");

    if (!from) return twiml();

    // Comparaison sur le message entier, pas une inclusion : « je ne veux pas
    // stopper mes invitations » ne doit pas déclencher une désinscription.
    if (!STOP_KEYWORDS.includes(body)) {
      console.log("[sms-inbound] message entrant non-STOP, ignoré");
      return twiml();
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data, error } = await admin.rpc("sms_stop_unsubscribe", { _phone: from });

    if (error) {
      console.error("[sms-inbound] désinscription échouée", error);
      return twiml(500);
    }

    console.log(`[sms-inbound] STOP traité : ${data ?? 0} contact(s) désinscrit(s)`);
    return twiml();
  } catch (err) {
    console.error("[sms-inbound] erreur", err);
    return twiml(500);
  }
});
