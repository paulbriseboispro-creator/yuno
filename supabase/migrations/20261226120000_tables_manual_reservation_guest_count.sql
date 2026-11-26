-- Tables VIP, vague C1 — P4.4 (serveur) réservation manuelle complète + changement du nombre de convives.
--
-- 1. `create_manual_table_reservation` (le pro ajoute une réservation) accepte désormais :
--      • la table choisie sur le plan (`p_assigned_table_id`, déjà là) — elle doit exister sur le plan de CETTE soirée (plan de la
--        soirée d'abord, plan du club ensuite : même résolution que le trigger de mise à jour), sinon `table_not_found` ;
--      • la formule (`p_pack_id`, facultatif) : doit vivre dans la portée de la soirée et dans la zone choisie, sinon
--        `pack_not_in_event` / `pack_not_in_zone` ; elle donne son nom à l'e-mail ;
--      • une adresse e-mail facultative (inchangé) ;
--      • `p_send_confirmation` : pose un QR (`VP-<uuid>`, comme un achat) pour que l'e-mail « confirmée » (QR, QR des invités,
--        Wallet) puisse partir ; exige une adresse (`email_required`). L'envoi lui-même reste à l'écran : après le retour de la
--        RPC, il appelle `send-vip-confirmation` {reservation_id, type: 'confirmed'} avec la session du pro (la fonction vérifie
--        qu'il gère la réservation ; 202 `{queued:true}` = refusé par Resend et mis en file, c'est un succès).
--    M5 (revue vague A) : une pending expirée ne bloque plus la zone ni la table (`_table_resa_holds`, déjà dans la définition
--    vivante) ; vérifié par le smoke. Plafond de convives : 50 (au-delà, aucun QR d'invité n'existe) → `guest_count_out_of_range`.
--
-- 2. `vip_set_table_guest_count(réservation, convives, attendu?)` : le pro change le nombre de convives d'une réservation active.
--    Droits = gestion de la soirée (`_can_manage_table_reservation`, hôte VIP exclu comme pour les remboursements d'argent).
--    Bornes : plancher max(1, invités déjà entrés), plafond base_capacity + max_extra_persons de la formule (50 sans formule).
--    Le trigger des invités recalcule : de nouveaux QR `TG-…` aléatoires pour les ajoutés, retrait des non entrés en trop ; les QR
--    existants ne changent jamais. Aucun montant ne bouge (jamais de nouveau débit : un supplément se règle sur place).
--    Erreurs (SQLSTATE → message) : 42501 forbidden · P0002 reservation_not_found · YU013 reservation_not_active ·
--    YU011 guest_count_out_of_range:<min>:<max> · YU012 guest_count_below_entered:<n> · YU014 guest_count_changed:<courant>.

DROP FUNCTION IF EXISTS public.create_manual_table_reservation(uuid, uuid, text, text, text, integer, numeric, numeric, uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.create_manual_table_reservation(
  p_event_id uuid, p_zone_id uuid,
  p_full_name text DEFAULT NULL, p_phone text DEFAULT NULL, p_email text DEFAULT NULL,
  p_guest_count integer DEFAULT 1, p_total_price numeric DEFAULT 0, p_minimum_spend numeric DEFAULT 0,
  p_assigned_table_id uuid DEFAULT NULL, p_remarks text DEFAULT NULL, p_open_tab boolean DEFAULT false,
  p_send_confirmation boolean DEFAULT false, p_pack_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_venue      text;
  v_zone_event uuid;
  v_max        integer;
  v_zone_name  text;
  v_used       integer;
  v_email      text := COALESCE(NULLIF(btrim(p_email), ''), '');
  v_org        uuid;
  v_id         uuid;
  v_guests     integer := GREATEST(COALESCE(p_guest_count, 1), 1);
  v_layout     jsonb;
  v_ev_venue   text;
  v_ev_partner text;
  v_pack       record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_guests > 50 THEN
    RAISE EXCEPTION 'guest_count_out_of_range:1:50' USING ERRCODE = 'YU011';
  END IF;
  IF COALESCE(p_send_confirmation, false) AND v_email = '' THEN
    RAISE EXCEPTION 'email_required' USING ERRCODE = '22023';
  END IF;

  SELECT venue_id, event_id, tables_count, name
    INTO v_venue, v_zone_event, v_max, v_zone_name
    FROM public.table_zones
   WHERE id = p_zone_id
     FOR UPDATE;
  IF v_venue IS NULL AND v_zone_event IS NULL THEN
    RAISE EXCEPTION 'zone not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_venue IS NOT NULL THEN
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
      OR COALESCE(public.get_user_venue_id(v_uid) = v_venue AND public.has_role(v_uid, 'vip_host'), false)
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Zone d'une soirée sans club : elle doit appartenir À CETTE soirée, et
    -- l'appelant en être l'organisateur (ou de son équipe).
    IF v_zone_event <> p_event_id THEN
      RAISE EXCEPTION 'zone not in event' USING ERRCODE = '22023';
    END IF;
    SELECT organizer_user_id INTO v_org FROM public.events WHERE id = p_event_id;
    IF NOT (
      public.can_manage_organizer_rooms(v_uid, v_org)
      OR public.is_event_partner_organizer(v_uid, p_event_id)
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Formule choisie : de la soirée, ou du club de la soirée (formule non event-scopée), dans la zone choisie.
  IF p_pack_id IS NOT NULL THEN
    SELECT venue_id, partner_venue_id INTO v_ev_venue, v_ev_partner FROM public.events WHERE id = p_event_id;
    SELECT p.id, p.zone_id, p.event_id, p.venue_id INTO v_pack FROM public.table_packs p WHERE p.id = p_pack_id AND p.is_active;
    IF NOT FOUND
       OR NOT (v_pack.event_id = p_event_id
               OR (v_pack.event_id IS NULL AND v_pack.venue_id IS NOT NULL AND v_pack.venue_id IN (COALESCE(v_ev_venue, ''), COALESCE(v_ev_partner, '')))) THEN
      RAISE EXCEPTION 'pack_not_in_event' USING ERRCODE = '22023';
    END IF;
    IF v_pack.zone_id IS NOT NULL AND v_pack.zone_id <> p_zone_id THEN
      RAISE EXCEPTION 'pack_not_in_zone' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Capacité de la zone : une résa terminée, no-show ou refusée a rendu sa
  -- table — le club la refait tourner dans la nuit.
  IF v_max IS NOT NULL AND v_max > 0 THEN
    SELECT COUNT(*) INTO v_used
      FROM public.table_reservations
     WHERE event_id = p_event_id
       AND zone_id = p_zone_id
       AND public._table_resa_holds(status, created_at)
       AND COALESCE(vip_status, 'waiting') NOT IN ('finished', 'no_show', 'denied');
    IF v_used >= v_max THEN
      RAISE EXCEPTION 'La zone "%" est complète (%/% tables).', v_zone_name, v_used, v_max
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_assigned_table_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || p_assigned_table_id::text, 0));

    -- La table doit exister sur le plan de CETTE soirée (plan de la soirée d'abord, plan du club ensuite).
    SELECT layout INTO v_layout FROM public.venue_floor_plans
     WHERE event_id = p_event_id ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    IF v_layout IS NULL AND v_venue IS NOT NULL THEN
      SELECT layout INTO v_layout FROM public.venue_floor_plans
       WHERE venue_id = v_venue AND event_id IS NULL ORDER BY updated_at DESC NULLS LAST LIMIT 1;
    END IF;
    IF v_layout IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) AS e
       WHERE e->>'id' = p_assigned_table_id::text
    ) THEN
      RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- Tient la table : un groupe installé, un client pré-placé qui n'est pas
    -- encore arrivé, une demande de table en attente de réponse.
    IF EXISTS (
      SELECT 1 FROM public.table_reservations r
       WHERE r.event_id = p_event_id
         AND public._table_resa_holds(r.status, r.created_at)
         AND (
           (r.assigned_table_id = p_assigned_table_id
             AND COALESCE(r.vip_status, 'waiting') IN ('waiting', 'placed', 'active'))
           OR (r.requested_table_id = p_assigned_table_id
             AND r.assigned_table_id IS NULL
             AND r.placement_status = 'requested'
             AND COALESCE(r.vip_status, 'waiting') = 'waiting')
         )
    ) THEN
      RAISE EXCEPTION 'Cette table est déjà prise.' USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  INSERT INTO public.table_reservations (
    event_id, zone_id, pack_id, user_id, user_email, is_guest, guest_count,
    deposit, total_price, service_fee, management_fee, fee_absorbed,
    minimum_spend, status, paid_at, full_name, phone, remarks,
    assigned_table_id, placed_by, placed_at, placement_status, vip_status,
    purchase_source, newsletter_opt_in, qr_code
  ) VALUES (
    p_event_id, p_zone_id, p_pack_id, NULL, v_email, true, v_guests,
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
    (v_email <> ''),
    CASE WHEN COALESCE(p_send_confirmation, false) THEN 'VP-' || gen_random_uuid()::text ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_manual_table_reservation(uuid, uuid, text, text, text, integer, numeric, numeric, uuid, text, boolean, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_table_reservation(uuid, uuid, text, text, text, integer, numeric, numeric, uuid, text, boolean, boolean, uuid) TO authenticated, service_role;

-- ── 2. Nombre de convives ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vip_set_table_guest_count(
  p_reservation_id uuid, p_guest_count integer, p_expected_guest_count integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  r         public.table_reservations%ROWTYPE;
  v_cap     integer;
  v_extra   integer;
  v_entered integer;
  v_min     integer;
  v_max     integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.table_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public._can_manage_table_reservation(v_uid, r.event_id, r.zone_id, false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF r.status NOT IN ('paid', 'confirmed') OR COALESCE(r.vip_status, 'waiting') IN ('finished', 'no_show', 'denied') THEN
    RAISE EXCEPTION 'reservation_not_active' USING ERRCODE = 'YU013';
  END IF;

  IF p_expected_guest_count IS NOT NULL AND r.guest_count IS DISTINCT FROM p_expected_guest_count THEN
    RAISE EXCEPTION 'guest_count_changed:%', COALESCE(r.guest_count, 0) USING ERRCODE = 'YU014';
  END IF;

  -- Invités déjà entrés (QR d'invité scanné) : on ne descend jamais en dessous. Une table entière entrée par le QR de la
  -- réservation sans QR d'invité (ancienne réservation) compte pour le nombre de convives actuel.
  SELECT count(*) INTO v_entered FROM public.table_reservation_guests g WHERE g.reservation_id = r.id AND g.entry_scanned;
  IF v_entered = 0 AND COALESCE(r.entry_scanned, false) THEN
    v_entered := GREATEST(COALESCE(r.guest_count, 1), 1);
  END IF;

  SELECT p.base_capacity, COALESCE(p.max_extra_persons, 0) INTO v_cap, v_extra FROM public.table_packs p WHERE p.id = r.pack_id;
  v_min := GREATEST(1, v_entered);
  v_max := CASE WHEN v_cap IS NULL THEN 50 ELSE LEAST(50, v_cap + v_extra) END;

  IF p_guest_count IS NULL OR p_guest_count > v_max OR p_guest_count < 1 THEN
    RAISE EXCEPTION 'guest_count_out_of_range:%:%', v_min, v_max USING ERRCODE = 'YU011';
  END IF;
  IF p_guest_count < v_entered THEN
    RAISE EXCEPTION 'guest_count_below_entered:%', v_entered USING ERRCODE = 'YU012';
  END IF;

  IF p_guest_count IS DISTINCT FROM r.guest_count THEN
    -- Le trigger des invités (table_reservation_guests_follow) recrée / retire les QR TG-… non entrés.
    UPDATE public.table_reservations SET guest_count = p_guest_count WHERE id = r.id;
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', r.id, 'previous', r.guest_count, 'guest_count', p_guest_count,
    'guests_entered', v_entered, 'min', v_min, 'max', v_max,
    'guest_qr_count', (SELECT count(*) FROM public.table_reservation_guests g WHERE g.reservation_id = r.id));
END;
$function$;

REVOKE ALL ON FUNCTION public.vip_set_table_guest_count(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vip_set_table_guest_count(uuid, integer, integer) TO authenticated, service_role;
