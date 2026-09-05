import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** Une ligne d'occupation : même forme que la lecture directe historique de
 *  table_reservations — la RPC get_event_table_availability renvoie exactement
 *  ces colonnes (une ligne par réservation active de l'event, SANS PII). */
interface AvailabilityRow {
  requested_table_id: string | null;
  assigned_table_id: string | null;
  placement_status: string | null;
  zone_id: string | null;
  status: string | null;
  pack_id?: string | null;
}

/**
 * Disponibilité des tables d'un event (plan public + checkout + panneaux pro).
 *
 * Source primaire : la RPC SECURITY DEFINER `get_event_table_availability`
 * (GRANT anon+authenticated). Sans elle, un visiteur ANON lisait
 * `table_reservations` en direct : aucune policy publique → 0 ligne → toutes
 * les tables paraissaient libres toute la nuit et deux clients pouvaient
 * acheter la même table.
 *
 * Fail-open OBLIGATOIRE : si la RPC échoue (pas encore migrée, réseau), on
 * retombe sur la lecture directe historique — comportement actuel, aucune
 * erreur visible. Le serveur (create-table-checkout) reste le juge final.
 */
export function useTableAvailability(eventId: string | undefined) {
  const [unavailableTableIds, setUnavailableTableIds] = useState<Set<string>>(new Set());
  /** Count of reservations where no table was requested (assign_on_arrival) — these still consume zone capacity */
  const [unplacedReservationCount, setUnplacedReservationCount] = useState(0);
  /** Number of active reservations per zone (pending/paid/confirmed). Used to enforce zone tables_count cap. */
  const [reservationsByZone, setReservationsByZone] = useState<Record<string, number>>({});
  /** Réservations actives par formule — sert le plafond `limit_tables` d'un pack. */
  const [reservationsByPack, setReservationsByPack] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }

    // Une seule logique de mapping, partagée entre la RPC et le repli direct
    // (mêmes colonnes) — toute divergence rendrait les deux chemins incohérents.
    const applyRows = (rows: AvailabilityRow[]) => {
      const ids = new Set<string>();
      const byZone: Record<string, number> = {};
      const byPack: Record<string, number> = {};
      let unplaced = 0;

      rows.forEach((r) => {
        // A table is unavailable if it's requested/approved/assigned
        if (r.requested_table_id && ['requested', 'approved'].includes(r.placement_status || '')) {
          ids.add(r.requested_table_id);
        }
        if (r.assigned_table_id) {
          ids.add(r.assigned_table_id);
        }
        // Count assign_on_arrival reservations (no specific table chosen — staff will assign)
        if (r.placement_status === 'assign_on_arrival' && !r.assigned_table_id) {
          unplaced++;
        }
        // Zone occupancy tracking — every active reservation eats one slot.
        if (r.zone_id) {
          byZone[r.zone_id] = (byZone[r.zone_id] || 0) + 1;
        }
        if (r.pack_id) {
          byPack[r.pack_id] = (byPack[r.pack_id] || 0) + 1;
        }
      });

      setUnavailableTableIds(ids);
      setUnplacedReservationCount(unplaced);
      setReservationsByZone(byZone);
      setReservationsByPack(byPack);
      setLoading(false);
    };

    // Lecture directe historique — ne rend des lignes que pour les rôles que la
    // RLS autorise (owner/orga/staff). Conservée comme repli fail-open.
    const fetchLegacyDirect = async () => {
      const { data } = await supabase
        .from('table_reservations')
        .select('requested_table_id, assigned_table_id, placement_status, guest_count, zone_id, status, pack_id')
        .eq('event_id', eventId)
        .in('status', ['pending', 'paid', 'confirmed']);
      applyRows((data || []) as AvailabilityRow[]);
    };

    const fetchAvailability = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('get_event_table_availability' as any, {
        p_event_id: eventId,
      });
      if (error) {
        // RPC absente (migration pas encore poussée) ou en échec → repli.
        await fetchLegacyDirect();
        return;
      }
      applyRows((data || []) as AvailabilityRow[]);
    };

    fetchAvailability();

    // Real-time subscription — BEST-EFFORT : la RLS ne délivre ces événements
    // qu'aux rôles pro (owner/orga/staff). Un visiteur anonyme ne recevra RIEN
    // par ce canal ; c'est le polling ci-dessous qui fait vivre le grisage.
    const channel = supabase
      .channel(`table-availability-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'table_reservations',
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          fetchAvailability();
        }
      )
      .subscribe();

    // Polling léger + refetch à la reprise de focus : garantit la fraîcheur
    // pour les anons (et rattrape tout raté realtime), sans marteler la RPC.
    const POLL_MS = 45_000;
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        fetchAvailability();
      }
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchAvailability();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [eventId]);

  return { unavailableTableIds, unplacedReservationCount, reservationsByZone, reservationsByPack, loading };
}
