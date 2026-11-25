-- Tables VIP, vague A — P4.1 / P4.2 (2/2) : vip_set_table_placement — attribuer, proposer une autre table, placement à l'arrivée.
--
-- Décisions D2 / D3 : une demande de table impossible n'est plus « refusée » ; le pro propose une autre table (même formule, libre) ou
-- « placement à l'arrivée » — la réservation tient. Vers une table d'une AUTRE formule, il choisit « surclassement offert » ou
-- « différence à régler sur place » : jamais de nouveau débit en ligne, le CA ne bouge pas.
--
-- Toutes les transitions passent par UNE RPC (état attendu, verrou de table, droits), comme le staff de nuit : deux collègues qui
-- traitent la même demande ne s'écrasent plus — le second reçoit `placement_changed`.
--
--   vip_set_table_placement(p_reservation_id, p_action, p_table_id, p_adjustment, p_adjustment_amount, p_expected_placement_status)
--     p_action = 'assign'      → assigned_table_id = p_table_id ; placement_status = 'approved' (table demandée, ou jamais de demande)
--                                 ou 'modified' (autre table que celle demandée) ; revue horodatée.
--     p_action = 'on_arrival'  → assigned_table_id = NULL ; placement_status = 'assign_on_arrival'.
--     p_expected_placement_status : le placement_status que l'écran a lu (NULL = ne pas contrôler).
--   Rend {ok, changed_table, previous_table, requested_table, new_table, placement_status, placement_adjustment,
--         placement_adjustment_amount}.
--
-- Codes d'erreur (SQLSTATE → message) :
--   42501 not_authenticated | not_allowed         droits : ceux qui gèrent les tables de la soirée (voir _can_manage_table_reservation)
--   22023 invalid_action | table_required | invalid_adjustment | invalid_adjustment_amount
--   P0002 reservation_not_found
--   YU004 placement_changed                      le placement_status actuel n'est plus celui que l'écran a lu
--   YU005 formula_change_requires_adjustment     table liée (plan) à une AUTRE formule sans surclassement / différence choisis
--   YU007 table_taken                            la table est déjà tenue par une autre réservation (installée, promise, demande vivante)
--   YU008 reservation_not_active | already_seated  réservation non payée / annulée / terminée ; ou client déjà installé (on_arrival)
--   YU009 table_unknown                          la table n'est pas (plus) sur le plan de la soirée
--   (YU001 plafond de formule, YU002 formule invalide, YU003 table vendue : autres lots ; YU006 : annulation, migration suivante.)
-- Droits d'un hôte VIP « pur » : il PLACE (sa fonction), il n'annule pas (voir cancel_unpaid_table_reservation).

-- Droits de gestion d'une réservation = ceux de la Console Service VIP / Commandes : équipe de la soirée (can_manage_event_tables,
-- qui inclut l'organisateur, son équipe admin/éditeur, le propriétaire de tables, le propriétaire du club, le manager « tables »),
-- partenaires (les règles UPDATE existantes de table_reservations), super admin, et — si p_allow_vip_host — l'hôte VIP du club.
-- Jamais un videur ni un scanneur : ils lisent et scannent, ils ne placent pas.
CREATE OR REPLACE FUNCTION public._can_manage_table_reservation(p_uid uuid, p_event_id uuid, p_zone_id uuid, p_allow_vip_host boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_zone_venue text;
  v_host text;
  v_partner text;
  v text;
BEGIN
  IF p_uid IS NULL OR p_event_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_super_admin() THEN
    RETURN true;
  END IF;
  IF public.can_manage_event_tables(p_uid, p_event_id)
     OR public.is_event_partner_organizer(p_uid, p_event_id)
     OR public.is_event_partner_venue_owner(p_uid, p_event_id) THEN
    RETURN true;
  END IF;

  SELECT venue_id INTO v_zone_venue FROM public.table_zones WHERE id = p_zone_id;
  SELECT venue_id, partner_venue_id INTO v_host, v_partner FROM public.events WHERE id = p_event_id;

  FOREACH v IN ARRAY ARRAY[v_zone_venue, v_host, v_partner] LOOP
    IF v IS NULL THEN CONTINUE; END IF;
    IF public.manager_has_permission(p_uid, v, 'tables') THEN
      RETURN true;
    END IF;
    IF p_allow_vip_host AND public.has_role(p_uid, 'vip_host') AND public.get_user_venue_id(p_uid) = v THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public._can_manage_table_reservation(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._can_manage_table_reservation(uuid, uuid, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.vip_set_table_placement(
  p_reservation_id uuid,
  p_action text,
  p_table_id text DEFAULT NULL,
  p_adjustment text DEFAULT NULL,
  p_adjustment_amount numeric DEFAULT NULL,
  p_expected_placement_status text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  r public.table_reservations%ROWTYPE;
  v_club text;
  v_layout jsonb;
  v_table jsonb;
  v_tid uuid;
  v_bound uuid;
  v_pack_event uuid;
  v_pack_venue text;
  v_needs_adjustment boolean := false;
  v_adj text;
  v_amt numeric;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('assign', 'on_arrival') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO r FROM public.table_reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._can_manage_table_reservation(v_uid, r.event_id, r.zone_id, true) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'assign' THEN
    IF p_table_id IS NULL OR btrim(p_table_id) = '' THEN
      RAISE EXCEPTION 'table_required' USING ERRCODE = '22023';
    END IF;
    IF p_table_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'table_unknown' USING ERRCODE = 'YU009';
    END IF;
    v_tid := p_table_id::uuid;
    -- Même verrou que reserve_table_slot et enforce_assigned_table_exists : deux collègues sur la même table passent l'un après l'autre.
    PERFORM pg_advisory_xact_lock(hashtextextended(r.event_id::text || ':' || v_tid::text, 0));
  END IF;

  -- Relecture sous verrou de ligne : l'état jugé est celui que personne ne change plus.
  SELECT * INTO r FROM public.table_reservations WHERE id = p_reservation_id FOR UPDATE;

  IF r.status NOT IN ('paid', 'confirmed')
     OR COALESCE(r.vip_status, 'waiting') IN ('finished', 'no_show', 'denied') THEN
    RAISE EXCEPTION 'reservation_not_active' USING ERRCODE = 'YU008';
  END IF;
  IF p_expected_placement_status IS NOT NULL
     AND COALESCE(r.placement_status, 'none') IS DISTINCT FROM p_expected_placement_status THEN
    RAISE EXCEPTION 'placement_changed' USING ERRCODE = 'YU004';
  END IF;

  IF p_action = 'on_arrival' THEN
    IF COALESCE(r.vip_status, 'waiting') IN ('placed', 'active') THEN
      RAISE EXCEPTION 'already_seated' USING ERRCODE = 'YU008';
    END IF;
    UPDATE public.table_reservations
       SET assigned_table_id = NULL,
           placement_status = 'assign_on_arrival',
           placement_reviewed_by = v_uid,
           placement_reviewed_at = now(),
           placement_adjustment = NULL,
           placement_adjustment_amount = NULL
     WHERE id = r.id;
    RETURN jsonb_build_object(
      'ok', true,
      'changed_table', (r.assigned_table_id IS NOT NULL),
      'previous_table', r.assigned_table_id,
      'requested_table', r.requested_table_id,
      'new_table', NULL,
      'placement_status', 'assign_on_arrival',
      'placement_adjustment', NULL,
      'placement_adjustment_amount', NULL
    );
  END IF;

  -- ── assign ───────────────────────────────────────────────────────────────
  -- 1) La table doit exister sur le plan de CETTE soirée (plan de la soirée, sinon celui du club).
  SELECT COALESCE(venue_id, partner_venue_id) INTO v_club FROM public.events WHERE id = r.event_id;
  SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE event_id = r.event_id
   ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  IF v_layout IS NULL AND v_club IS NOT NULL THEN
    SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE venue_id = v_club AND event_id IS NULL
     ORDER BY updated_at DESC NULLS LAST LIMIT 1;
  END IF;
  IF v_layout IS NOT NULL THEN
    SELECT t INTO v_table FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) t
     WHERE t->>'id' = v_tid::text LIMIT 1;
  END IF;
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'table_unknown' USING ERRCODE = 'YU009';
  END IF;

  -- 2) La table doit être libre : un autre client installé, pré-placé, ou une demande de table encore vivante
  --    (même règle que create_manual_table_reservation, avec le seuil de 31 min des réservations en attente).
  IF EXISTS (
    SELECT 1 FROM public.table_reservations o
     WHERE o.event_id = r.event_id
       AND o.id <> r.id
       AND public._table_resa_holds(o.status, o.created_at)
       AND (
         (o.assigned_table_id = v_tid AND COALESCE(o.vip_status, 'waiting') IN ('waiting', 'placed', 'active'))
         OR (o.requested_table_id = v_tid AND o.assigned_table_id IS NULL
             AND o.placement_status IN ('requested', 'approved') AND COALESCE(o.vip_status, 'waiting') = 'waiting')
       )
  ) THEN
    RAISE EXCEPTION 'table_taken' USING ERRCODE = 'YU007';
  END IF;

  -- 3) Table liée (plan) à une AUTRE formule : surclassement offert ou différence à régler sur place, au choix du pro.
  --    La liaison ne s'applique que si la formule liée vit dans le MÊME périmètre que celle de la réservation
  --    (comme reserve_table_slot) ; une réservation sans formule (ajout manuel) n'a rien à comparer.
  IF r.pack_id IS NOT NULL
     AND NULLIF(v_table->>'packId', '') IS NOT NULL
     AND (v_table->>'packId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND (v_table->>'packId')::uuid <> r.pack_id THEN
    SELECT event_id, venue_id INTO v_pack_event, v_pack_venue FROM public.table_packs WHERE id = r.pack_id;
    SELECT p.id INTO v_bound FROM public.table_packs p
     WHERE p.id = (v_table->>'packId')::uuid
       AND p.event_id IS NOT DISTINCT FROM v_pack_event
       AND p.venue_id IS NOT DISTINCT FROM v_pack_venue;
    v_needs_adjustment := v_bound IS NOT NULL;
  END IF;

  IF v_needs_adjustment THEN
    IF p_adjustment IS NULL AND r.assigned_table_id = v_tid AND r.placement_adjustment IS NOT NULL THEN
      -- Même table qu'avant : le choix déjà fait reste (un écran qui renvoie la table sans le rappeler).
      v_adj := r.placement_adjustment;
      v_amt := r.placement_adjustment_amount;
    ELSE
      IF p_adjustment IS NULL THEN
        RAISE EXCEPTION 'formula_change_requires_adjustment' USING ERRCODE = 'YU005';
      END IF;
      IF p_adjustment NOT IN ('upgrade_free', 'pay_on_site') THEN
        RAISE EXCEPTION 'invalid_adjustment' USING ERRCODE = '22023';
      END IF;
      IF p_adjustment = 'pay_on_site' AND (p_adjustment_amount IS NULL OR p_adjustment_amount < 0) THEN
        RAISE EXCEPTION 'invalid_adjustment_amount' USING ERRCODE = '22023';
      END IF;
      IF p_adjustment = 'upgrade_free' AND p_adjustment_amount IS NOT NULL AND p_adjustment_amount < 0 THEN
        RAISE EXCEPTION 'invalid_adjustment_amount' USING ERRCODE = '22023';
      END IF;
      v_adj := p_adjustment;
      v_amt := round(p_adjustment_amount, 2);
    END IF;
  ELSE
    -- Même formule (ou table sans formule liée) : aucun ajustement ; un ancien choix est remis à zéro.
    v_adj := NULL;
    v_amt := NULL;
  END IF;

  v_status := CASE WHEN r.requested_table_id IS NULL OR r.requested_table_id = v_tid THEN 'approved' ELSE 'modified' END;

  UPDATE public.table_reservations
     SET assigned_table_id = v_tid,
         placement_status = v_status,
         placement_reviewed_by = v_uid,
         placement_reviewed_at = now(),
         placement_adjustment = v_adj,
         placement_adjustment_amount = v_amt
   WHERE id = r.id;

  RETURN jsonb_build_object(
    'ok', true,
    'changed_table', (r.assigned_table_id IS DISTINCT FROM v_tid),
    'previous_table', r.assigned_table_id,
    'requested_table', r.requested_table_id,
    'new_table', v_tid,
    'placement_status', v_status,
    'placement_adjustment', v_adj,
    'placement_adjustment_amount', v_amt
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.vip_set_table_placement(uuid, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vip_set_table_placement(uuid, text, text, text, numeric, text) TO authenticated, service_role;
