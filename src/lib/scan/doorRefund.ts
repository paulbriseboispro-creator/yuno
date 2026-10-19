import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

/**
 * Remboursement décidé À LA PORTE (hors créneau refusé, onglet Annuler), le
 * même pour l'app Yuno Pro (Bouncer) et le scan web de l'organisateur
 * (OrgAppCheckin). Le montant n'est jamais calculé ici : staff-cancel le
 * calcule (`_shared/sale-refund.ts`) et le rend d'abord en aperçu, pour que le
 * bouton annonce exactement ce qui partira.
 *
 * Un QR nominatif (`ticket_attendee`, un ami nommé à l'achat) ne rembourse que
 * SA place ; le QR du billet entier rembourse la commande entière.
 */
export interface DoorRefundTarget {
  kind: 'ticket_attendee' | 'ticket';
  /** Id de la place (`ticket_attendees.id`) ou du billet (`tickets.id`). */
  id: string;
}

export interface DoorRefundPreview {
  /** Ce qui sera rendu au client, en euros. */
  amount: number;
  /** Une seule place d'un billet nominatif. */
  placeRefund: boolean;
  /** Places du billet (nominatives), ou billets de la commande. */
  places: number;
}

export interface DoorRefundResult {
  refundAmount: number;
  placeRefund: boolean;
  /** Stripe a refusé : rien n'est parti, le super admin est prévenu. */
  refundFailed: boolean;
  /** La dernière place a été remboursée : tout le billet l'est. */
  ticketFullyRefunded: boolean;
}

/** Refus de staff-cancel, avec son code stable quand il en a un (place déjà entrée, déjà remboursée…). */
export class DoorRefundError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

interface StaffCancelBody {
  success?: boolean;
  error?: string;
  code?: string;
  refundAmount?: number;
  placeRefund?: boolean;
  places?: number;
  refundFailed?: boolean;
  ticketFullyRefunded?: boolean;
}

async function callStaffCancel(body: Record<string, unknown>): Promise<StaffCancelBody> {
  const { data, error } = await invokeEdgeFunction<StaffCancelBody>('staff-cancel', { body });
  if (error || !data || data.success === false || data.error) {
    throw new DoorRefundError(data?.error || error?.message || 'staff-cancel failed', data?.code);
  }
  return data;
}

/** Montant exact que la porte rendrait, sans rien écrire. `null` si le serveur ne répond pas. */
export async function fetchDoorRefundPreview(target: DoorRefundTarget): Promise<DoorRefundPreview | null> {
  try {
    // Type à part : une fonction pas encore redéployée le refuse au lieu de rembourser.
    const data = await callStaffCancel({ type: 'refund_preview', target: target.kind, id: target.id });
    return {
      amount: Number(data.refundAmount ?? 0),
      placeRefund: data.placeRefund === true,
      places: Math.max(1, Number(data.places ?? 1)),
    };
  } catch {
    return null;
  }
}

/** Rembourse (et invalide) la place ou le billet. Lève `DoorRefundError` sur un refus. */
export async function refundAtDoor(
  target: DoorRefundTarget,
  opts: { reason: string; banCustomer?: boolean },
): Promise<DoorRefundResult> {
  const data = await callStaffCancel({
    type: target.kind,
    id: target.id,
    reason: opts.reason,
    banCustomer: opts.banCustomer ?? false,
  });
  return {
    refundAmount: Number(data.refundAmount ?? 0),
    placeRefund: data.placeRefund === true,
    refundFailed: data.refundFailed === true,
    ticketFullyRefunded: data.ticketFullyRefunded === true,
  };
}

/** Clé de dictionnaire d'un refus connu (`bouncer.refusal.<code>`), sinon null. */
export function doorRefusalKey(err: unknown): string | null {
  const code = err instanceof DoorRefundError ? err.code : undefined;
  return code && ['already_scanned', 'already_refunded', 'stale', 'not_paid'].includes(code)
    ? `bouncer.refusal.${code}`
    : null;
}

/**
 * La place nominative a-t-elle été remboursée seule à la porte ? Lecture
 * TOLÉRANTE : `false` si elle échoue (réseau, base pas encore migrée) — le scan
 * ne tombe jamais pour elle, et la base refuse de toute façon l'entrée d'une
 * place remboursée (`guard_ticket_attendee_place` : la mise à jour rend 0 ligne).
 */
export async function isPlaceRefunded(attendeeId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('ticket_attendees').select('refunded_at').eq('id', attendeeId).maybeSingle();
  return !error && !!data?.refunded_at;
}

/**
 * Places d'un billet déjà remboursées une à une : le QR du billet entier ne les
 * fait plus entrer. Lecture tolérante (0 si elle échoue), et seulement pour un
 * billet de plusieurs places — un billet d'une place n'a rien à retirer, la
 * porte ne paie pas un aller-retour de plus à chaque scan.
 */
export async function refundedPlacesCount(ticketId: string, quantity: number | null | undefined): Promise<number> {
  if (!(Number(quantity) > 1)) return 0;
  const { count, error } = await supabase
    .from('ticket_attendees')
    .select('id', { count: 'exact', head: true })
    .eq('ticket_id', ticketId)
    .not('refunded_at', 'is', null);
  return error ? 0 : count ?? 0;
}
