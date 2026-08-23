-- ============================================================================
-- P0 SÉCURITÉ — Réservation de table VIP forgeable par un client connecté
--
-- Trou : la policy INSERT "Users can create reservations" (20251212094745)
-- n'exige que `auth.uid() = user_id`. Un compte client peut donc insérer via
-- PostgREST une ligne `status='paid', total_price=0, paid_at=now()` qui
-- s'affiche « payée » côté app et se scanne à la porte comme une vraie table.
-- Vérifié en prod le 2026-08-23 : WITH CHECK = (auth.uid() = user_id), aucune
-- contrainte de statut.
--
-- Correctif en deux temps, calqué sur le durcissement d'orders
-- (20260615170000_harden_drinks_orders_credits_rls) :
--   1. INSERT : un client ne peut créer qu'une réservation PENDING, sans
--      paid_at ni scan d'entrée pré-posés.
--   2. UPDATE : trigger d'immuabilité des champs financiers/identité pour les
--      rôles client (`current_user IN ('authenticated','anon')`), en
--      SECURITY INVOKER — même mécanique que protect_order_immutable_fields
--      et que les gardes promoteur : un trigger de garde qui discrimine sur
--      current_user ne doit JAMAIS être SECURITY DEFINER (il s'exécuterait
--      sous son propriétaire et se désactiverait lui-même).
--
-- Chemins légitimes préservés (tous vérifiés) :
--   • create-table-checkout / verify-table-payment / stripe webhook / owner-refund
--     tournent en service_role → current_user = 'service_role', exempté.
--   • reserve_table_slot et create_manual_table_reservation (walk-in) sont
--     SECURITY DEFINER → s'exécutent sous le propriétaire (postgres), exemptés
--     de la policy INSERT et du trigger.
--   • Écritures client-side du staff (toutes recensées dans src/) : owner
--     placement (placement_*, assigned_table_id, placement_note/reviewed_*),
--     owner minimum_spend (OwnerTableDetailSheet), hôte VIP (vip_status,
--     assigned_table_id, placed_at/by, finished_at — déjà bornées par
--     trg_enforce_vip_host_reservation_columns), videur + organisateur check-in
--     (entry_scanned, entry_scanned_at/by, checked_in_at). AUCUN de ces champs
--     n'est dans la liste immuable ci-dessous.
--   • Le front n'écrit JAMAIS table_reservations.status (le refus videur passe
--     par vip_status='denied', le no-show par vip_status='no_show') : status
--     peut donc être totalement immuable pour les rôles client. Le statut
--     métier reste 'pending' → 'paid' (webhook) → 'refunded' (owner-refund).
-- ============================================================================

-- 1. INSERT client : pending uniquement, jamais pré-payée ni pré-scannée.
DROP POLICY IF EXISTS "Users can create reservations" ON public.table_reservations;
CREATE POLICY "Users can create reservations"
  ON public.table_reservations FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
    AND paid_at IS NULL
    AND entry_scanned IS NOT TRUE
    AND refunded_at IS NULL
  );

-- 2. UPDATE : champs financiers/identité immuables pour les rôles client.
--    Deny-list volontaire (mêmes champs que la classe protégée d'orders,
--    étendue au périmètre VIP). Les champs de service opérés par le staff
--    depuis l'app (placement, vip_status, scan d'entrée, minimum_spend,
--    coordonnées invité, remarques) restent libres — ils sont déjà bornés par
--    les policies par rôle et par le garde-fou hôte VIP existant.
CREATE OR REPLACE FUNCTION public.protect_table_reservation_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.status                      IS DISTINCT FROM OLD.status
       OR NEW.total_price              IS DISTINCT FROM OLD.total_price
       OR NEW.service_fee              IS DISTINCT FROM OLD.service_fee
       OR NEW.deposit                  IS DISTINCT FROM OLD.deposit
       OR NEW.management_fee           IS DISTINCT FROM OLD.management_fee
       OR NEW.fee_absorbed             IS DISTINCT FROM OLD.fee_absorbed
       OR NEW.paid_at                  IS DISTINCT FROM OLD.paid_at
       OR NEW.stripe_session_id        IS DISTINCT FROM OLD.stripe_session_id
       OR NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id
       OR NEW.stripe_connected_account_id IS DISTINCT FROM OLD.stripe_connected_account_id
       OR NEW.refund_amount            IS DISTINCT FROM OLD.refund_amount
       OR NEW.refund_reason            IS DISTINCT FROM OLD.refund_reason
       OR NEW.refunded_at              IS DISTINCT FROM OLD.refunded_at
       OR NEW.refunded_by              IS DISTINCT FROM OLD.refunded_by
       OR NEW.user_id                  IS DISTINCT FROM OLD.user_id
       OR NEW.user_email               IS DISTINCT FROM OLD.user_email
       OR NEW.event_id                 IS DISTINCT FROM OLD.event_id
       OR NEW.zone_id                  IS DISTINCT FROM OLD.zone_id
       OR NEW.pack_id                  IS DISTINCT FROM OLD.pack_id
       OR NEW.table_id                 IS DISTINCT FROM OLD.table_id
       OR NEW.is_guest                 IS DISTINCT FROM OLD.is_guest
       OR NEW.claimed_at               IS DISTINCT FROM OLD.claimed_at
       OR NEW.claimed_by_user_id       IS DISTINCT FROM OLD.claimed_by_user_id
       OR NEW.qr_code                  IS DISTINCT FROM OLD.qr_code
       OR NEW.reference_code           IS DISTINCT FROM OLD.reference_code
       OR NEW.tracked_link_id          IS DISTINCT FROM OLD.tracked_link_id
       OR NEW.purchase_source          IS DISTINCT FROM OLD.purchase_source THEN
      RAISE EXCEPTION 'table_reservations: financial and identity fields are immutable for non-service roles'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Un scan d'entrée consommé ne se ré-ouvre jamais (même règle que
    -- orders.token_used) : pas de double entrée sur le même QR.
    IF OLD.entry_scanned = true AND NEW.entry_scanned = false THEN
      RAISE EXCEPTION 'table_reservations: entry_scanned cannot be reset'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_table_reservation_immutable_fields ON public.table_reservations;
CREATE TRIGGER trg_protect_table_reservation_immutable_fields
  BEFORE UPDATE ON public.table_reservations
  FOR EACH ROW EXECUTE FUNCTION public.protect_table_reservation_immutable_fields();
