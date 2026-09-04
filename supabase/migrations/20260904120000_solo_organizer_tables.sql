-- =============================================================================
-- Tables VIP d'un organisateur SEUL (soirée sans club rattaché).
--
-- Jusqu'ici le pilier tables n'existait que pour les co-soirées : les zones,
-- packs et plans de salle exigeaient un `venue_id` NOT NULL, l'activation
-- clonait le plan « du club », et le checkout refusait toute soirée sans club
-- (« Les tables VIP nécessitent un club partenaire »). Un organisateur qui loue
-- une salle ou organise dans un lieu hors Yuno (WOH, 11/09) ne pouvait donc
-- créer aucune table, alors qu'il vend déjà ses billets en autonomie.
--
-- Cette migration donne à l'organisateur solo LE MÊME SYSTÈME que le club :
--   • zones + packs + plan de salle event-scopés, sans club (venue_id NULL) ;
--   • plan interactif (mode élite : le client choisit sa table) construit par
--     l'organisateur lui-même, via `upsert_event_floor_plan` ;
--   • `enable_collab_tables` reconnaît la soirée sans club et ne verrouille rien ;
--   • `set_event_tables_mode` bascule basic ⇄ élite sur une soirée sans club ;
--   • le bucket `floor-plans` s'ouvre aux organisateurs AU SENS APPLICATIF
--     (profil organisateur), pas seulement au rôle `organizer` de user_roles
--     qu'aucun parcours d'inscription ne pose.
-- L'argent ne change pas : le checkout tables suit désormais la même
-- résolution que les billets (compte Stripe Connect de l'organisateur, charge
-- directe, commission Yuno en application_fee).
-- =============================================================================

-- 1. Une zone / un pack / un plan peut vivre SANS club, mais jamais sans portée.
ALTER TABLE public.table_zones       ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE public.table_packs       ALTER COLUMN venue_id DROP NOT NULL;
ALTER TABLE public.venue_floor_plans ALTER COLUMN venue_id DROP NOT NULL;

ALTER TABLE public.table_zones
  DROP CONSTRAINT IF EXISTS table_zones_scope_check,
  ADD CONSTRAINT table_zones_scope_check CHECK (venue_id IS NOT NULL OR event_id IS NOT NULL);
ALTER TABLE public.table_packs
  DROP CONSTRAINT IF EXISTS table_packs_scope_check,
  ADD CONSTRAINT table_packs_scope_check CHECK (venue_id IS NOT NULL OR event_id IS NOT NULL);
ALTER TABLE public.venue_floor_plans
  DROP CONSTRAINT IF EXISTS venue_floor_plans_scope_check,
  ADD CONSTRAINT venue_floor_plans_scope_check CHECK (venue_id IS NOT NULL OR event_id IS NOT NULL);

-- 2. Garde « table assise » du plan : matcher par soirée quand le plan est
--    event-scopé. Avec venue_id NULL, `tz.venue_id = NEW.venue_id` valait NULL
--    et la garde se taisait pour les plans d'organisateur.
CREATE OR REPLACE FUNCTION public.prevent_floor_plan_table_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_removed text[];
BEGIN
  SELECT array_agg(old_id) INTO v_removed
  FROM (
    SELECT e->>'id' AS old_id
    FROM jsonb_array_elements(COALESCE(OLD.layout->'tables', '[]'::jsonb)) AS e
    EXCEPT
    SELECT e->>'id'
    FROM jsonb_array_elements(COALESCE(NEW.layout->'tables', '[]'::jsonb)) AS e
  ) sub;

  IF v_removed IS NULL OR array_length(v_removed, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.table_reservations tr
    LEFT JOIN public.table_zones tz ON tz.id = tr.zone_id
    WHERE (
        (NEW.event_id IS NOT NULL AND tr.event_id = NEW.event_id)
        OR (NEW.event_id IS NULL AND NEW.venue_id IS NOT NULL AND tz.venue_id = NEW.venue_id)
      )
      AND tr.assigned_table_id::text = ANY(v_removed)
      AND tr.vip_status IN ('placed', 'active')
      AND tr.status NOT IN ('cancelled', 'refunded')
  ) THEN
    RAISE EXCEPTION
      'Cannot remove a table that currently has a seated VIP reservation. Finish service or reassign those tables first.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Plan de salle EVENT-scopé, écrit par l'organisateur (ou le gestionnaire
--    de la soirée). Miroir de upsert_venue_floor_plan : SECURITY INVOKER, donc
--    la policy « Event-scoped floor plans manageable by event managers »
--    (can_manage_event_tables) et la garde ci-dessus s'appliquent telles
--    quelles. venue_id hérite du club de la soirée s'il y en a un.
CREATE OR REPLACE FUNCTION public.upsert_event_floor_plan(
  p_event_id uuid,
  p_layout jsonb,
  p_background_image_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SET search_path TO 'public'
AS $$
  INSERT INTO public.venue_floor_plans (venue_id, event_id, layout, background_image_url, owner_user_id, updated_at)
  SELECT COALESCE(e.venue_id, e.partner_venue_id), e.id, p_layout, p_background_image_url, auth.uid(), now()
    FROM public.events e
   WHERE e.id = p_event_id
  ON CONFLICT (event_id) WHERE event_id IS NOT NULL
  DO UPDATE SET
    layout               = EXCLUDED.layout,
    background_image_url = EXCLUDED.background_image_url,
    updated_at           = now()
  RETURNING id;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_event_floor_plan(uuid, jsonb, text) TO authenticated;

-- 4. Activation : la soirée SANS club garde ses propres zones / packs / plan.
--    Élite si l'organisateur a déjà construit un plan interactif event-scopé
--    (au moins une table posée), basic sinon. Jamais de verrouillage.
--    Le chemin AVEC club est inchangé.
CREATE OR REPLACE FUNCTION public.enable_collab_tables(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_club       text;
  v_layout     jsonb;
  v_bg         text;
  v_has_tables boolean := false;
  v_zone_count int;
  v_mode       text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_manage_event_tables(v_uid, p_event_id) THEN
    RAISE EXCEPTION 'Not allowed to manage tables for this event';
  END IF;

  SELECT COALESCE(venue_id, partner_venue_id) INTO v_club
    FROM public.events WHERE id = p_event_id;

  -- ─── Soirée SANS club : l'organisateur est son propre « club » ────────────
  IF v_club IS NULL THEN
    SELECT layout INTO v_layout
      FROM public.venue_floor_plans
     WHERE event_id = p_event_id;
    v_has_tables := v_layout IS NOT NULL
      AND jsonb_array_length(COALESCE(v_layout->'tables', '[]'::jsonb)) > 0;

    UPDATE public.events
       SET tables_enabled         = true,
           -- Élite dès qu'un plan interactif existe, basic pour démarrer.
           tables_mode            = CASE WHEN v_has_tables THEN 'elite' ELSE 'basic' END,
           tables_owner_user_id   = COALESCE(tables_owner_user_id, v_uid),
           tables_locked_to_venue = false
     WHERE id = p_event_id
     RETURNING tables_mode INTO v_mode;

    RETURN v_mode;
  END IF;

  -- ─── Soirée AVEC club (co-soirée) : comportement historique ───────────────
  SELECT layout, background_image_url INTO v_layout, v_bg
    FROM public.venue_floor_plans
   WHERE venue_id = v_club AND event_id IS NULL;

  v_has_tables := v_layout IS NOT NULL
    AND jsonb_array_length(COALESCE(v_layout->'tables', '[]'::jsonb)) > 0;

  IF v_has_tables THEN
    v_mode := 'elite';

    IF NOT EXISTS (SELECT 1 FROM public.venue_floor_plans WHERE event_id = p_event_id) THEN
      INSERT INTO public.venue_floor_plans (venue_id, event_id, owner_user_id, background_image_url, layout)
      VALUES (v_club, p_event_id, v_uid, v_bg, COALESCE(v_layout, '{"tables": []}'::jsonb));
    END IF;

    UPDATE public.venues
       SET vip_placement_enabled = true
     WHERE id = v_club AND vip_placement_enabled IS DISTINCT FROM true;

  ELSE
    v_mode := 'basic';

    IF NOT EXISTS (SELECT 1 FROM public.table_zones WHERE event_id = p_event_id) THEN
      INSERT INTO public.table_zones (venue_id, event_id, created_by_user_id, name, color, tables_count, position)
      SELECT z.venue_id, p_event_id, v_uid, z.name, z.color, z.tables_count, z.position
        FROM public.table_zones z
       WHERE z.venue_id = v_club AND z.event_id IS NULL;
    END IF;

    IF v_bg IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.venue_floor_plans WHERE event_id = p_event_id) THEN
      INSERT INTO public.venue_floor_plans (venue_id, event_id, owner_user_id, background_image_url, layout)
      VALUES (v_club, p_event_id, v_uid, v_bg, '{"tables": []}'::jsonb);
    END IF;
  END IF;

  SELECT count(*) INTO v_zone_count FROM public.table_zones WHERE event_id = p_event_id;

  UPDATE public.events
     SET tables_enabled         = true,
         tables_mode            = v_mode,
         tables_owner_user_id   = v_uid,
         tables_locked_to_venue = (v_mode = 'elite' OR v_zone_count > 0)
   WHERE id = p_event_id;

  RETURN v_mode;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enable_collab_tables(uuid) TO authenticated;

-- 5. Basculer basic ⇄ élite sur une soirée SANS club. L'élite exige un plan
--    interactif event-scopé avec au moins une table : sans plan, le client
--    n'aurait rien à choisir et le checkout le renverrait au mode basic.
--    Réservé aux soirées sans club : sur une co-soirée, le mode suit le plan du
--    club (enable_collab_tables) et n'est pas négociable ici.
CREATE OR REPLACE FUNCTION public.set_event_tables_mode(p_event_id uuid, p_mode text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  IF NOT public.can_manage_event_tables(v_uid, p_event_id) THEN
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
$$;

GRANT EXECUTE ON FUNCTION public.set_event_tables_mode(uuid, text) TO authenticated;

-- 6. Bucket `floor-plans` : ouvert aux organisateurs au sens APPLICATIF.
--    Les anciennes policies testaient has_role(uid, 'organizer'), rôle que le
--    parcours d'inscription ne pose jamais — l'import d'un plan par un vrai
--    organisateur mourait en « new row violates row-level security policy ».
CREATE OR REPLACE FUNCTION public.can_manage_floor_plan_assets()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin()
    OR public.has_role(auth.uid(), 'owner'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'organizer'::app_role)
    OR EXISTS (SELECT 1 FROM public.venues WHERE owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.organizer_profiles WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND profile_type = 'organizer')
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_floor_plan_assets() TO authenticated;

DROP POLICY IF EXISTS "Owners/organizers/admins upload floor plans" ON storage.objects;
CREATE POLICY "Owners/organizers/admins upload floor plans"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'floor-plans' AND public.can_manage_floor_plan_assets());

DROP POLICY IF EXISTS "Owners/organizers/admins update floor plans" ON storage.objects;
CREATE POLICY "Owners/organizers/admins update floor plans"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'floor-plans' AND public.can_manage_floor_plan_assets())
  WITH CHECK (bucket_id = 'floor-plans' AND public.can_manage_floor_plan_assets());

DROP POLICY IF EXISTS "Owners/organizers/admins delete floor plans" ON storage.objects;
CREATE POLICY "Owners/organizers/admins delete floor plans"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'floor-plans' AND public.can_manage_floor_plan_assets());
