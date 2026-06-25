-- =============================================================================
-- Co-soirée : la vente de tables réutilise le plan ÉLITE interactif du club.
--
-- Évolution de enable_collab_basic_tables : quand le club partenaire a un VRAI
-- plan de salle interactif (venue_floor_plans.layout.tables non vide), la
-- co-soirée passe en mode ÉLITE — le client choisit sa table sur le plan du
-- club, exactement comme les soirées élite du club. Sinon on retombe sur le
-- mode BASIC (zones/packs verrouillés, l'orga règle ses prix).
--
-- enable_collab_tables(p_event_id) RETURNS le mode résolu ('elite' | 'basic') :
--   ÉLITE :
--     • tables_mode = 'elite' ; copie event-scopée du plan du club (layout +
--       image) pour que l'orga le lise (RLS event-scope) et que le checkout le
--       résolve event-scope ;
--     • venues.vip_placement_enabled = true sur le club (le placement interactif
--       est requis côté checkout ; le club a déjà construit un plan, c'est son
--       intention). Idempotent.
--     • Les zones/packs (prix) restent ceux du club (venue-scopés) — le checkout
--       élite les lit par venue_id.
--   BASIC : comportement existant (clone des zones du club + image, prix orga).
--
-- L'ancienne enable_collab_basic_tables est conservée (compat front déjà déployé).
-- =============================================================================
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

  -- Plan de salle de niveau venue du club.
  SELECT layout, background_image_url INTO v_layout, v_bg
    FROM public.venue_floor_plans
   WHERE venue_id = v_club AND event_id IS NULL;

  v_has_tables := v_club IS NOT NULL
    AND v_layout IS NOT NULL
    AND jsonb_array_length(COALESCE(v_layout->'tables', '[]'::jsonb)) > 0;

  IF v_has_tables THEN
    -- ─── ÉLITE : plan interactif du club ──────────────────────────────────────
    v_mode := 'elite';

    -- Copie event-scopée du plan (lecture orga via RLS event-scope + résolution
    -- checkout event-scope). Une seule fois.
    IF NOT EXISTS (SELECT 1 FROM public.venue_floor_plans WHERE event_id = p_event_id) THEN
      INSERT INTO public.venue_floor_plans (venue_id, event_id, owner_user_id, background_image_url, layout)
      VALUES (v_club, p_event_id, v_uid, v_bg, COALESCE(v_layout, '{"tables": []}'::jsonb));
    END IF;

    -- Le placement interactif doit être actif côté venue pour que le client
    -- puisse choisir sa table (le club a déjà un plan → intention de placement).
    UPDATE public.venues
       SET vip_placement_enabled = true
     WHERE id = v_club AND vip_placement_enabled IS DISTINCT FROM true;

  ELSE
    -- ─── BASIC : zones verrouillées, prix orga ────────────────────────────────
    v_mode := 'basic';

    IF v_club IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.table_zones WHERE event_id = p_event_id) THEN
      INSERT INTO public.table_zones (venue_id, event_id, created_by_user_id, name, color, tables_count, position)
      SELECT z.venue_id, p_event_id, v_uid, z.name, z.color, z.tables_count, z.position
        FROM public.table_zones z
       WHERE z.venue_id = v_club AND z.event_id IS NULL;
    END IF;

    IF v_club IS NOT NULL AND v_bg IS NOT NULL
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
