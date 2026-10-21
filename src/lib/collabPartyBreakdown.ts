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

/** Un invité de la soirée (espace invité) : ce que ses liens et sa part de guest list ont amené. */
export interface GuestRow extends PartyFigures {
  id: string;
  name: string;
  kind: 'venue' | 'org';
  photo_url?: string | null;
  clicks: number;
}

export interface PartyBreakdown {
  ok: boolean;
  reason?: string;
  money: boolean;
  parties: PartyRow[];
  /** Compris dans `unattributed` côté serveur : invités, ventes venues de Yuno, ventes directes. */
  guests?: GuestRow[];
  yuno?: Partial<PartyFigures>;
  direct?: Partial<PartyFigures>;
  unattributed: PartyFigures;
  totals: PartyFigures;
}

const FIELDS = ['tickets', 'tables', 'table_guests', 'guests', 'entered'] as const;

/** Une ligne partielle (Yuno, Direct) complétée de zéros. */
export function fullFigures(f: Partial<PartyFigures> | undefined): PartyFigures {
  const out = { revenue: f?.revenue ?? null } as PartyFigures;
  for (const k of FIELDS) out[k] = f?.[k] ?? 0;
  return out;
}

/**
 * Ce qui reste « sans partenaire identifié » une fois les invités, Yuno et
 * Direct sortis du reste (le serveur les range tous dans `unattributed`).
 */
export function remainingUnattributed(b: Pick<PartyBreakdown, 'unattributed' | 'guests' | 'yuno' | 'direct' | 'money'>): PartyFigures {
  const parts = [...(b.guests ?? []), fullFigures(b.yuno), fullFigures(b.direct)];
  const out = { ...b.unattributed };
  for (const k of FIELDS) out[k] = Math.max(0, (b.unattributed[k] ?? 0) - parts.reduce((a, p) => a + (p[k] ?? 0), 0));
  out.revenue = b.money && b.unattributed.revenue != null
    ? Math.max(0, Math.round((b.unattributed.revenue - parts.reduce((a, p) => a + (p.revenue ?? 0), 0)) * 100) / 100)
    : b.unattributed.revenue;
  return out;
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
export function attributionCoverage(b: Pick<PartyBreakdown, 'totals' | 'unattributed' | 'guests'>): { known: number; total: number } {
  const total = peopleOf(b.totals);
  // Un invité de la soirée est un partenaire : son public compte comme rattaché.
  const guests = (b.guests ?? []).reduce((a, g) => a + peopleOf(g), 0);
  return { known: Math.min(total, Math.max(0, total - peopleOf(b.unattributed) + guests)), total };
}
