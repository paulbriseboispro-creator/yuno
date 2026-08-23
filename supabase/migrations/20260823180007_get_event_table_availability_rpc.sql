-- ============================================================================
-- P0 TABLES — RPC publique de disponibilité des tables d'une soirée.
--
-- Trou : le plan de salle public (src/hooks/useTableAvailability.ts) lit
-- table_reservations avec la clé anon. Aucune policy SELECT publique n'existe
-- sur cette table → 0 ligne → toutes les tables paraissent libres toute la
-- nuit, la collision n'apparaît qu'au paiement.
--
-- Correctif : une RPC SECURITY DEFINER qui rend LE STRICT NÉCESSAIRE, sans la
-- moindre PII (aucun nom, email, téléphone, montant, Stripe id, QR). Le shape
-- reprend exactement les colonnes que le hook consomme aujourd'hui
-- (`requested_table_id, assigned_table_id, placement_status, guest_count,
-- zone_id, status`) pour que le front bascule de `.from('table_reservations')`
-- à `.rpc('get_event_table_availability', { p_event_id })` sans autre
-- changement de logique. Les ids de table sont rendus en TEXT : ils se
-- comparent aux ids du plan de salle (venue_floor_plans.layout.tables — pas de
-- FK, ids texte au format uuid).
--
-- Périmètre « réservation active » :
--   • status 'paid' (statut métier de référence) et 'confirmed' (valeur legacy
--     jamais écrite aujourd'hui, conservée par parité avec le hook et les
--     verrous serveur reserve_table_slot / create_manual_table_reservation) ;
--   • 'pending' créé il y a moins de 30 minutes — le cron
--     cleanup-pending-purchases (*/15) supprime les pending > 30 min, donc un
--     pending frais = table tenue par un checkout en cours ;
--   • 'refunded' / 'cancelled' n'apparaissent jamais.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_event_table_availability(p_event_id uuid)
RETURNS TABLE (
  requested_table_id text,
  assigned_table_id  text,
  placement_status   text,
  guest_count        integer,
  zone_id            uuid,
  status             text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tr.requested_table_id::text,
    tr.assigned_table_id::text,
    tr.placement_status,
    tr.guest_count,
    tr.zone_id,
    tr.status
  FROM public.table_reservations tr
  WHERE tr.event_id = p_event_id
    AND (
      tr.status IN ('paid', 'confirmed')
      OR (tr.status = 'pending' AND tr.created_at > now() - interval '30 minutes')
    );
$$;

REVOKE ALL ON FUNCTION public.get_event_table_availability(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_table_availability(uuid) TO anon, authenticated;
