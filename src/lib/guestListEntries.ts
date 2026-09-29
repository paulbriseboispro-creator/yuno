import { supabase } from '@/integrations/supabase/client';

/**
 * Inscrits de guest list d'une soirée (ou d'un club), SANS jointure
 * `guest_lists!inner(...)`.
 *
 * POURQUOI : `guest_list_entries?select=…,guest_lists!inner(event_id)&
 * guest_lists.event_id=eq.X` se lit « toutes les lignes de la table, puis
 * leur liste ». La RLS de `guest_list_entries` n'étant pas leakproof, le
 * planificateur ne peut pas filtrer par la liste avant de l'évaluer : balayage
 * complet + politique ligne par ligne, 1,3 s mesurées sur ~3 000 lignes
 * (pg_stat_statements : 1 à 1,2 s de moyenne, 500 par délai dépassé dès que la
 * base est chargée). Lire d'abord les listes (index `event_id` / `venue_id`),
 * puis leurs inscrits par `guest_list_id` (index), prend quelques ms.
 *
 * Le résultat garde la forme de l'ancienne jointure : chaque ligne porte
 * `guest_lists` (les colonnes de liste demandées), pour que les appelants
 * n'aient rien d'autre à changer.
 */
type Row = Record<string, unknown>;

export async function fetchGuestListEntries<E extends Row, L extends Row>(opts: {
  eventIds?: string[];
  venueId?: string;
  /** Colonnes de `guest_lists` à rattacher (`id` est toujours lu). */
  listColumns: string;
  /** Colonnes de `guest_list_entries` (`guest_list_id` est ajouté si absent). */
  entryColumns: string;
  /** Écarter un statut (`'cancelled'`). */
  excludeStatus?: string;
  /** Ne garder que ces adresses. */
  emailIn?: string[];
}): Promise<{ data: (E & { guest_lists: L })[]; error: Error | null }> {
  const { eventIds, venueId, listColumns, entryColumns, excludeStatus, emailIn } = opts;
  if (!venueId && (!eventIds || eventIds.length === 0)) return { data: [], error: null };

  let lq = supabase.from('guest_lists').select(`id, ${listColumns}`);
  lq = venueId ? lq.eq('venue_id', venueId) : lq.in('event_id', eventIds!);
  const { data: lists, error: listError } = await lq;
  if (listError) return { data: [], error: listError as unknown as Error };
  const byId = new Map<string, L>();
  for (const l of (lists ?? []) as unknown as (L & { id: string })[]) byId.set(l.id, l);
  if (byId.size === 0) return { data: [], error: null };

  const cols = /\bguest_list_id\b/.test(entryColumns) ? entryColumns : `${entryColumns}, guest_list_id`;
  // Par paquets : l'historique d'un club peut compter des centaines de listes,
  // et un `in.(…)` trop long dépasse la taille d'URL acceptée.
  const ids = [...byId.keys()];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const results = await Promise.all(chunks.map((chunk) => {
    let eq = supabase.from('guest_list_entries').select(cols).in('guest_list_id', chunk);
    if (excludeStatus) eq = eq.neq('status', excludeStatus);
    if (emailIn) eq = eq.in('email', emailIn);
    return eq;
  }));
  const failed = results.find((r) => r.error);
  if (failed?.error) return { data: [], error: failed.error as unknown as Error };
  const entries = results.flatMap((r) => r.data ?? []);
  return {
    data: (entries as unknown as (E & { guest_list_id: string })[]).map((e) => ({
      ...e,
      guest_lists: byId.get(e.guest_list_id) as L,
    })),
    error: null,
  };
}
