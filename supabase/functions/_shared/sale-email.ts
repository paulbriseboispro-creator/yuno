// Suivi de livraison des e-mails de vente : billet, table VIP, guest list.
//
// Chaque e-mail qui porte une place (QR, référence) part avec deux tags Resend,
// `sale_kind` et `sale_id`. resend-webhook les relit et appelle
// `record_sale_email_event` : un rebond dur se rattache à CETTE vente, et les
// parties qui mènent la soirée sont prévenues avec le nom et le téléphone de la
// personne (migrations 20261105100000 et 20261105300000).
//
// L'envoi s'enregistre ici, après la réponse de Resend : la base garde la
// dernière adresse écrite, et un événement qui en porte une autre (retard d'un
// ancien envoi) ne touche rien.

import type { RpcClient } from "./rpc-client.ts";

export type SaleEmailKind = "ticket" | "table" | "guest_list";

/** Tags Resend d'un e-mail de vente (valeurs ASCII : un uuid, un mot). */
export function saleEmailTags(kind: SaleEmailKind, saleId: string): Array<{ name: string; value: string }> {
  return [{ name: "sale_kind", value: kind }, { name: "sale_id", value: saleId }];
}

/** Id Resend d'une réponse d'envoi réussie, sinon null. */
export async function resendEmailId(res: Response): Promise<string | null> {
  try {
    const body = await res.json() as { id?: unknown };
    return typeof body?.id === "string" ? body.id : null;
  } catch {
    return null;
  }
}

/**
 * L'e-mail vient de partir. Best-effort : il est déjà parti, une panne du suivi
 * ne doit jamais faire échouer l'envoi qui l'appelle.
 */
export async function recordSaleEmailSent(
  admin: RpcClient,
  kind: SaleEmailKind,
  saleId: string,
  email: string,
  emailId: string | null,
): Promise<void> {
  try {
    const { error } = await admin.rpc("record_sale_email_sent", {
      p_kind: kind, p_sale_id: saleId, p_email: email, p_resend_email_id: emailId,
    });
    if (error) console.error(`[sale-email] record_sale_email_sent (${kind}):`, error);
  } catch (e) {
    console.error(`[sale-email] record_sale_email_sent (${kind}):`, e);
  }
}

// ── File des e-mails de vente (D6, migration 20261226100000) ───────────────────────────────────────────────────────────
// Resend reste gratuit : quand il refuse un e-mail de vente (429 quota, 5xx, délai), la vente entre dans `sale_email_queue`,
// rejouée par process-scheduled-campaigns (+15 min, +1 h, demain 8 h Paris) avec une alerte super admin par jour. Le rejeu
// rappelle la même fonction avec l'en-tête ci-dessous : elle ne remet alors RIEN en file (le passage compte les échecs).

/** En-tête posé par le rejeu (clé service) : en cas d'échec, la fonction rend 503 au lieu de remettre en file. */
export const SALE_EMAIL_REPLAY_HEADER = "x-sale-email-replay";

export function isSaleEmailReplay(req: Request): boolean {
  return req.headers.get(SALE_EMAIL_REPLAY_HEADER) === "1";
}

/**
 * Un refus de Resend vaut-il un nouvel essai plus tard ? Quota (429, message de quota), panne (5xx). Une erreur de
 * validation (adresse invalide, 4xx) ne se corrige pas en attendant : elle reste une erreur.
 */
export function isRetryableResend(status: number, bodyText: string): boolean {
  if (status === 429 || status >= 500) return true;
  return /quota|rate.?limit|too many requests/i.test(bodyText);
}

/** Erreur réseau / délai d'un appel à Resend (jamais une réponse HTTP). */
export function isResendNetworkError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "TimeoutError" || name === "AbortError" || e instanceof TypeError;
}

/**
 * Met la vente en file pour un nouvel essai. Best-effort : si la mise en file échoue, l'appelant rend l'erreur d'origine.
 * Rend true si la ligne est en file (false pour la démo, que la base écarte, ou en cas de panne).
 */
export async function enqueueSaleEmail(
  admin: RpcClient,
  kind: "ticket" | "table",
  saleId: string,
  emailType: string,
  payload: Record<string, unknown>,
  error: string,
): Promise<boolean> {
  try {
    const { data, error: rpcError } = await admin.rpc("enqueue_sale_email", {
      p_kind: kind, p_sale_id: saleId, p_email_type: emailType, p_payload: payload, p_error: error.slice(0, 500),
    });
    if (rpcError) { console.error(`[sale-email] enqueue_sale_email (${kind}):`, rpcError); return false; }
    return typeof data === "string" && data.length > 0;
  } catch (e) {
    console.error(`[sale-email] enqueue_sale_email (${kind}):`, e);
    return false;
  }
}
