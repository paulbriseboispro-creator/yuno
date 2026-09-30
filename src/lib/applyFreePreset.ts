import { supabase } from '@/integrations/supabase/client';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { DEFAULT_EVENT_TZ, freePresetToRoundRows, normalizeFreePreset } from '@/lib/freeTicketing';

/**
 * Pose un modèle de billetterie LIBRE sur une soirée — porte unique des trois
 * écrans qui appliquent un modèle (Billetterie, Soirées, dialogue Billetterie
 * orga) ; les séries récurrentes font la même chose côté serveur
 * (create-owner-recurring-events).
 *
 * Les dates du modèle (J-N à HH:MM) sont recalculées sur la date de CETTE
 * soirée. Les billets sans vente sont remplacés ; un billet déjà vendu reste
 * en place et les nouveaux se rangent après lui.
 */
export async function applyFreePreset(
  eventId: string,
  rawTickets: unknown,
  totalCapacity: number | null | undefined,
  extraEventUpdate: TablesUpdate<'events'> = {},
): Promise<void> {
  const tickets = normalizeFreePreset(rawTickets);
  const [{ data: event, error: evReadErr }, { data: existing, error: roundsErr }] = await Promise.all([
    supabase.from('events').select('start_at, timezone').eq('id', eventId).single(),
    supabase.from('ticket_rounds').select('id, tickets_sold, position').eq('event_id', eventId),
  ]);
  if (evReadErr || !event) throw evReadErr ?? new Error('Event not found');
  if (roundsErr) throw roundsErr;

  const removable = (existing ?? []).filter((r) => (r.tickets_sold ?? 0) === 0).map((r) => r.id);
  if (removable.length > 0) {
    const { error } = await supabase.from('ticket_rounds').delete().in('id', removable);
    if (error) throw error;
  }
  const kept = (existing ?? []).filter((r) => (r.tickets_sold ?? 0) > 0);
  const start = kept.length > 0 ? Math.max(...kept.map((r) => r.position)) + 1 : 0;
  const rows = freePresetToRoundRows(tickets, eventId, event.start_at, event.timezone || DEFAULT_EVENT_TZ, start);
  if (rows.length > 0) {
    const { error } = await supabase.from('ticket_rounds').insert(rows);
    if (error) throw error;
  }

  const update: TablesUpdate<'events'> = { ...extraEventUpdate, ticket_selling_mode: 'free' };
  if (totalCapacity && totalCapacity > 0) update.max_tickets = totalCapacity;
  const { error: evErr } = await supabase.from('events').update(update).eq('id', eventId);
  if (evErr) throw evErr;
}
