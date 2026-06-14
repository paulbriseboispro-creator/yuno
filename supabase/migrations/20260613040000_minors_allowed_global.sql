-- "Alcohol-free / minors allowed" moves from a per-ticket-round flag to a global
-- setting owned by the event creator (venue OR organizer), with a per-event opt-out.
--   venues.minors_allowed              — owner-level global
--   organizer_profiles.minors_allowed  — organizer-level global
--   events.minors_disabled             — per-event opt-out (only meaningful when global on)
--   events.alcohol_free                — denormalized effective value, maintained by triggers
--                                        so every consumer reads a single field. "Live": flipping
--                                        a global recomputes alcohol_free for all of its events.

-- 1. Global toggles
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS minors_allowed boolean NOT NULL DEFAULT false;
ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS minors_allowed boolean NOT NULL DEFAULT false;

-- 2. Per-event opt-out + denormalized effective flag
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS minors_disabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS alcohol_free boolean NOT NULL DEFAULT false;

-- 3. Per-round flag is no longer used (concept moved to event level).
ALTER TABLE public.ticket_rounds DROP COLUMN IF EXISTS alcohol_free;
ALTER TABLE public.ticket_presets DROP COLUMN IF EXISTS alcohol_free;

-- 4. Recompute events.alcohol_free from the creator's global + the per-event opt-out.
--    venue_id present → venue governs (it's where alcohol is served), else the organizer.
CREATE OR REPLACE FUNCTION public.compute_event_alcohol_free()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  global_allowed boolean := false;
BEGIN
  IF NEW.venue_id IS NOT NULL THEN
    SELECT COALESCE(minors_allowed, false) INTO global_allowed
      FROM public.venues WHERE id = NEW.venue_id;
  ELSIF NEW.organizer_user_id IS NOT NULL THEN
    SELECT COALESCE(minors_allowed, false) INTO global_allowed
      FROM public.organizer_profiles WHERE user_id = NEW.organizer_user_id;
  END IF;
  NEW.alcohol_free := COALESCE(global_allowed, false) AND NOT COALESCE(NEW.minors_disabled, false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_alcohol_free ON public.events;
CREATE TRIGGER trg_event_alcohol_free
  BEFORE INSERT OR UPDATE OF venue_id, organizer_user_id, minors_disabled ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.compute_event_alcohol_free();

-- 5. When a venue's global flips, recompute all of its events (live behavior).
CREATE OR REPLACE FUNCTION public.sync_events_alcohol_free_from_venue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.minors_allowed IS DISTINCT FROM OLD.minors_allowed THEN
    UPDATE public.events
      SET alcohol_free = NEW.minors_allowed AND NOT COALESCE(minors_disabled, false)
      WHERE venue_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_venue_minors_allowed ON public.venues;
CREATE TRIGGER trg_venue_minors_allowed
  AFTER UPDATE OF minors_allowed ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.sync_events_alcohol_free_from_venue();

-- 6. Same for an organizer's global (only their solo events — venue events follow the venue).
CREATE OR REPLACE FUNCTION public.sync_events_alcohol_free_from_organizer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.minors_allowed IS DISTINCT FROM OLD.minors_allowed THEN
    UPDATE public.events
      SET alcohol_free = NEW.minors_allowed AND NOT COALESCE(minors_disabled, false)
      WHERE organizer_user_id = NEW.user_id AND venue_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organizer_minors_allowed ON public.organizer_profiles;
CREATE TRIGGER trg_organizer_minors_allowed
  AFTER UPDATE OF minors_allowed ON public.organizer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_events_alcohol_free_from_organizer();
