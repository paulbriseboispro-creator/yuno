-- 1. Update discoverability trigger to drop bde reference
CREATE OR REPLACE FUNCTION public.evaluate_event_discoverability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_profile_type text;
BEGIN
  IF NEW.organizer_user_id IS NOT NULL AND NEW.venue_id IS NULL THEN
    SELECT profile_type::text INTO v_owner_profile_type
    FROM public.profiles
    WHERE id = NEW.organizer_user_id;

    -- Private organizers (BDE, private collectives, corporate): NEVER discoverable.
    -- Direct link only — preserves Explore UX for users outside the closed audience.
    IF v_owner_profile_type = 'private_organizer' THEN
      NEW.is_discoverable := false;
    -- Standalone organizers: discoverable only if public + quality criteria met
    ELSIF v_owner_profile_type = 'organizer' THEN
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

-- 2. Update platform_invitations CHECK constraint (drop old, add new)
ALTER TABLE public.platform_invitations
  DROP CONSTRAINT IF EXISTS platform_invitations_profile_type_check;

ALTER TABLE public.platform_invitations
  ADD CONSTRAINT platform_invitations_profile_type_check
  CHECK (profile_type IN ('organizer', 'private_organizer'));

-- 3. Rebuild the profile_type enum without 'bde'
ALTER TYPE public.profile_type RENAME TO profile_type_old;

CREATE TYPE public.profile_type AS ENUM ('club', 'organizer', 'private_organizer');

ALTER TABLE public.profiles
  ALTER COLUMN profile_type DROP DEFAULT;

ALTER TABLE public.profiles
  ALTER COLUMN profile_type TYPE public.profile_type
  USING profile_type::text::public.profile_type;

ALTER TABLE public.profiles
  ALTER COLUMN profile_type SET DEFAULT 'club'::public.profile_type;

DROP TYPE public.profile_type_old;