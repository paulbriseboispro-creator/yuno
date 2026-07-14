-- =============================================================================
-- Correctif : le plan de salle de niveau venue n'était plus enregistrable.
--
-- 20260624190000_collab_tables_lock_to_venue a DROP la contrainte
-- venue_floor_plans_venue_id_key (UNIQUE(venue_id)) et l'a remplacée par deux
-- index uniques PARTIELS :
--   • uq_venue_floor_plans_venue_level ON (venue_id) WHERE event_id IS NULL
--   • uq_venue_floor_plans_event       ON (event_id) WHERE event_id IS NOT NULL
--
-- Or FloorPlanEditor écrit via PostgREST en `upsert(..., onConflict: 'venue_id')`,
-- ce qui produit `ON CONFLICT (venue_id) DO UPDATE`. Postgres ne sait PAS inférer
-- un index unique partiel sans qu'on lui répète son prédicat : depuis le
-- 2026-06-24, toute sauvegarde du plan owner échoue en
--   42P10 "there is no unique or exclusion constraint matching the ON CONFLICT
--   specification".
-- PostgREST ne peut pas émettre le `WHERE event_id IS NULL` de l'inférence, donc
-- l'écriture passe désormais par cette RPC, qui l'écrit explicitement.
--
-- SECURITY INVOKER : la RLS de venue_floor_plans continue de s'appliquer telle
-- quelle (policy « Owners can manage their venue floor plan »). Le trigger
-- trg_prevent_floor_plan_table_removal reste actif et remonte toujours 23514.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.upsert_venue_floor_plan(
  p_venue_id text,
  p_layout jsonb,
  p_background_image_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  INSERT INTO public.venue_floor_plans (venue_id, event_id, layout, background_image_url, owner_user_id, updated_at)
  VALUES (p_venue_id, NULL, p_layout, p_background_image_url, auth.uid(), now())
  ON CONFLICT (venue_id) WHERE event_id IS NULL
  DO UPDATE SET
    layout               = EXCLUDED.layout,
    background_image_url = EXCLUDED.background_image_url,
    updated_at           = now()
  RETURNING id;
$$;

COMMENT ON FUNCTION public.upsert_venue_floor_plan(text, jsonb, text) IS
  'Écrit le plan de salle de niveau venue (event_id NULL) de façon atomique. Nécessaire car PostgREST ne peut pas inférer l''index unique partiel uq_venue_floor_plans_venue_level.';

REVOKE ALL ON FUNCTION public.upsert_venue_floor_plan(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_venue_floor_plan(text, jsonb, text) TO authenticated;
