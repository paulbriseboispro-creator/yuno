// Octopush — le fournisseur SMS de Yuno depuis le 2026-10-08.
// Étude : docs/designs/SMS_PROVIDER_PLAN.md. API : https://api.octopush.com/v1/public
// (en-têtes `api-key` + `api-login`, JSON).
//
// Ce que le reste du code doit savoir :
//   • Un appel envoie le MÊME texte à un lot de numéros et rend UN ticket
//     (`sms_ticket`) ; ses accusés de réception portent (ticket, numéro).
//   • `request_id` : Octopush refuse un identifiant déjà vu sous 24 h (erreur
//     182). C'est la deuxième ceinture anti-doublon, avec la réservation de la
//     file : une ligne reprise renvoie le même identifiant et ne repart pas.
//   • Les requêtes partent l'une après l'autre, jamais en parallèle (consigne
//     Octopush).
//   • Un message marketing (`purpose: wholesale`) sans « STOP au 30101 » est
//     refusé (121) : la composition l'ajoute toujours (sms-text.ts).
//   • Les webhooks n'ont ni signature ni liste d'IP : un jeton secret voyage
//     dans l'URL (`?t=`), comparé en temps constant.
//
// La partie pure (corps de requête, classement des erreurs, statuts, lecture
// des webhooks) est testée par src/lib/__tests__/smsOctopush.test.ts.

export const OCTOPUSH_API = "https://api.octopush.com/v1/public";
/** Lot maximal par appel (Octopush conseille 200 à 500). */
export const OCTOPUSH_BATCH = 200;

export interface OctopushConfig {
  apiKey: string;
  apiLogin: string;
  /** Envoi simulé (aucun SMS ne part, réponse factice) : premier branchement, recette. */
  simulation: boolean;
}

/** Secrets Supabase `OCTOPUSH_API_KEY` / `OCTOPUSH_API_LOGIN` (+ `OCTOPUSH_SIMULATION=1`). Null = SMS non configuré. */
export function octopushConfig(get: (k: string) => string | undefined): OctopushConfig | null {
  const apiKey = (get("OCTOPUSH_API_KEY") || "").trim();
  const apiLogin = (get("OCTOPUSH_API_LOGIN") || "").trim();
  if (!apiKey || !apiLogin) return null;
  return { apiKey, apiLogin, simulation: get("OCTOPUSH_SIMULATION") === "1" };
}

export interface OctopushSendArgs {
  phones: string[];
  text: string;
  sender: string;
  requestId: string;
  simulation?: boolean;
}

/** Corps de `POST /sms-campaign/send` : SMS premium (nom d'expéditeur, accusés), marketing, texte tel quel. */
export function buildOctopushSendBody(a: OctopushSendArgs): Record<string, unknown> {
  return {
    recipients: a.phones.map((p) => ({ phone_number: p })),
    text: a.text,
    type: "sms_premium",
    purpose: "wholesale",
    sender: a.sender,
    request_id: a.requestId,
    // Le texte part tel que le pro l'a vu : c'est lui qui fixe le nombre de SMS débités.
    auto_optimize_text: false,
    ...(a.simulation ? { simulation_mode: true } : {}),
  };
}

/**
 * Ce que fait le worker d'une erreur :
 *   - `campaign` : toute la campagne s'arrête (identifiants, compte, nom
 *     d'expéditeur, mention STOP, crédit Octopush épuisé…) — insister brûlerait
 *     des crédits pour rien ;
 *   - `batch`    : ce lot seulement (numéro refusé) ;
 *   - `duplicate`: le lot a DÉJÀ été accepté (request_id vu) — c'est un envoi ;
 *   - `retry`    : passager (réseau, 5xx, débit) — le lot retourne en file.
 */
export type OctopushErrorKind = "campaign" | "batch" | "duplicate" | "retry";

const CAMPAIGN_CODES = new Set(["104", "106", "107", "113", "121", "134", "139", "142", "189", "208", "1340", "1341"]);
const BATCH_CODES = new Set(["103", "181"]);

export function classifyOctopushError(code: string | number | null | undefined, http: number): OctopushErrorKind {
  const c = code == null ? "" : String(code);
  if (c === "182") return "duplicate";
  if (http === 0 || http === 429 || http >= 500 || c === "500" || c === "438") return "retry";
  if (http === 401 || http === 403 || c === "401" || c === "403") return "campaign";
  if (BATCH_CODES.has(c)) return "batch";
  if (CAMPAIGN_CODES.has(c)) return "campaign";
  // Code inconnu : on s'arrête plutôt que de brûler la file.
  return "campaign";
}

/** Le pro lit ce message dans le rapport de la campagne mise en pause. */
export function octopushErrorLabel(code: string): string {
  switch (code) {
    case "104": return "Le service d'envoi de Yuno n'a plus de crédit : l'équipe Yuno est prévenue.";
    case "106": return "Nom d'expéditeur refusé par l'opérateur : choisissez 3 à 11 lettres ou chiffres qui vous identifient.";
    case "113": return "Le compte d'envoi de Yuno est en cours de validation chez l'opérateur.";
    case "121": return "La mention STOP manque dans le message.";
    case "189": return "Message trop long.";
    case "1340": case "1341": return "Un mot du message ou du nom d'expéditeur est refusé par l'opérateur.";
    case "401": case "403": return "Le service d'envoi refuse l'accès : l'équipe Yuno est prévenue.";
    default: return `Refus du service d'envoi (code ${code}).`;
  }
}

export type OctopushSendOutcome =
  | { ok: true; ticket: string | null; contacts: number; costEur: number | null; duplicate: boolean }
  | { ok: false; kind: Exclude<OctopushErrorKind, "duplicate">; code: string; message: string; status: number };

/** Envoie un lot. Ne lève jamais : toute panne devient un résultat classé. */
export async function sendOctopushBatch(
  cfg: OctopushConfig,
  a: Omit<OctopushSendArgs, "simulation">,
  fetchImpl: typeof fetch = fetch,
): Promise<OctopushSendOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(`${OCTOPUSH_API}/sms-campaign/send`, {
      method: "POST",
      headers: { "api-key": cfg.apiKey, "api-login": cfg.apiLogin, "Content-Type": "application/json", "cache-control": "no-cache" },
      body: JSON.stringify(buildOctopushSendBody({ ...a, simulation: cfg.simulation })),
    });
  } catch (e) {
    return { ok: false, kind: "retry", code: "network", message: e instanceof Error ? e.message : String(e), status: 0 };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok && (data.sms_ticket || cfg.simulation)) {
    return {
      ok: true,
      ticket: data.sms_ticket ? String(data.sms_ticket) : null,
      contacts: Number(data.number_of_contacts ?? a.phones.length),
      costEur: data.total_cost == null ? null : Number(data.total_cost),
      duplicate: false,
    };
  }
  const code = String(data.code ?? res.status);
  const kind = classifyOctopushError(code, res.status);
  if (kind === "duplicate") return { ok: true, ticket: null, contacts: a.phones.length, costEur: null, duplicate: true };
  return { ok: false, kind, code, message: String(data.message ?? `Octopush HTTP ${res.status}`).slice(0, 400), status: res.status };
}

// ── Accusés de réception et webhooks ────────────────────────────────────────

export type SmsDeliveryStatus = "sent" | "delivered" | "undelivered" | "failed";

/**
 * Statut Octopush → statut Yuno. `failed` = jamais parti (remboursé) ; un
 * `undelivered` a été remis à l'opérateur et facturé (jamais remboursé).
 * `BLACKLISTED_NUMBER` = le numéro a dit STOP chez Octopush : jamais parti.
 */
export function mapOctopushStatus(status: string | null | undefined): SmsDeliveryStatus | null {
  switch ((status || "").trim().toUpperCase()) {
    case "ACK": return "sent";
    case "DELIVERED": return "delivered";
    case "NOT_DELIVERED": case "EXPIRED": case "UNKNOWN_DELIVERY": case "BAD_DESTINATION":
    case "NOT_ALLOWED": case "ANTI_FLOODING": case "UNDEFINED":
      return "undelivered";
    case "BLACKLISTED_NUMBER": return "failed";
    default: return null;
  }
}

export type OctopushCallback =
  | { kind: "dlr"; messageId: string; phone: string; status: SmsDeliveryStatus | null; raw: string; blacklisted: boolean }
  | { kind: "stop"; phone: string }
  | { kind: "inbound"; phone: string; text: string };

const str = (v: unknown) => (v == null ? "" : String(v)).trim();

/** Numéro d'un webhook en E.164 (Octopush envoie « +33600112233 », parfois sans « + »). */
export function callbackPhone(v: unknown): string {
  const raw = str(v);
  if (!raw) return "";
  const digits = raw.replace(/[^0-9]/g, "");
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0") && digits.length === 10) return `+33${digits.slice(1)}`;
  return `+${digits}`;
}

/** Lit un webhook Octopush (JSON ou formulaire, déjà converti en objet). `k` = le type posé dans l'URL. */
export function parseOctopushCallback(k: string | null, body: Record<string, unknown>): OctopushCallback | null {
  const phone = callbackPhone(body.number ?? body.phone_number);
  if (!/^\+[1-9][0-9]{6,14}$/.test(phone)) return null;
  const kind = k || (body.status != null ? "dlr" : body.stop_date != null ? "stop" : "inbound");
  if (kind === "dlr") {
    const raw = str(body.status).toUpperCase();
    const messageId = str(body.message_id ?? body.sms_ticket);
    if (!messageId) return null;
    return { kind: "dlr", messageId, phone, status: mapOctopushStatus(raw), raw, blacklisted: raw === "BLACKLISTED_NUMBER" };
  }
  if (kind === "stop") return { kind: "stop", phone };
  if (kind === "inbound") return { kind: "inbound", phone, text: str(body.text) };
  return null;
}

/** Comparaison en temps constant du jeton des webhooks. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Identifiant d'envoi stable d'un lot : même campagne + mêmes lignes = même identifiant. */
export async function batchRequestId(campaignId: string, rowIds: string[]): Promise<string> {
  const data = new TextEncoder().encode(`${campaignId}:${[...rowIds].sort().join(",")}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return `y-${Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
