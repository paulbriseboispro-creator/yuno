-- 1. Add event_kind enum and column on events (privacy moved from profile to event)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_kind') THEN
    CREATE TYPE public.event_kind AS ENUM ('public_event', 'private_event');
  END IF;
END$$;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS event_kind public.event_kind NOT NULL DEFAULT 'public_event';

-- Backfill: events created by private_organizer profiles → private_event
UPDATE public.events e
SET event_kind = 'private_event'
FROM public.profiles p
WHERE e.organizer_user_id = p.id
  AND p.profile_type::text = 'private_organizer';

-- 2. Migrate all private_organizer profiles → organizer
UPDATE public.profiles
SET profile_type = 'organizer'
WHERE profile_type::text = 'private_organizer';

-- 3. Recreate profile_type enum without private_organizer
ALTER TYPE public.profile_type RENAME TO profile_type_old;
CREATE TYPE public.profile_type AS ENUM ('club', 'organizer');

ALTER TABLE public.profiles
  ALTER COLUMN profile_type DROP DEFAULT,
  ALTER COLUMN profile_type TYPE public.profile_type
    USING (
      CASE profile_type::text
        WHEN 'private_organizer' THEN 'organizer'::public.profile_type
        ELSE profile_type::text::public.profile_type
      END
    ),
  ALTER COLUMN profile_type SET DEFAULT 'club'::public.profile_type;

DROP TYPE public.profile_type_old;

-- 4. Update evaluate_event_discoverability to depend on event_kind, not profile type
CREATE OR REPLACE FUNCTION public.evaluate_event_discoverability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.organizer_user_id IS NOT NULL AND NEW.venue_id IS NULL THEN
    -- Private events (BDE / closed audience): NEVER discoverable. Direct link only.
    IF NEW.event_kind = 'private_event' THEN
      NEW.is_discoverable := false;
    -- Public events: discoverable only if marked public + quality criteria met
    ELSIF NEW.event_kind = 'public_event' THEN
      IF NEW.visibility = 'public'
         AND NEW.poster_url IS NOT NULL
         AND LENGTH(COALESCE(NEW.title, '')) >= 10
         AND LENGTH(COALESCE(NEW.description, '')) >= 50
         AND NEW.start_at IS NOT NULL
         AND NEW.start_at > now()
         AND NEW.is_active = true
      THEN
        NEW.is_discoverable := true;
      ELSE
        NEW.is_discoverable := false;
      END IF;
    ELSE
      NEW.is_discoverable := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;