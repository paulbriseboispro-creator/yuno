-- =============================================================================
-- Co-soirée : la vente de tables de l'organisateur est VERROUILLÉE sur le plan
-- du club.
--
-- Demande (Paul) : quand l'orga active la vente de tables sur une co-soirée, il
-- ne repart pas d'une feuille blanche — il réutilise le PLAN DE SALLE et les
-- ZONES que le club a déjà configurés. Il ne règle que ses packs/prix par-dessus.
--
-- Implémentation : à l'activation, on CLONE les zones de niveau venue du club
-- (table_zones où event_id IS NULL) en zones event-scopées, et on clone l'image
-- du plan de salle du club. Le front rend ensuite l'onglet Zones + Plan en
-- lecture seule (verrouillé) et ne laisse éditer que les Packs.
--
--   • events.tables_locked_to_venue  : drapeau lu par le front pour verrouiller.
--   • enable_collab_basic_tables(...) : RPC d'activation atomique (clone + flags).
--
-- Bonus — correctif d'un bug latent : venue_floor_plans.venue_id était UNIQUE,
-- ce qui empêchait de stocker à la fois le plan de niveau venue (event_id NULL)
-- ET un plan event-scopé pour le même club (l'upload event-scopé échouait en
-- silence). On remplace la contrainte par deux index uniques partiels.
-- =============================================================================

-- 1. Drapeau "tables verrouillées sur le plan du club" ------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS tables_locked_to_venue boolean NOT NULL DEFAULT false;

-- 2. Correctif contrainte venue_floor_plans -----------------------------------
-- Un venue peut avoir UN plan de niveau venue (event_id NULL) + N plans
-- event-scopés. L'ancienne UNIQUE(venue_id) interdisait ce deuxième cas.
ALTER TABLE public.venue_floor_plans
  DROP CONSTRAINT IF EXISTS venue_floor_plans_venue_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_venue_floor_plans_venue_level
  ON public.venue_floor_plans(venue_id) WHERE event_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_venue_floor_plans_event
  ON public.venue_floor_plans(event_id) WHERE event_id IS NOT NULL;

-- 3. RPC d'activation — clone le plan du club et verrouille --------------------
CREATE OR REPLACE FUNCTION public.enable_collab_basic_tables(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_club       text;
  v_zone_count int;
  v_plan_url   text;
  v_plan_layout jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_manage_event_tables(v_uid, p_event_id) THEN
    RAISE EXCEPTION 'Not allowed to manage tables for this event';
  END IF;

  SELECT COALESCE(venue_id, partner_venue_id)
    INTO v_club
    FROM public.events
   WHERE id = p_event_id;

  -- Clone des zones de niveau venue du club → zones event-scopées (une fois).
  IF v_club IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.table_zones WHERE event_id = p_event_id
  ) THEN
    INSERT INTO public.table_zones (venue_id, event_id, created_by_user_id, name, color, tables_count, position)
    SELECT z.venue_id, p_event_id, v_uid, z.name, z.color, z.tables_count, z.position
      FROM public.table_zones z
     WHERE z.venue_id = v_club
       AND z.event_id IS NULL;
  END IF;

  SELECT count(*) INTO v_zone_count
    FROM public.table_zones
   WHERE event_id = p_event_id;

  -- Clone de l'image du plan de salle du club → plan event-scopé (une fois).
  IF v_club IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_floor_plans WHERE event_id = p_event_id
  ) THEN
    SELECT background_image_url, layout
      INTO v_plan_url, v_plan_layout
      FROM public.venue_floor_plans
     WHERE venue_id = v_club AND event_id IS NULL;
    IF v_plan_url IS NOT NULL THEN
      INSERT INTO public.venue_floor_plans (venue_id, event_id, owner_user_id, background_image_url, layout)
      VALUES (v_club, p_event_id, v_uid, v_plan_url, COALESCE(v_plan_layout, '{"tables": []}'::jsonb));
    END IF;
  END IF;

  -- On verrouille seulement s'il existe vraiment un plan club à reprendre.
  UPDATE public.events
     SET tables_enabled        = true,
         tables_mode           = 'basic',
         tables_owner_user_id  = v_uid,
         tables_locked_to_venue = (v_zone_count > 0)
   WHERE id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enable_collab_basic_tables(uuid) TO authenticated;
