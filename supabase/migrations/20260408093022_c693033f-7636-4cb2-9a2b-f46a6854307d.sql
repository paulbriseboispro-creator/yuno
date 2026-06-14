ALTER TABLE public.event_scarcity_settings
  ADD COLUMN IF NOT EXISTS emoji_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS display_caps_per_round jsonb DEFAULT '{}'::jsonb;

UPDATE public.event_scarcity_settings
SET
  emoji_enabled = COALESCE(emoji_enabled, true),
  display_caps_per_round = COALESCE(display_caps_per_round, '{}'::jsonb),
  show_remaining_count = CASE
    WHEN COALESCE(low_stock_enabled, false) AND COALESCE(show_remaining_count, false) THEN false
    ELSE COALESCE(show_remaining_count, false)
  END,
  display_cap_enabled = CASE
    WHEN COALESCE(show_remaining_count, false) THEN COALESCE(display_cap_enabled, false)
    ELSE false
  END;

ALTER TABLE public.event_scarcity_settings
  ALTER COLUMN emoji_enabled SET DEFAULT true,
  ALTER COLUMN emoji_enabled SET NOT NULL,
  ALTER COLUMN display_caps_per_round SET DEFAULT '{}'::jsonb,
  ALTER COLUMN display_caps_per_round SET NOT NULL;

CREATE OR REPLACE FUNCTION public.normalize_event_scarcity_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.emoji_enabled := COALESCE(NEW.emoji_enabled, true);
  NEW.display_caps_per_round := COALESCE(NEW.display_caps_per_round, '{}'::jsonb);

  IF COALESCE(NEW.low_stock_enabled, false) AND COALESCE(NEW.show_remaining_count, false) THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.show_remaining_count IS DISTINCT FROM OLD.show_remaining_count
         AND NEW.low_stock_enabled IS NOT DISTINCT FROM OLD.low_stock_enabled THEN
        NEW.low_stock_enabled := false;
      ELSIF NEW.low_stock_enabled IS DISTINCT FROM OLD.low_stock_enabled
         AND NEW.show_remaining_count IS NOT DISTINCT FROM OLD.show_remaining_count THEN
        NEW.show_remaining_count := false;
      ELSE
        NEW.show_remaining_count := false;
      END IF;
    ELSE
      NEW.show_remaining_count := false;
    END IF;
  END IF;

  IF NOT COALESCE(NEW.show_remaining_count, false) THEN
    NEW.display_cap_enabled := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_event_scarcity_settings_trigger ON public.event_scarcity_settings;

CREATE TRIGGER normalize_event_scarcity_settings_trigger
BEFORE INSERT OR UPDATE ON public.event_scarcity_settings
FOR EACH ROW
EXECUTE FUNCTION public.normalize_event_scarcity_settings();