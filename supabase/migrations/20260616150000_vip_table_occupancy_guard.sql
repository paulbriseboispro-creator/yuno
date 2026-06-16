-- ============================================================================
-- COURT TERME — "table déjà prise" : empêcher d'affecter une table déjà occupée
--
-- Étend enforce_assigned_table_exists (migration 20260616140000) : en plus de
-- valider que la table existe dans le plan, on rejette désormais l'affectation
-- d'une table déjà tenue par une AUTRE réservation active (placed/active) pour
-- la même soirée. Couvre placement initial ET réaffectation host (les deux
-- écrivent assigned_table_id). Le host voit alors une erreur précise au lieu
-- d'un message générique, et deux clients ne peuvent pas finir à la même table.
--
-- NB : ce n'est pas 100 % "race-proof" sans index unique, mais l'affectation est
-- une action manuelle à faible concurrence ; le trigger couvre le cas réel.
-- Pure SQL, déployable via `supabase db push`.
-- ============================================================================

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
  SELECT layout INTO v_layout FROM public.venue_floor_plans WHERE venue_id = v_venue;
  IF v_layout IS NOT NULL THEN
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
  END IF;

  -- 2) The table must not already be held by another active reservation tonight.
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
