-- =============================================================================
-- Salles VIP d'un organisateur : l'historique réutilisable de ses plans.
--
-- Un organisateur solo construit ses zones, ses packs et son plan de salle
-- SUR une soirée (tout est event-scopé, migration 20260904120000). S'il refait
-- une soirée dans le même établissement, il ne doit pas tout recréer :
-- `organizer_vip_rooms` garde une photo (plan + zones + packs) qu'il peut
-- rejouer sur n'importe quelle soirée à venir, et supprimer s'il sait qu'il
-- n'y retournera jamais.
--
--   • save_event_vip_room(p_event_id, p_name, p_room_id)  : photo d'une soirée
--     → nouvelle salle, ou mise à jour d'une salle existante (même nom).
--   • apply_vip_room_to_event(p_room_id, p_event_id)       : rejoue la salle
--     sur une soirée SANS club : zones et packs clonés avec de NOUVEAUX ids, et
--     le plan réécrit avec les nouveaux ids de zone (tables + zoneAreas), sinon
--     les tables du plan pointeraient des zones mortes et le checkout casserait.
--     Refusé si la soirée porte déjà des réservations actives (on ne remplace
--     pas un inventaire vendu).
--   • create_manual_table_reservation : s'ouvre à l'organisateur de la soirée
--     (zone event-scopée sans club) — la porte ne connaissait que le club.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.organizer_vip_rooms (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  location_name        text,
  location_address     text,
  layout               jsonb NOT NULL DEFAULT '{"tables": []}'::jsonb,
  background_image_url text,
  zones                jsonb NOT NULL DEFAULT '[]'::jsonb,
  packs                jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_event_id      uuid REFERENCES public.events(id) ON DELETE SET NULL,
  times_used           integer NOT NULL DEFAULT 0,
  last_used_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizer_vip_rooms_owner
  ON public.organizer_vip_rooms(organizer_user_id, updated_at DESC);

ALTER TABLE public.organizer_vip_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Organizers manage their VIP rooms" ON public.organizer_vip_rooms;
CREATE POLICY "Organizers manage their VIP rooms"
  ON public.organizer_vip_rooms FOR ALL TO authenticated
  USING (
    organizer_user_id = auth.uid()
    OR public.is_org_team_member(auth.uid(), organizer_user_id, 'editor')
  )
  WITH CHECK (
    organizer_user_id = auth.uid()
    OR public.is_org_team_member(auth.uid(), organizer_user_id, 'editor')
  );

-- Qui peut agir sur les salles d'un organisateur : lui, ou son équipe éditrice.
CREATE OR REPLACE FUNCTION public.can_manage_organizer_rooms(_user_id uuid, _organizer_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND _organizer_user_id IS NOT NULL AND (
    _user_id = _organizer_user_id
    OR public.is_org_team_member(_user_id, _organizer_user_id, 'editor')
    OR public.is_super_admin()
  )
$$;

-- ─── Photo d'une soirée → salle VIP ───────────────────────────────────────────
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
           'zone_id', p.zone_id, 'name', p.name, 'description', p.description,
           'base_price', p.base_price, 'base_capacity', p.base_capacity,
           'extra_person_price', p.extra_person_price, 'max_extra_persons', p.max_extra_persons,
           'deposit', p.deposit, 'deposit_type', p.deposit_type,
           'included_items', p.included_items, 'included_bottles_quota', p.included_bottles_quota,
           'minimum_spend', p.minimum_spend, 'arrival_deadline', p.arrival_deadline,
           'tables_count', p.tables_count, 'position', p.position, 'is_active', p.is_active
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

GRANT EXECUTE ON FUNCTION public.save_event_vip_room(uuid, text, uuid) TO authenticated;

-- ─── Rejouer une salle VIP sur une soirée ─────────────────────────────────────
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
  v_new_zone  uuid;
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

  -- Inventaire précédent de la soirée : remplacé (aucune réservation active).
  DELETE FROM public.table_packs       WHERE event_id = p_event_id;
  DELETE FROM public.table_zones       WHERE event_id = p_event_id;
  DELETE FROM public.venue_floor_plans WHERE event_id = p_event_id;

  -- Zones : nouveaux ids, mapping conservé pour les packs et le plan.
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

  -- Packs : rattachés à la nouvelle zone correspondante.
  FOR v_pack IN SELECT * FROM jsonb_array_elements(v_room.packs) LOOP
    v_old_zone := v_pack->>'zone_id';
    IF v_map ? v_old_zone THEN
      INSERT INTO public.table_packs
        (venue_id, event_id, created_by_user_id, zone_id, name, description,
         base_price, base_capacity, extra_person_price, max_extra_persons,
         deposit, deposit_type, included_items, included_bottles_quota,
         minimum_spend, arrival_deadline, tables_count, position, is_active)
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
         (v_pack->>'position')::int,
         COALESCE((v_pack->>'is_active')::boolean, true));
    END IF;
  END LOOP;

  -- Plan : mêmes tables, mêmes positions, ids de zone réécrits.
  v_layout := COALESCE(v_room.layout, '{"tables": []}'::jsonb);
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) LOOP
    IF v_item ? 'zoneId' AND v_map ? (v_item->>'zoneId') THEN
      v_item := v_item || jsonb_build_object('zoneId', v_map->>(v_item->>'zoneId'));
    ELSIF v_item ? 'zoneId' THEN
      v_item := v_item || jsonb_build_object('zoneId', NULL);
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

-- ─── Réservation manuelle : ouverte à l'organisateur de la soirée ─────────────
-- Zone event-scopée sans club (venue_id NULL) : la porte est l'organisateur
-- (ou son équipe éditrice). Le chemin club est inchangé.
CREATE OR REPLACE FUNCTION public.create_manual_table_reservation(
  p_event_id uuid, p_zone_id uuid,
  p_full_name text DEFAULT NULL, p_phone text DEFAULT NULL, p_email text DEFAULT NULL,
  p_guest_count integer DEFAULT 1, p_total_price numeric DEFAULT 0, p_minimum_spend numeric DEFAULT 0,
  p_assigned_table_id uuid DEFAULT NULL, p_remarks text DEFAULT NULL, p_open_tab boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
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
      OR (public.get_user_venue_id(v_uid) = v_venue AND public.has_role(v_uid, 'vip_host'))
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
    (v_email <> '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
