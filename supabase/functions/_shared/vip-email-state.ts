// Quel e-mail de table VIP peut partir pour quel état de réservation (I3 de la relecture) : une annonce qui ment sur l'état
// — « ta table est annulée et remboursée » sur une table payée, « confirmée » avec QR sur une table impayée — ne part JAMAIS.
// PUR et SANS IMPORT : testé par src/lib/__tests__/vipEmailState.test.ts, lu par send-vip-confirmation.

export type VipEmailKind =
  | "request_received" | "confirmed" | "modified" | "table_changed"
  | "cancelled_refunded" | "cancelled" | "walkin_summary";

export interface VipEmailReservation {
  status?: string | null;
  refund_amount?: number | string | null;
  refund_reason?: string | null;
}

const ACTIVE = ["paid", "confirmed"];

/**
 * - confirmed / table_changed / modified / walkin_summary : la réservation est active (payée ou confirmée) ;
 * - request_received : pas encore annulée ni remboursée (une pending d'un ancien flux) ;
 * - cancelled_refunded : remboursée — ou, le temps que le statut suive (owner-refund pose le remboursement AVANT de passer la
 *   vente en « refunded », le webhook charge.refunded rattrape en cas d'échec), un remboursement d'annulation déjà enregistré ;
 * - cancelled : annulée sans paiement.
 */
export function vipEmailStateOk(type: VipEmailKind, r: VipEmailReservation): boolean {
  const status = String(r.status ?? "");
  switch (type) {
    case "confirmed":
    case "table_changed":
    case "modified":
    case "walkin_summary":
      return ACTIVE.includes(status);
    case "request_received":
      return status === "pending" || ACTIVE.includes(status);
    case "cancelled_refunded":
      return status === "refunded"
        || (ACTIVE.includes(status) && r.refund_reason === "cancelled_by_organizer" && Number(r.refund_amount) > 0);
    case "cancelled":
      return status === "cancelled";
    default:
      return false;
  }
}
