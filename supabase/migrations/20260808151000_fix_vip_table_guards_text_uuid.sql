-- ============================================================================
-- FIX — placement VIP cassé : « operator does not exist: text = uuid »
--
-- Symptôme : l'hôte VIP reçoit une réservation avec demande de table du client
-- (« a demandé Table 2 ») et, en cliquant « Installer à Table 2 », reçoit le
-- toast « operator does not exist: text = uuid ». Le placement (seatGuest dans
-- src/hooks/useVipNight.tsx) fait un UPDATE de table_reservations qui pose
-- assigned_table_id. Le trigger BEFORE UPDATE trg_enforce_assigned_table_exists
-- valide que la table existe dans le plan de salle en comparant l'id de table
-- du JSON à l'id posé.
--
-- Cause racine : depuis que assigned_table_id / requested_table_id sont des
-- colonnes uuid (nettoyage FK 20260730140000, cast confirmé dans
-- 20260727100000), le corps du guard compare un id JSON — `e->>'id'`, de type
-- TEXT — à `NEW.assigned_table_id`, de type UUID. Postgres résout l'opérateur au
-- PLAN de la requête EXISTS : dès que le venue a un plan de salle (v_layout NOT
-- NULL — vrai pour Womber, Irish, etc.), la comparaison text = uuid n'a pas
-- d'opérateur → 42883, quel que soit l'id posé. Tout placement d'invité échoue.
--
-- Les ids de table du plan (venue_floor_plans.layout->'tables'[].id) sont du
-- texte au format uuid ; la colonne est uuid. La comparaison correcte, celle
-- qu'utilise déjà reserve_table_slot (`assigned_table_id::text = v_requested`),
-- est de caster l'uuid en texte : `e->>'id' = NEW.assigned_table_id::text`.
--
-- Même classe de bug dans le guard jumeau prevent_floor_plan_table_removal
-- (trigger BEFORE UPDATE sur venue_floor_plans) : il compare
-- `tr.assigned_table_id` (uuid) `= ANY(v_removed)` (text[]) → uuid = text →
-- 42883. Il ne se déclenche que quand l'owner retire du plan une table portant
-- une réservation assise, mais c'est le miroir exact du même problème de type.
-- On le corrige dans le même passage : `tr.assigned_table_id::text = ANY(...)`.
--
-- Aucune signature ne change, aucune FK n'est (r)ajoutée, aucun code argent
-- touché. Corps identiques aux versions live, à l'exception des deux
-- comparaisons re-typées. Pur SQL — déployable via `supabase db push`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. enforce_assigned_table_exists — chemin du placement hôte VIP (seatGuest).
--    Corrige la comparaison JSON-id (text) vs assigned_table_id (uuid).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_assigned_table_exists()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venue text;
  v_layout jsonb;
BEGIN
  -- Only validate when a (new/changed) table is actually being assigned.
  -- Clearing to NULL (assign_on_arrival) is always allowed.
  IF NEW.assigned_table_id IS NULL
     OR NEW.assigned_table_id IS NOT DISTINCT FROM OLD.assigned_table_id THEN
    RETURN NEW;
  END IF;

  SELECT venue_id INTO v_venue FROM public.table_zones WHERE id = NEW.zone_id;
  IF v_venue IS NULL THEN
    RETURN NEW; -- no zone/venue context to validate against
  END IF;

  -- 1) The table must exist in the venue's current floor plan (if one exists).
  --    Layout ids are TEXT (uuid-shaped) in the JSONB blob; assigned_table_id
  --    is a uuid column. Cast the uuid to text to compare (no text = uuid op).
  SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE venue_id = v_venue;
  IF v_layout IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) AS e
      WHERE e->>'id' = NEW.assigned_table_id::text
    ) THEN
      RAISE EXCEPTION
        'Table "%" does not exist in this venue''s floor plan. Refresh the plan and pick an existing table.',
        NEW.assigned_table_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- 2) The table must not already be held by another active reservation tonight.
  --    Both sides are the uuid column here, so no cast is needed.
  IF EXISTS (
    SELECT 1
    FROM public.table_reservations tr2
    WHERE tr2.id <> NEW.id
      AND tr2.event_id = NEW.event_id
      AND tr2.assigned_table_id = NEW.assigned_table_id
      AND tr2.vip_status IN ('placed', 'active')
      AND tr2.status NOT IN ('cancelled', 'refunded')
  ) THEN
    RAISE EXCEPTION
      'Table "%" is already taken by another guest tonight.',
      NEW.assigned_table_id
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. prevent_floor_plan_table_removal — chemin owner (édition du plan).
--    Corrige la comparaison assigned_table_id (uuid) vs v_removed (text[]).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_floor_plan_table_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_removed text[];
BEGIN
  -- Table ids present in OLD but not in NEW = removed in this save.
  SELECT array_agg(old_id) INTO v_removed
  FROM (
    SELECT e->>'id' AS old_id
    FROM jsonb_array_elements(COALESCE(OLD.layout->'tables', '[]'::jsonb)) AS e
    EXCEPT
    SELECT e->>'id'
    FROM jsonb_array_elements(COALESCE(NEW.layout->'tables', '[]'::jsonb)) AS e
  ) sub;

  IF v_removed IS NULL OR array_length(v_removed, 1) IS NULL THEN
    RETURN NEW; -- nothing removed
  END IF;

  -- v_removed is text[] (JSON ids); assigned_table_id is uuid. Cast the uuid to
  -- text so the ANY() comparison has a valid text = text operator.
  IF EXISTS (
    SELECT 1
    FROM public.table_reservations tr
    JOIN public.table_zones tz ON tz.id = tr.zone_id
    WHERE tz.venue_id = NEW.venue_id
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
