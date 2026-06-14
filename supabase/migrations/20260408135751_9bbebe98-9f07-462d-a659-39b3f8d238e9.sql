ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS free_drink_mode TEXT DEFAULT 'credits';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'venues_free_drink_mode_check'
  ) THEN
    ALTER TABLE public.venues ADD CONSTRAINT venues_free_drink_mode_check
      CHECK (free_drink_mode IN ('credits', 'bouncer_notify'));
  END IF;
END $$;