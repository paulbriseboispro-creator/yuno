import { supabase } from '@/integrations/supabase/client';

/**
 * « Qui fait vendre ? » — lecture de `get_collab_party_breakdown` (migration
 * `20260929240000`). Le serveur attribue chaque vente ; le front ne fait que
 * mettre en forme : la part de public amenée par chacun et la couverture
 * (combien de ventes sont rattachées à un partenaire).
 */

export interface PartyFigures {
  clicks?: number;
  tickets: number;
  tables: number;
  table_guests: number;
  guests: number;
  entered: number;
  /** Absent (null) pour qui ne voit pas l'argent. */
  revenue: number | null;
}

export interface PartyRow extends PartyFigures {
  party: string;
  name: string;
  kind: 'venue' | 'org';
  role: 'lead' | 'partner' | 'cohost';
  avatar_url: string | null;
  mine: boolean;
  clicks: number;
}

export interface PartyBreakdown {
  ok: boolean;
  reason?: string;
  money: boolean;
  parties: PartyRow[];
  unattributed: PartyFigures;
  totals: PartyFigures;
}

export async function fetchPartyBreakdown(eventId: string): Promise<PartyBreakdown> {
  const { data, error } = await supabase.rpc('get_collab_party_breakdown' as never, { p_event_id: eventId } as never);
  if (error) throw error;
  return data as unknown as PartyBreakdown;
}

/** Le public qu'une ligne représente : billets + convives de table + inscrits guest list. */
export function peopleOf(f: Pick<PartyFigures, 'tickets' | 'table_guests' | 'guests'>): number {
  return (f.tickets || 0) + (f.table_guests || 0) + (f.guests || 0);
}

/** Part (0-100, entier) du public total amenée par une ligne ; null si la soirée n'a encore personne. */
export function shareOf(row: Pick<PartyFigures, 'tickets' | 'table_guests' | 'guests'>, totals: Pick<PartyFigures, 'tickets' | 'table_guests' | 'guests'>): number | null {
  const total = peopleOf(totals);
  if (total <= 0) return null;
  return Math.round((peopleOf(row) / total) * 100);
}

/** Combien de personnes sont rattachées à une partie, sur combien. */
export function attributionCoverage(b: Pick<PartyBreakdown, 'totals' | 'unattributed'>): { known: number; total: number } {
  const total = peopleOf(b.totals);
  return { known: Math.max(0, total - peopleOf(b.unattributed)), total };
}
