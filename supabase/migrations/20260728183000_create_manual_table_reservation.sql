-- ============================================================================
-- Réservation VIP créée à la main (walk-in) — owner + hôte VIP
-- ============================================================================
-- Jusqu'ici la SEULE création de table_reservations passait par le checkout
-- client (create-table-checkout → reserve_table_slot). L'owner et l'hôte VIP ne
-- pouvaient que gérer l'existant. Cette RPC ajoute la création « à la main »
-- pour les walk-ins réglés au club, décidée en Q&R produit :
--   • surfaces : owner + hôte VIP,
--   • règlement : ENREGISTRÉ sans paiement Yuno (frais Yuno à 0, statut 'paid'),
--   • suivi client : CA/analytics uniquement pour l'instant (aucun venue_customers).
--
-- La ligne étant `status='paid'` avec service_fee/management_fee = 0, elle entre
-- automatiquement dans toutes les analyses de CA/VIP (get_vip_table_analytics,
-- useAnalyticsData, useNightAnalytics filtrent status='paid' sans condition
-- d'identité) : le plein `total_price` compte comme CA club, sans commission.
--
-- Sécurité :
--   • SECURITY DEFINER + garde d'autorisation explicite (owner / manager
--     'tables' / hôte VIP du club) — on N'expose PAS reserve_table_slot qui,
--     lui, n'a aucune garde.
--   • Aucun effet de bord argent : on n'insère qu'une ligne. Les triggers
--     INSERT (set_table_reference, auto_subscribe_newsletter_on_purchase) sont
--     sans risque ici (le second no-op tant que newsletter_opt_in est faux, ce
--     qui est le cas). Les triggers de commission ne se déclenchent que sur
--     UPDATE OF status, jamais à l'INSERT.
--   • Verrou de capacité de zone + verrou anti-collision de table, calqués sur
--     reserve_table_slot, pour ne pas doubler une table ou déborder une zone.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_manual_table_reservation(
  p_event_id uuid,
  p_zone_id uuid,
  p_full_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_guest_count integer DEFAULT 1,
  p_total_price numeric DEFAULT 0,
  p_minimum_spend numeric DEFAULT 0,
  p_assigned_table_id uuid DEFAULT NULL,
  p_remarks text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_venue      text;
  v_max        integer;
  v_zone_name  text;
  v_used       integer;
  v_id         uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- La zone donne le club ; FOR UPDATE verrouille pour le calcul de capacité.
  SELECT venue_id, tables_count, name
    INTO v_venue, v_max, v_zone_name
    FROM public.table_zones
   WHERE id = p_zone_id
     FOR UPDATE;
  IF v_venue IS NULL THEN
    RAISE EXCEPTION 'zone not found' USING ERRCODE = 'P0002';
  END IF;

  -- L'événement doit appartenir à ce club (lead ou co-soirée dont il tient la porte).
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event_id
       AND (e.venue_id = v_venue OR e.partner_venue_id = v_venue)
  ) THEN
    RAISE EXCEPTION 'event not in venue' USING ERRCODE = '22023';
  END IF;

  -- Autorisation : owner, manager (permission 'tables'), ou hôte VIP du club.
  IF NOT (
    public.is_venue_owner(v_uid, v_venue)
    OR public.manager_has_permission(v_uid, v_venue, 'tables')
    OR (public.get_user_venue_id(v_uid) = v_venue AND public.has_role(v_uid, 'vip_host'))
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Capacité de la zone (mêmes règles que reserve_table_slot).
  IF v_max IS NOT NULL AND v_max > 0 THEN
    SELECT COUNT(*) INTO v_used
      FROM public.table_reservations
     WHERE event_id = p_event_id
       AND zone_id = p_zone_id
       AND status IN ('pending', 'paid', 'confirmed');
    IF v_used >= v_max THEN
      RAISE EXCEPTION 'La zone "%" est complète (%/% tables).', v_zone_name, v_used, v_max
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Collision de table si une table précise est assignée au walk-in.
  IF p_assigned_table_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || p_assigned_table_id::text, 0));
    IF EXISTS (
      SELECT 1 FROM public.table_reservations r
       WHERE r.event_id = p_event_id
         AND r.status IN ('pending', 'paid', 'confirmed')
         AND (
           r.assigned_table_id = p_assigned_table_id
           OR (r.requested_table_id = p_assigned_table_id AND r.placement_status IN ('requested', 'approved'))
         )
    ) THEN
      RAISE EXCEPTION 'Cette table est déjà prise.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO public.table_reservations (
    event_id, zone_id, user_id, user_email, is_guest, guest_count,
    deposit, total_price, service_fee, management_fee, fee_absorbed,
    minimum_spend, status, paid_at, full_name, phone, remarks,
    assigned_table_id, placed_by, placed_at, placement_status, vip_status,
    purchase_source
  ) VALUES (
    p_event_id, p_zone_id, NULL, COALESCE(NULLIF(btrim(p_email), ''), ''), true, GREATEST(COALESCE(p_guest_count, 1), 1),
    0, GREATEST(COALESCE(p_total_price, 0), 0), 0, 0, false,
    GREATEST(COALESCE(p_minimum_spend, 0), 0), 'paid', now(),
    NULLIF(btrim(p_full_name), ''), NULLIF(btrim(p_phone), ''), p_remarks,
    p_assigned_table_id,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN v_uid ELSE NULL END,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN now() ELSE NULL END,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN 'approved' ELSE 'none' END,
    'active',
    'manual'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_manual_table_reservation(uuid, uuid, text, text, text, integer, numeric, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_table_reservation(uuid, uuid, text, text, text, integer, numeric, numeric, uuid, text) TO authenticated;
