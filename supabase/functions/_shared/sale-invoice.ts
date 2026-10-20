// Facture d'une vente payée — la porte unique des verify-*.
//
// Le numéro est attribué par la BASE (`issue_sale_invoice`, puis le trigger
// `assign_invoice_number`) : une suite continue par vendeur, sous verrou,
// jamais un numéro fabriqué ici. Une émission qui échoue n'arrête jamais la
// vente (le billet est payé, il part), mais elle ne se tait plus : une alerte
// super admin `admin_invoice_failed`, une par vente, et le rattrapage horaire
// `issue_missing_invoices` réessaie avec la même clé d'alerte.

import type { RpcClient } from "./rpc-client.ts";

export type SaleInvoiceKind = "ticket" | "table" | "order";

export interface SaleInvoiceRef {
  kind: SaleInvoiceKind;
  id: string;
  /** Soirée de la vente, pour ouvrir l'alerte au bon endroit. */
  eventId?: string | null;
}

/** Arguments de `issue_sale_invoice` : exactement une vente renseignée. */
export function saleInvoiceArgs(sale: SaleInvoiceRef): Record<string, string | null> {
  return {
    p_ticket_id: sale.kind === "ticket" ? sale.id : null,
    p_table_reservation_id: sale.kind === "table" ? sale.id : null,
    p_order_id: sale.kind === "order" ? sale.id : null,
  };
}

/** Texte lisible d'une erreur PostgREST, d'une exception ou d'autre chose. */
export function invoiceErrorText(error: unknown): string {
  if (!error) return "unknown_error";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const e = error as { message?: unknown; code?: unknown; details?: unknown };
    const parts = [e.message, e.code, e.details].filter((p) => typeof p === "string" && p);
    if (parts.length) return parts.join(" · ");
  }
  return String(error);
}

/**
 * Alerte super admin d'une facture non émise. Même clé que le rattrapage SQL
 * (`invoice_failed:<vente>`) : une seule alerte par vente, quel que soit le
 * chemin qui a échoué en premier.
 */
export function invoiceFailureAlert(sale: SaleInvoiceRef, error: unknown, source: string) {
  const text = invoiceErrorText(error);
  return {
    p_type: "admin_invoice_failed",
    p_title: "Vente payée sans facture",
    p_message: `La facture de la vente ${sale.kind} ${sale.id} n'a pas pu être émise : ${text}. Le rattrapage horaire réessaie ; à vérifier si l'alerte reste.`.slice(0, 480),
    p_priority: "high",
    p_reference_type: sale.kind,
    p_reference_id: sale.id,
    p_metadata: { kind: sale.kind, sale_id: sale.id, error: text, source },
    p_dedup_key: `invoice_failed:${sale.kind}:${sale.id}`,
    p_event_id: sale.eventId ?? null,
  };
}

/**
 * Émet la facture de la vente et rend son numéro, ou `null` si elle n'a pas pu
 * l'être (alerte posée). Ne lève jamais.
 */
export async function issueSaleInvoice(
  client: RpcClient,
  sale: SaleInvoiceRef,
  source: string,
): Promise<string | null> {
  let failure: unknown = null;
  try {
    const { data, error } = await client.rpc("issue_sale_invoice", saleInvoiceArgs(sale));
    if (!error && typeof data === "string" && data) return data;
    failure = error ?? "no_invoice_number";
  } catch (e) {
    failure = e;
  }

  console.error("[sale-invoice] invoice not issued", { sale, error: invoiceErrorText(failure) });
  try {
    await client.rpc("emit_admin_notification", invoiceFailureAlert(sale, failure, source));
  } catch (e) {
    console.error("[sale-invoice] alert not emitted", invoiceErrorText(e));
  }
  return null;
}
