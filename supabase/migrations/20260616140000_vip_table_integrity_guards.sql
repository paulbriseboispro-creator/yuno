-- ============================================================================
-- CRITIQUE #3 — VIP table placement integrity ("ghost table" prevention)
--
-- assigned_table_id / requested_table_id are ids into the floor-plan JSONB blob
-- (venue_floor_plans.layout->'tables'[].id). There is no FK and nothing validated
-- the id, so:
--   (a) a placement could point at a table id that does not exist in the layout;
--   (b) deleting/moving a table in the editor after a guest was placed left the
--       reservation pointing at a table that no longer exists.
--
-- Two BEFORE UPDATE triggers close both holes at the source, so every client
-- path (host placement, owner approve, owner modify, future code) is covered:
--   1. table_reservations: when assigned_table_id is being set, it must exist in
--      the venue's current floor plan.
--   2. venue_floor_plans: a table cannot be removed from the layout while a live
--      (placed/active) reservation is seated at it.
--
-- Pure SQL — deployable with `supabase db push` (no edge-function deploy needed).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. assigned_table_id must reference a table that exists in the floor plan.
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

  SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE venue_id = v_venue;
  IF v_layout IS NULL THEN
    -- Venue has no floor plan (auto-assign only): nothing to validate against.
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(v_layout->'tables', '[]'::jsonb)) AS e
    WHERE e->>'id' = NEW.assigned_table_id
  ) THEN
    RAISE EXCEPTION
      'Table "%" does not exist in this venue''s floor plan. Refresh the plan and pick an existing table.',
      NEW.assigned_table_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_assigned_table_exists ON public.table_reservations;
CREATE TRIGGER trg_enforce_assigned_table_exists
  BEFORE UPDATE ON public.table_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_assigned_table_exists();

-- ----------------------------------------------------------------------------
-- 2. A table with live reservations cannot be removed from the floor plan.
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

  IF EXISTS (
    SELECT 1
    FROM public.table_reservations tr
    JOIN public.table_zones tz ON tz.id = tr.zone_id
    WHERE tz.venue_id = NEW.venue_id
      AND tr.assigned_table_id = ANY(v_removed)
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

DROP TRIGGER IF EXISTS trg_prevent_floor_plan_table_removal ON public.venue_floor_plans;
CREATE TRIGGER trg_prevent_floor_plan_table_removal
  BEFORE UPDATE ON public.venue_floor_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_floor_plan_table_removal();
