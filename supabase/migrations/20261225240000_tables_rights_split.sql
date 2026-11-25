-- Tables VIP, vague A bis — I2 : la porte « tables » ne s'ouvre plus à la billetterie.
--
-- Constat (relecture, I2) : 20261225130000 élargissait `can_manage_event_tables` au manager de club « tables » ET à l'équipe
-- d'organisation. Or cette fonction sert aussi de porte « gérer la soirée » à la BILLETTERIE (set_event_sale_password,
-- event_scarcity_settings, can_manage_ticket_groups, _mcp_ticketing, ticket_rounds) : un manager qui n'a que la permission
-- « Tables VIP » gagnait mot de passe de prévente, rareté, packs de billets et, par son IA branchée en MCP, la billetterie libre.
--
-- Décision de Paul (D11) : les administrateurs et éditeurs d'une organisation gèrent tables ET billetterie de ses soirées ;
-- le scanneur non. Le manager de club, lui, ne gère que les TABLES.
--   • can_manage_event_tables  = sa définition d'avant la vague A (organisateur, partenaire sous « operations », propriétaire de
--     tables, propriétaire du club, co-hôte éditeur, super admin) + l'équipe d'organisation admin / éditeur (invitation acceptée).
--     SANS la branche manager de club.
--   • can_manage_event_vip_tables (nouvelle) = can_manage_event_tables + le manager d'un club hôte / partenaire qui a la
--     permission « tables », sous la même condition de domaine « operations » que le propriétaire du club.
-- Utilisée par les policies table_packs / table_zones / venue_floor_plans (donc upsert_event_floor_plan, qui s'exécute sous RLS),
-- set_event_tables_mode, apply_vip_room_to_event et — via _can_manage_table_reservation — vip_set_table_placement et
-- cancel_unpaid_table_reservation. Les fonctions de billetterie gardent can_manage_event_tables.
-- enable_collab_tables / enable_collab_basic_tables gardent aussi can_manage_event_tables (hors liste ; un manager n'y a jamais eu droit).
--
-- Exécutable par anon comme sa sœur : les policies ALL des trois tables s'évaluent aussi pour la lecture publique.

CREATE OR REPLACE FUNCTION public.can_manage_event_tables(_user_id uuid, _event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    LEFT JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
    CROSS JOIN LATERAL (
      SELECT public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations') AS ops
    ) h
    WHERE e.id = _event_id
      AND (
        e.organizer_user_id = _user_id
        OR (e.partner_organizer_id = _user_id AND h.ops IN ('organizer','both'))
        OR e.tables_owner_user_id = _user_id
        OR (v.owner_id = _user_id AND h.ops IN ('venue','both'))
        -- Équipe de l'organisation (admin ou éditeur, jamais un scanneur ni une invitation en attente).
        OR (_user_id IS NOT NULL AND (
              public.is_org_team_member(_user_id, e.organizer_user_id, 'editor')
              OR public.is_org_team_member(_user_id, e.tables_owner_user_id, 'editor')
              OR (h.ops IN ('organizer','both')
                  AND public.is_org_team_member(_user_id, e.partner_organizer_id, 'editor'))
        ))
        OR public.is_super_admin()
      )
  ) OR public.is_event_cohost(_event_id, _user_id, 'editor')
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_event_vip_tables(_user_id uuid, _event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.can_manage_event_tables(_user_id, _event_id)
      OR EXISTS (
        SELECT 1 FROM public.events e
        JOIN public.venues v ON v.id = e.venue_id OR v.id = e.partner_venue_id
        CROSS JOIN LATERAL (
          SELECT public.collab_domain_holder(e.collab_responsibilities, e.event_mode, 'operations') AS ops
        ) h
        WHERE e.id = _event_id
          AND _user_id IS NOT NULL
          AND h.ops IN ('venue','both')
          AND public.manager_has_permission(_user_id, v.id, 'tables')
      )
$function$;

REVOKE ALL ON FUNCTION public.can_manage_event_vip_tables(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_event_vip_tables(uuid, uuid) TO anon, authenticated, service_role;

-- ── Droits d'une réservation (placement, annulation sans paiement) ───────────────────────────────────────────────────────────
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
  IF public.can_manage_event_vip_tables(p_uid, p_event_id)
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

-- ── Fonctions de configuration des tables (définitions vivantes, seule la porte change) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_vip_room_to_event(p_room_id uuid, p_event_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF v_org IS NULL OR NOT public.can_manage_event_vip_tables(v_uid, p_event_id) THEN
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
$function$;
REVOKE ALL ON FUNCTION public.apply_vip_room_to_event(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_vip_room_to_event(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_event_tables_mode(p_event_id uuid, p_mode text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_club   text;
  v_layout jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_mode NOT IN ('basic', 'elite') THEN
    RAISE EXCEPTION 'Invalid tables mode';
  END IF;
  IF NOT public.can_manage_event_vip_tables(v_uid, p_event_id) THEN
    RAISE EXCEPTION 'Not allowed to manage tables for this event';
  END IF;

  SELECT COALESCE(venue_id, partner_venue_id) INTO v_club
    FROM public.events WHERE id = p_event_id;
  IF v_club IS NOT NULL THEN
    RAISE EXCEPTION 'Tables mode follows the club floor plan on a co-hosted event';
  END IF;

  IF p_mode = 'elite' THEN
    SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE event_id = p_event_id;
    IF v_layout IS NULL OR jsonb_array_length(COALESCE(v_layout->'tables', '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'Build an interactive floor plan with at least one table before enabling table picking'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.events
     SET tables_mode = p_mode,
         tables_locked_to_venue = false
   WHERE id = p_event_id;

  RETURN p_mode;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_event_tables_mode(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_tables_mode(uuid, text) TO authenticated, service_role;

-- ── Policies : formules, zones et plans (mêmes règles que 20261225100000, porte « tables » au lieu de « soirée ») ───────────────
-- ── table_packs ──────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Event-scoped packs manageable by event managers" ON public.table_packs;
CREATE POLICY "Event-scoped packs manageable by event managers"
  ON public.table_packs FOR ALL TO authenticated
  USING (event_id IS NOT NULL AND public.can_manage_event_vip_tables(auth.uid(), event_id))
  WITH CHECK (
    event_id IS NOT NULL
    AND public.can_manage_event_vip_tables(auth.uid(), event_id)
    AND (venue_id IS NULL OR EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = table_packs.event_id
         AND table_packs.venue_id IN (e.venue_id, e.partner_venue_id)))
  );

DROP POLICY IF EXISTS "Owners can manage their venue table packs" ON public.table_packs;
CREATE POLICY "Owners can manage their venue table packs"
  ON public.table_packs FOR ALL TO public
  USING (
    has_role(auth.uid(), 'owner'::app_role)
    AND (is_venue_owner(auth.uid(), venue_id)
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.venue_id = table_packs.venue_id))
    AND (event_id IS NULL OR public.can_manage_event_vip_tables(auth.uid(), event_id))
  )
  WITH CHECK (
    has_role(auth.uid(), 'owner'::app_role)
    AND (is_venue_owner(auth.uid(), venue_id)
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.venue_id = table_packs.venue_id))
    AND (event_id IS NULL OR (
      public.can_manage_event_vip_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = table_packs.event_id
                     AND table_packs.venue_id IN (e.venue_id, e.partner_venue_id))))
  );

DROP POLICY IF EXISTS "Owners and managers can insert table packs" ON public.table_packs;
CREATE POLICY "Owners and managers can insert table packs"
  ON public.table_packs FOR INSERT TO public
  WITH CHECK (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR (
      public.can_manage_event_vip_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = table_packs.event_id
                     AND table_packs.venue_id IN (e.venue_id, e.partner_venue_id))))
  );

DROP POLICY IF EXISTS "Owners and managers can update table packs" ON public.table_packs;
CREATE POLICY "Owners and managers can update table packs"
  ON public.table_packs FOR UPDATE TO public
  USING (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR public.can_manage_event_vip_tables(auth.uid(), event_id))
  )
  WITH CHECK (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR (
      public.can_manage_event_vip_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = table_packs.event_id
                     AND table_packs.venue_id IN (e.venue_id, e.partner_venue_id))))
  );

DROP POLICY IF EXISTS "Owners and managers can delete table packs" ON public.table_packs;
CREATE POLICY "Owners and managers can delete table packs"
  ON public.table_packs FOR DELETE TO public
  USING (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR public.can_manage_event_vip_tables(auth.uid(), event_id))
  );

-- ── table_zones ──────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Event-scoped zones manageable by event managers" ON public.table_zones;
CREATE POLICY "Event-scoped zones manageable by event managers"
  ON public.table_zones FOR ALL TO authenticated
  USING (event_id IS NOT NULL AND public.can_manage_event_vip_tables(auth.uid(), event_id))
  WITH CHECK (
    event_id IS NOT NULL
    AND public.can_manage_event_vip_tables(auth.uid(), event_id)
    AND (venue_id IS NULL OR EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = table_zones.event_id
         AND table_zones.venue_id IN (e.venue_id, e.partner_venue_id)))
  );

DROP POLICY IF EXISTS "Owners can manage their venue table zones" ON public.table_zones;
CREATE POLICY "Owners can manage their venue table zones"
  ON public.table_zones FOR ALL TO public
  USING (
    has_role(auth.uid(), 'owner'::app_role)
    AND (is_venue_owner(auth.uid(), venue_id)
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.venue_id = table_zones.venue_id))
    AND (event_id IS NULL OR public.can_manage_event_vip_tables(auth.uid(), event_id))
  )
  WITH CHECK (
    has_role(auth.uid(), 'owner'::app_role)
    AND (is_venue_owner(auth.uid(), venue_id)
         OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.venue_id = table_zones.venue_id))
    AND (event_id IS NULL OR (
      public.can_manage_event_vip_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = table_zones.event_id
                     AND table_zones.venue_id IN (e.venue_id, e.partner_venue_id))))
  );

DROP POLICY IF EXISTS "Owners and managers can insert table zones" ON public.table_zones;
CREATE POLICY "Owners and managers can insert table zones"
  ON public.table_zones FOR INSERT TO public
  WITH CHECK (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR (
      public.can_manage_event_vip_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = table_zones.event_id
                     AND table_zones.venue_id IN (e.venue_id, e.partner_venue_id))))
  );

DROP POLICY IF EXISTS "Owners and managers can update table zones" ON public.table_zones;
CREATE POLICY "Owners and managers can update table zones"
  ON public.table_zones FOR UPDATE TO public
  USING (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR public.can_manage_event_vip_tables(auth.uid(), event_id))
  )
  WITH CHECK (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR (
      public.can_manage_event_vip_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = table_zones.event_id
                     AND table_zones.venue_id IN (e.venue_id, e.partner_venue_id))))
  );

DROP POLICY IF EXISTS "Owners and managers can delete table zones" ON public.table_zones;
CREATE POLICY "Owners and managers can delete table zones"
  ON public.table_zones FOR DELETE TO public
  USING (
    (is_venue_owner(auth.uid(), venue_id) OR manager_has_permission(auth.uid(), venue_id, 'tables'::text))
    AND (event_id IS NULL OR public.can_manage_event_vip_tables(auth.uid(), event_id))
  );

-- ── venue_floor_plans ────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Event-scoped floor plans manageable by event managers" ON public.venue_floor_plans;
CREATE POLICY "Event-scoped floor plans manageable by event managers"
  ON public.venue_floor_plans FOR ALL TO authenticated
  USING (event_id IS NOT NULL AND public.can_manage_event_vip_tables(auth.uid(), event_id))
  WITH CHECK (
    event_id IS NOT NULL
    AND public.can_manage_event_vip_tables(auth.uid(), event_id)
    AND (venue_id IS NULL OR EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = venue_floor_plans.event_id
         AND venue_floor_plans.venue_id IN (e.venue_id, e.partner_venue_id)))
  );

DROP POLICY IF EXISTS "Owners can manage their venue floor plan" ON public.venue_floor_plans;
CREATE POLICY "Owners can manage their venue floor plan"
  ON public.venue_floor_plans FOR ALL TO public
  USING (
    is_venue_owner(auth.uid(), venue_id)
    AND (event_id IS NULL OR public.can_manage_event_vip_tables(auth.uid(), event_id))
  )
  WITH CHECK (
    is_venue_owner(auth.uid(), venue_id)
    AND (event_id IS NULL OR (
      public.can_manage_event_vip_tables(auth.uid(), event_id)
      AND EXISTS (SELECT 1 FROM public.events e
                   WHERE e.id = venue_floor_plans.event_id
                     AND venue_floor_plans.venue_id IN (e.venue_id, e.partner_venue_id))))
  );
