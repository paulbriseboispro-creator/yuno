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
  /**
   * Ce que couvre le remboursement : une place, les places encore libres d'un
   * billet dont un ami est déjà entré, ou la commande entière.
   */
  scope: 'place' | 'remaining' | 'order';
  /** Places du billet (nominatives), ou billets de la commande. */
  places: number;
  /** Personnes que couvre CE remboursement (1 pour une place, les places libres, ou la commande). */
  count: number;
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
  count?: number;
  scope?: 'place' | 'remaining' | 'order';
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
      scope: data.scope ?? (data.placeRefund ? 'place' : 'order'),
      places: Math.max(1, Number(data.places ?? 1)),
      count: Math.max(1, Number(data.count ?? data.places ?? 1)),
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

/** Places nominatives d'un billet, telles que la porte les voit. */
export interface TicketPlaces {
  total: number;
  /** Ni entrées avec leur QR, ni remboursées : ce que le QR du billet entier fait encore entrer. */
  remaining: number;
  entered: number;
  refunded: number;
}

/**
 * Les places d'un billet de plusieurs personnes. Lecture TOLÉRANTE : `null` si
 * le billet est d'une personne (son QR suffit, aucun aller-retour de plus à
 * chaque scan), s'il n'a pas de places, ou si la lecture échoue — la porte
 * retombe alors sur le billet seul, comme avant.
 */
export async function ticketPlacesOf(ticketId: string, quantity: number | null | undefined): Promise<TicketPlaces | null> {
  if (!(Number(quantity) > 1)) return null;
  const { data, error } = await supabase
    .from('ticket_attendees').select('entry_scanned, refunded_at').eq('ticket_id', ticketId);
  if (error || !data || data.length === 0) return null;
  const refunded = data.filter(p => !!p.refunded_at).length;
  const entered = data.filter(p => !p.refunded_at && !!p.entry_scanned).length;
  return { total: data.length, remaining: data.length - refunded - entered, entered, refunded };
}

/**
 * Le QR du billet entier fait entrer les places encore libres : chaque place
 * passe « entrée » (premier scan gagne, place par place), le billet parent est
 * marqué par ricochet. Rend le nombre de personnes admises (0 = un collègue
 * vient de les faire entrer). La base refuse de toute façon une place remboursée.
 */
export async function enterRemainingPlaces(ticketId: string, by: string | null): Promise<number> {
  const { data, error } = await supabase
    .from('ticket_attendees')
    .update({ entry_scanned: true, entry_scanned_at: new Date().toISOString(), entry_scanned_by: by })
    .eq('ticket_id', ticketId)
    .eq('entry_scanned', false)
    .is('refunded_at', null)
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Réponse perdue sur le wifi du club : les places de ce billet que J'AI fait
 * entrer il y a moins d'une minute (le renvoi tombe sinon sur « déjà scanné »).
 */
export async function placesEnteredByMeJustNow(ticketId: string, me: string | null): Promise<number> {
  if (!me) return 0;
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await supabase
    .from('ticket_attendees')
    .select('id', { count: 'exact', head: true })
    .eq('ticket_id', ticketId)
    .eq('entry_scanned_by', me)
    .gte('entry_scanned_at', since);
  return error ? 0 : count ?? 0;
}
