import { supabase } from '@/integrations/supabase/client';

/**
 * Porte d'une table à tickets d'invités (table_reservation_guests). Les règles
 * sont en base : la garde refuse l'invité d'une réservation non payée, et le
 * premier invité entré marque la réservation (arrivée, hôte VIP prévenu une
 * fois). Ici, seulement les lectures et les écritures conditionnelles de la porte.
 */

export interface TableGuestRow {
  id: string;
  reservation_id: string;
  guest_number: number;
  full_name: string | null;
  entry_scanned: boolean;
  entry_scanned_at: string | null;
}

/** Le ticket d'une personne d'une table, par son QR (null = ce n'est pas un ticket de table). */
export async function findTableGuestByQr(qr: string, signal?: AbortSignal): Promise<TableGuestRow | null> {
  const query = supabase
    .from('table_reservation_guests')
    .select('id, reservation_id, guest_number, full_name, entry_scanned, entry_scanned_at')
    .eq('qr_code', qr);
  const { data, error } = await (signal ? query.abortSignal(signal) : query).maybeSingle();
  if (error) {
    // Table pas encore créée (base pas à jour) : ce QR n'est pas un ticket de table.
    if (error.code === 'PGRST205' || error.code === '42P01') return null;
    throw error;
  }
  return data;
}

/** Tickets d'une réservation : combien en tout, combien encore dehors (null = aucun ticket). */
export async function tableGuestsOf(reservationId: string, signal?: AbortSignal): Promise<{ total: number; remaining: number } | null> {
  const query = supabase
    .from('table_reservation_guests')
    .select('entry_scanned')
    .eq('reservation_id', reservationId);
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return { total: data.length, remaining: data.filter((g) => !g.entry_scanned).length };
}

/** Une personne entre (premier scan gagne). Rend 1 si c'est ce scan qui l'a fait entrer. */
export async function enterTableGuest(guestId: string, signal?: AbortSignal): Promise<number> {
  const query = supabase
    .from('table_reservation_guests')
    .update({ entry_scanned: true })
    .eq('id', guestId)
    .eq('entry_scanned', false)
    .select('id');
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return data?.length ?? 0;
}

/** QR de la réservation : toutes les personnes encore dehors entrent. Rend le nombre entré. */
export async function enterRemainingTableGuests(reservationId: string, signal?: AbortSignal): Promise<number> {
  const query = supabase
    .from('table_reservation_guests')
    .update({ entry_scanned: true })
    .eq('reservation_id', reservationId)
    .eq('entry_scanned', false)
    .select('id');
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Réponse perdue sur le wifi du club : les personnes de cette table que J'AI fait
 * entrer il y a moins d'une minute (le renvoi tombe sinon sur « déjà scanné »).
 * Avec `guestId`, seulement ce ticket-là.
 */
export async function tableGuestsEnteredByMeJustNow(
  reservationId: string,
  me: string | null,
  guestId?: string,
): Promise<number> {
  if (!me) return 0;
  const since = new Date(Date.now() - 60_000).toISOString();
  let query = supabase
    .from('table_reservation_guests')
    .select('id', { count: 'exact', head: true })
    .eq('reservation_id', reservationId)
    .eq('entry_scanned_by', me)
    .gte('entry_scanned_at', since);
  if (guestId) query = query.eq('id', guestId);
  const { count, error } = await query;
  return error ? 0 : count ?? 0;
}
