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
