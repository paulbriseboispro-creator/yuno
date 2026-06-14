ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS rounds_visibility text NOT NULL DEFAULT 'sequential';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_rounds_visibility_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_rounds_visibility_check
      CHECK (rounds_visibility IN ('sequential','preview_upcoming','all_open'));
  END IF;
END$$;

COMMENT ON COLUMN public.events.rounds_visibility IS
'Controls how upcoming ticket rounds are displayed/sold: sequential = only current round visible, preview_upcoming = upcoming rounds visible but locked, all_open = all rounds available in parallel.';