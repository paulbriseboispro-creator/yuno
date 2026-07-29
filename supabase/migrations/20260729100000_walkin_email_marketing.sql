-- ============================================================================
-- Walk-in : capter l'email/tél du client VIP pour le marketing
-- ============================================================================
-- L'hôte VIP peut désormais saisir l'email + le téléphone d'un walk-in. On les
-- stockait déjà sur la réservation (p_email/p_phone), mais sans les faire entrer
-- dans la liste marketing. Ici : quand un email est fourni, on marque
-- newsletter_opt_in=true à l'INSERT → le trigger auto_subscribe_newsletter_on_purchase
-- (déjà en place) crée l'abonnement newsletter_subscriptions (clé email+venue,
-- SANS compte requis). C'est la capture CRM/marketing account-less du walk-in.
--
-- CREATE OR REPLACE sur la MÊME signature (celle de 20260728190000, avec
-- p_open_tab) — pas de DROP, on ne fait qu'ajouter newsletter_opt_in à l'INSERT.
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
  p_remarks text DEFAULT NULL,
  p_open_tab boolean DEFAULT false
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
  v_email      text := COALESCE(NULLIF(btrim(p_email), ''), '');
  v_id         uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT venue_id, tables_count, name
    INTO v_venue, v_max, v_zone_name
    FROM public.table_zones
   WHERE id = p_zone_id
     FOR UPDATE;
  IF v_venue IS NULL THEN
    RAISE EXCEPTION 'zone not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event_id
       AND (e.venue_id = v_venue OR e.partner_venue_id = v_venue)
  ) THEN
    RAISE EXCEPTION 'event not in venue' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    public.is_venue_owner(v_uid, v_venue)
    OR public.manager_has_permission(v_uid, v_venue, 'tables')
    OR (public.get_user_venue_id(v_uid) = v_venue AND public.has_role(v_uid, 'vip_host'))
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

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
    purchase_source, newsletter_opt_in
  ) VALUES (
    p_event_id, p_zone_id, NULL, v_email, true, GREATEST(COALESCE(p_guest_count, 1), 1),
    0,
    CASE WHEN p_open_tab THEN 0 ELSE GREATEST(COALESCE(p_total_price, 0), 0) END,
    0, 0, false,
    GREATEST(COALESCE(p_minimum_spend, 0), 0), 'paid', now(),
    NULLIF(btrim(p_full_name), ''), NULLIF(btrim(p_phone), ''), p_remarks,
    p_assigned_table_id,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN v_uid ELSE NULL END,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN now() ELSE NULL END,
    CASE WHEN p_assigned_table_id IS NOT NULL THEN 'approved' ELSE 'none' END,
    'active',
    CASE WHEN p_open_tab THEN 'manual_open' ELSE 'manual' END,
    -- Email fourni = le club enregistre un contact VIP → liste marketing du club.
    (v_email <> '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
