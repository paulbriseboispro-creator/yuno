-- Tables VIP, vague A — P4.1 / P4.2 (1/2) : colonnes du surclassement / de la différence à régler sur place.
--
-- Décision D3 : déplacer un client vers une table d'une AUTRE formule se fait par « surclassement offert » ou « différence à régler
-- sur place », jamais par un nouveau débit en ligne. Le choix est gardé sur la réservation (fiche, liste de porte, export, e-mail
-- `table_changed`). Contrat avec l'équipe serveur : send-vip-confirmation lit `placement_adjustment` (NULL | 'upgrade_free' |
-- 'pay_on_site') et `placement_adjustment_amount` (la différence, en euros).
--
--   • colonnes nullables ; CHECK sur les valeurs (le montant n'existe que s'il y a un ajustement, et n'est jamais négatif) ;
--   • protect_table_reservation_immutable_fields : un client authentifié ne les écrit jamais ; seule la RPC vip_set_table_placement
--     (migration suivante) les pose ;
--   • enforce_vip_host_reservation_columns : un hôte VIP « pur » passe par cette RPC, dont les écritures portent encore son
--     auth.uid() — les deux colonnes entrent dans sa liste blanche (la RPC vérifie elle-même les droits).

ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS placement_adjustment text;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS placement_adjustment_amount numeric;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_reservations_placement_adjustment_check') THEN
    ALTER TABLE public.table_reservations
      ADD CONSTRAINT table_reservations_placement_adjustment_check
      CHECK (placement_adjustment IS NULL OR placement_adjustment IN ('upgrade_free', 'pay_on_site'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_reservations_placement_adjustment_amount_check') THEN
    ALTER TABLE public.table_reservations
      ADD CONSTRAINT table_reservations_placement_adjustment_amount_check
      CHECK (placement_adjustment_amount IS NULL
             OR (placement_adjustment IS NOT NULL AND placement_adjustment_amount >= 0));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.protect_table_reservation_immutable_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
       OR NEW.purchase_source          IS DISTINCT FROM OLD.purchase_source
       -- Surclassement / différence à régler sur place : posés par vip_set_table_placement seulement.
       OR NEW.placement_adjustment        IS DISTINCT FROM OLD.placement_adjustment
       OR NEW.placement_adjustment_amount IS DISTINCT FROM OLD.placement_adjustment_amount THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.enforce_vip_host_reservation_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Les seules colonnes qu'un pur vip_host peut modifier. Miroir du hook
  -- src/hooks/useVipNight.tsx (ex-useVipHost).
  v_allowed text[] := ARRAY[
    'vip_status', 'assigned_table_id', 'placed_at', 'placed_by', 'finished_at',
    -- Refonte serveur VIP (20260714190000) : arrivée manuelle + revue de la
    -- demande de table du client. Aucune colonne financière.
    'checked_in_at', 'placement_status', 'placement_reviewed_by',
    'placement_reviewed_at', 'placement_note',
    -- Posées par vip_set_table_placement (SECURITY DEFINER, mais auth.uid() reste l'hôte) ; une écriture directe est de toute façon
    -- refusée par protect_table_reservation_immutable_fields.
    'placement_adjustment', 'placement_adjustment_amount'
  ];
  v_venue text;
  v_old jsonb;
  v_new jsonb;
  k text;
BEGIN
  -- Non-host sessions are unrestricted here. has_role() returns false when
  -- auth.uid() is NULL, so the service_role edge-function path (which
  -- legitimately writes every column) short-circuits immediately.
  IF NOT public.has_role(auth.uid(), 'vip_host') THEN
    RETURN NEW;
  END IF;

  -- A user who also owns this venue / is a co-event partner / is a super admin
  -- keeps full write access even while holding the vip_host role (owners can
  -- and do operate the VIP host dashboard).
  SELECT venue_id INTO v_venue FROM public.table_zones WHERE id = NEW.zone_id;
  IF v_venue IS NOT NULL AND public.is_venue_owner(auth.uid(), v_venue) THEN
    RETURN NEW;
  END IF;
  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.event_id IS NOT NULL
     AND (public.is_event_partner_venue_owner(auth.uid(), NEW.event_id)
          OR public.is_event_partner_organizer(auth.uid(), NEW.event_id)) THEN
    RETURN NEW;
  END IF;

  -- Pure vip_host: strip the allow-listed keys from both row images and reject
  -- if anything else changed.
  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  FOREACH k IN ARRAY v_allowed LOOP
    v_old := v_old - k;
    v_new := v_new - k;
  END LOOP;

  IF v_old IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION
      'A VIP host may only change service fields (vip_status, table placement, arrival, placement review). Financial and identity fields are read-only for this role.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;
