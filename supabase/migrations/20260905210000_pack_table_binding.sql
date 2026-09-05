-- ─── Formule fixée par table + plafond de tables par formule ──────────────────
--
-- Certains clubs ne laissent pas le client choisir sa formule dans une zone :
-- chaque table porte SA formule (« les violettes : 6 pers. à 600 €, quatre
-- tables ; les vertes : 8 pers. à 1 200 €, deux tables »). Deux briques,
-- toutes deux OPTIONNELLES, qui s'emboîtent dans zones → packs → plan :
--
--   1. `table_packs.limit_tables` : quand il est vrai, `tables_count` (colonne
--      qui existait depuis 2025-12 sans être appliquée nulle part) devient un
--      vrai plafond : au plus N réservations actives de cette formule par
--      soirée, en plus du plafond de la zone. Opt-in : les packs existants
--      (tous à `tables_count = 1` par défaut) ne changent pas de comportement.
--
--   2. `packId` sur une table du plan (layout jsonb, aucune colonne) : la table
--      se réserve avec cette formule et aucune autre. Le serveur refuse une
--      réservation qui pointe une table liée à une autre formule DU MÊME
--      PÉRIMÈTRE (packs de la soirée pour une soirée d'orga, packs du club pour
--      le club). Un plan de club réutilisé par une co-soirée dont les packs
--      sont ceux de l'organisateur n'est donc jamais bloqué par des ids
--      étrangers. Le front synchronise `tables_count` / `limit_tables` depuis
--      le nombre de tables liées, comme il le fait déjà pour les zones.

ALTER TABLE public.table_packs
  ADD COLUMN IF NOT EXISTS limit_tables boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.table_packs.limit_tables IS
  'Vrai = tables_count est un plafond de réservations actives de cette formule par soirée (en plus du plafond de zone). Faux = pas de plafond propre.';
COMMENT ON COLUMN public.table_packs.tables_count IS
  'Nombre de tables vendables avec cette formule. Appliqué seulement quand limit_tables est vrai ; synchronisé depuis le plan quand des tables y sont liées.';

-- ─── Disponibilité publique : la formule de chaque réservation ───────────────
-- Le type de retour change : DROP puis CREATE (CREATE OR REPLACE refuse).
DROP FUNCTION IF EXISTS public.get_event_table_availability(uuid);
CREATE FUNCTION public.get_event_table_availability(p_event_id uuid)
RETURNS TABLE (
  requested_table_id text,
  assigned_table_id  text,
  placement_status   text,
  guest_count        integer,
  zone_id            uuid,
  status             text,
  pack_id            uuid
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
    tr.status,
    tr.pack_id
  FROM public.table_reservations tr
  WHERE tr.event_id = p_event_id
    AND (
      tr.status IN ('paid', 'confirmed')
      OR (tr.status = 'pending' AND tr.created_at > now() - interval '30 minutes')
    );
$$;
REVOKE ALL ON FUNCTION public.get_event_table_availability(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_table_availability(uuid) TO anon, authenticated;

-- ─── Réservation sous verrou : plafond de formule + table liée ───────────────
CREATE OR REPLACE FUNCTION public.reserve_table_slot(
  _event_id uuid, _zone_id uuid, _capacity_zone_id uuid, _pack_id uuid,
  _user_id uuid, _user_email text, _is_guest boolean, _guest_count integer,
  _deposit numeric, _total_price numeric, _management_fee numeric,
  _status text, _qr_code text, _full_name text, _phone text, _remarks text,
  _newsletter_opt_in boolean, _sms_opt_in boolean,
  _requested_table_id text, _placement_status text, _purchase_source text,
  _fee_absorbed boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_max integer;
  v_zone_name text;
  v_used integer;
  v_reservation_id uuid;
  v_requested text := NULLIF(_requested_table_id, '');
  -- Formule : plafond propre + périmètre.
  v_pack_limit boolean;
  v_pack_max integer;
  v_pack_name text;
  v_pack_event uuid;
  v_pack_venue text;
  v_pack_used integer;
  -- Table liée à une formule sur le plan.
  v_club text;
  v_layout jsonb;
  v_table jsonb;
  v_bound_pack uuid;
  v_bound_name text;
BEGIN
  IF _capacity_zone_id IS NOT NULL THEN
    SELECT tables_count, name INTO v_max, v_zone_name
    FROM public.table_zones
    WHERE id = _capacity_zone_id
    FOR UPDATE;

    IF v_max IS NOT NULL AND v_max > 0 THEN
      SELECT COUNT(*) INTO v_used
      FROM public.table_reservations
      WHERE event_id = _event_id
        AND zone_id = _capacity_zone_id
        AND status IN ('pending', 'paid', 'confirmed');

      IF v_used >= v_max THEN
        RAISE EXCEPTION
          'La zone "%" est complète (%/% tables réservées). Choisis une autre zone ou réessaie plus tard.',
          v_zone_name, v_used, v_max
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- Plafond de la formule (verrou sur la ligne du pack : deux checkouts
  -- concurrents sur la dernière table de la formule se sérialisent ici).
  IF _pack_id IS NOT NULL THEN
    SELECT limit_tables, tables_count, name, event_id, venue_id
      INTO v_pack_limit, v_pack_max, v_pack_name, v_pack_event, v_pack_venue
      FROM public.table_packs
     WHERE id = _pack_id
     FOR UPDATE;

    IF COALESCE(v_pack_limit, false) AND COALESCE(v_pack_max, 0) > 0 THEN
      SELECT COUNT(*) INTO v_pack_used
        FROM public.table_reservations
       WHERE event_id = _event_id
         AND pack_id = _pack_id
         AND status IN ('pending', 'paid', 'confirmed');

      IF v_pack_used >= v_pack_max THEN
        RAISE EXCEPTION
          'La formule "%" est complète (%/% tables réservées). Choisis une autre formule.',
          v_pack_name, v_pack_used, v_pack_max
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF v_requested IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_event_id::text || ':' || v_requested, 0));
    IF EXISTS (
      SELECT 1 FROM public.table_reservations r
      WHERE r.event_id = _event_id
        AND r.status IN ('pending', 'paid', 'confirmed')
        AND (
          (r.requested_table_id::text = v_requested
            AND r.placement_status IN ('requested', 'approved'))
          OR r.assigned_table_id::text = v_requested
        )
    ) THEN
      RAISE EXCEPTION
        'Cette table vient d''être réservée par quelqu''un d''autre. Choisis une autre table sur le plan.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Table liée à une formule : plan de la soirée d'abord, sinon celui du club.
    SELECT COALESCE(venue_id, partner_venue_id) INTO v_club FROM public.events WHERE id = _event_id;
    SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE event_id = _event_id;
    IF v_layout IS NULL AND v_club IS NOT NULL THEN
      SELECT layout INTO v_layout FROM public.venue_floor_plans
       WHERE venue_id = v_club AND event_id IS NULL;
    END IF;
    IF v_layout IS NOT NULL THEN
      SELECT t INTO v_table
        FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) t
       WHERE t->>'id' = v_requested
       LIMIT 1;
      IF v_table IS NOT NULL AND NULLIF(v_table->>'packId', '') IS NOT NULL
         AND (v_table->>'packId')::uuid <> _pack_id THEN
        -- N'applique la liaison que si la formule liée vit dans le MÊME
        -- périmètre que celle du checkout.
        SELECT p.id, p.name INTO v_bound_pack, v_bound_name
          FROM public.table_packs p
         WHERE p.id = (v_table->>'packId')::uuid
           AND p.event_id IS NOT DISTINCT FROM v_pack_event
           AND p.venue_id IS NOT DISTINCT FROM v_pack_venue;
        IF v_bound_pack IS NOT NULL THEN
          RAISE EXCEPTION
            'Cette table se réserve avec la formule "%". Choisis cette formule ou une autre table.',
            v_bound_name
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.table_reservations (
    event_id, pack_id, zone_id, user_id, user_email, is_guest, guest_count,
    deposit, total_price, service_fee, management_fee, fee_absorbed, status, paid_at, qr_code,
    full_name, phone, remarks, newsletter_opt_in, sms_opt_in,
    requested_table_id, placement_status, purchase_source
  ) VALUES (
    _event_id, _pack_id, _zone_id, _user_id, _user_email, _is_guest, _guest_count,
    _deposit, _total_price, 0, _management_fee, _fee_absorbed, _status,
    CASE WHEN _status = 'paid' THEN now() ELSE NULL END, _qr_code,
    _full_name, _phone, _remarks, _newsletter_opt_in, _sms_opt_in,
    NULLIF(_requested_table_id, '')::uuid, COALESCE(NULLIF(_placement_status, ''), 'none'), _purchase_source
  )
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$function$;

-- ─── Salles VIP de l'organisateur : la liaison table ↔ formule survit ────────
-- L'instantané des packs porte désormais leur id (pour remapper `packId`
-- dans le plan), le mode de règlement et le plafond ; au rejeu, les packs
-- reçoivent de nouveaux ids et les tables du plan suivent.
CREATE OR REPLACE FUNCTION public.save_event_vip_room(
  p_event_id uuid,
  p_name text,
  p_room_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_org     uuid;
  v_name    text := NULLIF(btrim(p_name), '');
  v_loc     text;
  v_addr    text;
  v_layout  jsonb;
  v_bg      text;
  v_zones   jsonb;
  v_packs   jsonb;
  v_id      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT organizer_user_id, location_name, location_address
    INTO v_org, v_loc, v_addr
    FROM public.events WHERE id = p_event_id;
  IF v_org IS NULL OR NOT public.can_manage_organizer_rooms(v_uid, v_org) THEN
    RAISE EXCEPTION 'Not allowed to manage rooms for this event';
  END IF;
  IF v_name IS NULL THEN
    v_name := COALESCE(v_loc, 'Salle VIP');
  END IF;

  SELECT layout, background_image_url INTO v_layout, v_bg
    FROM public.venue_floor_plans WHERE event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', z.id, 'name', z.name, 'color', z.color,
           'tables_count', z.tables_count, 'position', z.position,
           'last_tables_threshold', z.last_tables_threshold
         ) ORDER BY z.position NULLS LAST, z.created_at), '[]'::jsonb)
    INTO v_zones
    FROM public.table_zones z WHERE z.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'zone_id', p.zone_id, 'name', p.name, 'description', p.description,
           'base_price', p.base_price, 'base_capacity', p.base_capacity,
           'extra_person_price', p.extra_person_price, 'max_extra_persons', p.max_extra_persons,
           'deposit', p.deposit, 'deposit_type', p.deposit_type,
           'included_items', p.included_items, 'included_bottles_quota', p.included_bottles_quota,
           'minimum_spend', p.minimum_spend, 'arrival_deadline', p.arrival_deadline,
           'tables_count', p.tables_count, 'limit_tables', p.limit_tables,
           'payment_mode', p.payment_mode,
           'position', p.position, 'is_active', p.is_active
         ) ORDER BY p.position NULLS LAST, p.created_at), '[]'::jsonb)
    INTO v_packs
    FROM public.table_packs p WHERE p.event_id = p_event_id;

  IF jsonb_array_length(v_zones) = 0 AND v_layout IS NULL THEN
    RAISE EXCEPTION 'Nothing to save: this event has no zones and no floor plan'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_room_id IS NOT NULL THEN
    UPDATE public.organizer_vip_rooms
       SET name = v_name,
           location_name = COALESCE(v_loc, location_name),
           location_address = COALESCE(v_addr, location_address),
           layout = COALESCE(v_layout, '{"tables": []}'::jsonb),
           background_image_url = v_bg,
           zones = v_zones,
           packs = v_packs,
           source_event_id = p_event_id,
           updated_at = now()
     WHERE id = p_room_id
       AND public.can_manage_organizer_rooms(v_uid, organizer_user_id)
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Room not found';
    END IF;
    RETURN v_id;
  END IF;

  INSERT INTO public.organizer_vip_rooms
    (organizer_user_id, name, location_name, location_address, layout, background_image_url, zones, packs, source_event_id)
  VALUES
    (v_org, v_name, v_loc, v_addr, COALESCE(v_layout, '{"tables": []}'::jsonb), v_bg, v_zones, v_packs, p_event_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_vip_room_to_event(p_room_id uuid, p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_room      public.organizer_vip_rooms%ROWTYPE;
  v_org       uuid;
  v_club      text;
  v_zone      jsonb;
  v_pack      jsonb;
  v_map       jsonb := '{}'::jsonb;   -- ancien id de zone → nouvel id
  v_pack_map  jsonb := '{}'::jsonb;   -- ancien id de pack → nouvel id
  v_new_zone  uuid;
  v_new_pack  uuid;
  v_old_zone  text;
  v_layout    jsonb;
  v_tables    jsonb := '[]'::jsonb;
  v_areas     jsonb := '[]'::jsonb;
  v_item      jsonb;
  v_mode      text;
  v_has_tbl   boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_room FROM public.organizer_vip_rooms WHERE id = p_room_id;
  IF v_room.id IS NULL OR NOT public.can_manage_organizer_rooms(v_uid, v_room.organizer_user_id) THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  SELECT organizer_user_id, COALESCE(venue_id, partner_venue_id)
    INTO v_org, v_club
    FROM public.events WHERE id = p_event_id;
  IF v_org IS NULL OR NOT public.can_manage_event_tables(v_uid, p_event_id) THEN
    RAISE EXCEPTION 'Not allowed to manage tables for this event';
  END IF;
  IF v_club IS NOT NULL THEN
    RAISE EXCEPTION 'A co-hosted event uses the club floor plan'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.table_reservations
     WHERE event_id = p_event_id AND status IN ('pending', 'paid', 'confirmed')
  ) THEN
    RAISE EXCEPTION 'This event already has table reservations: its tables cannot be replaced'
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.table_packs       WHERE event_id = p_event_id;
  DELETE FROM public.table_zones       WHERE event_id = p_event_id;
  DELETE FROM public.venue_floor_plans WHERE event_id = p_event_id;

  FOR v_zone IN SELECT * FROM jsonb_array_elements(v_room.zones) LOOP
    INSERT INTO public.table_zones
      (venue_id, event_id, created_by_user_id, name, color, tables_count, position, last_tables_threshold)
    VALUES
      (NULL, p_event_id, v_uid,
       v_zone->>'name', COALESCE(v_zone->>'color', '#3b82f6'),
       GREATEST(COALESCE((v_zone->>'tables_count')::int, 1), 1),
       (v_zone->>'position')::int,
       COALESCE((v_zone->>'last_tables_threshold')::int, 20))
    RETURNING id INTO v_new_zone;
    v_map := v_map || jsonb_build_object(v_zone->>'id', v_new_zone::text);
  END LOOP;

  FOR v_pack IN SELECT * FROM jsonb_array_elements(v_room.packs) LOOP
    v_old_zone := v_pack->>'zone_id';
    IF v_map ? v_old_zone THEN
      INSERT INTO public.table_packs
        (venue_id, event_id, created_by_user_id, zone_id, name, description,
         base_price, base_capacity, extra_person_price, max_extra_persons,
         deposit, deposit_type, included_items, included_bottles_quota,
         minimum_spend, arrival_deadline, tables_count, limit_tables, payment_mode,
         position, is_active)
      VALUES
        (NULL, p_event_id, v_uid, (v_map->>v_old_zone)::uuid,
         v_pack->>'name', v_pack->>'description',
         COALESCE((v_pack->>'base_price')::numeric, 0),
         GREATEST(COALESCE((v_pack->>'base_capacity')::int, 1), 1),
         COALESCE((v_pack->>'extra_person_price')::numeric, 0),
         COALESCE((v_pack->>'max_extra_persons')::int, 0),
         COALESCE((v_pack->>'deposit')::numeric, 0),
         COALESCE(v_pack->>'deposit_type', 'fixed'),
         v_pack->>'included_items',
         COALESCE((v_pack->>'included_bottles_quota')::int, 0),
         COALESCE((v_pack->>'minimum_spend')::numeric, 0),
         NULLIF(v_pack->>'arrival_deadline', ''),
         GREATEST(COALESCE((v_pack->>'tables_count')::int, 1), 1),
         COALESCE((v_pack->>'limit_tables')::boolean, false),
         COALESCE(v_pack->>'payment_mode', 'online'),
         (v_pack->>'position')::int,
         COALESCE((v_pack->>'is_active')::boolean, true))
      RETURNING id INTO v_new_pack;
      IF v_pack ? 'id' THEN
        v_pack_map := v_pack_map || jsonb_build_object(v_pack->>'id', v_new_pack::text);
      END IF;
    END IF;
  END LOOP;

  -- Plan : mêmes tables, mêmes positions, ids de zone ET de formule réécrits.
  v_layout := COALESCE(v_room.layout, '{"tables": []}'::jsonb);
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) LOOP
    IF v_item ? 'zoneId' AND v_map ? (v_item->>'zoneId') THEN
      v_item := v_item || jsonb_build_object('zoneId', v_map->>(v_item->>'zoneId'));
    ELSIF v_item ? 'zoneId' THEN
      v_item := v_item || jsonb_build_object('zoneId', NULL);
    END IF;
    IF v_item ? 'packId' AND v_pack_map ? (v_item->>'packId') THEN
      v_item := v_item || jsonb_build_object('packId', v_pack_map->>(v_item->>'packId'));
    ELSIF v_item ? 'packId' THEN
      v_item := v_item - 'packId' - 'packName';
    END IF;
    v_tables := v_tables || jsonb_build_array(v_item);
  END LOOP;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_layout->'zoneAreas', '[]'::jsonb)) LOOP
    IF v_map ? (v_item->>'zoneId') THEN
      v_areas := v_areas || jsonb_build_array(v_item || jsonb_build_object('zoneId', v_map->>(v_item->>'zoneId')));
    END IF;
  END LOOP;
  v_layout := v_layout || jsonb_build_object('tables', v_tables, 'zoneAreas', v_areas);

  INSERT INTO public.venue_floor_plans (venue_id, event_id, owner_user_id, layout, background_image_url)
  VALUES (NULL, p_event_id, v_uid, v_layout, v_room.background_image_url);

  v_has_tbl := jsonb_array_length(v_tables) > 0;
  v_mode := CASE WHEN v_has_tbl THEN 'elite' ELSE 'basic' END;

  UPDATE public.events
     SET tables_enabled         = true,
         tables_mode            = v_mode,
         tables_owner_user_id   = COALESCE(tables_owner_user_id, v_uid),
         tables_locked_to_venue = false
   WHERE id = p_event_id;

  UPDATE public.organizer_vip_rooms
     SET times_used = times_used + 1, last_used_at = now()
   WHERE id = p_room_id;

  RETURN v_mode;
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_vip_room_to_event(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_event_vip_room(uuid, text, uuid) TO authenticated;
