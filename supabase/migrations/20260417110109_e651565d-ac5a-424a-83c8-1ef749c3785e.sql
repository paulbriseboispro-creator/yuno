-- Differentiate organizer (discoverable) vs BDE/private_organizer (direct link only)
-- BDE = student association: events stay invisible from Explore to preserve UX for non-students

CREATE OR REPLACE FUNCTION public.evaluate_event_discoverability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_profile_type text;
BEGIN
  -- Only auto-evaluate organizer-owned events; club events keep their existing behavior
  IF NEW.organizer_user_id IS NOT NULL AND NEW.venue_id IS NULL THEN
    -- Look up the owner's profile type
    SELECT profile_type::text INTO v_owner_profile_type
    FROM public.profiles
    WHERE id = NEW.organizer_user_id;

    -- BDE & private organizers: NEVER discoverable, regardless of quality.
    -- Their events are accessible only via direct link, to preserve Explore UX
    -- for users outside the school / private circle.
    IF v_owner_profile_type IN ('bde', 'private_organizer') THEN
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
      -- Unknown profile type owning a standalone event: default to hidden
      NEW.is_discoverable := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Re-evaluate all existing standalone events so BDE events get hidden retroactively
UPDATE public.events e
SET is_discoverable = false
FROM public.profiles p
WHERE e.organizer_user_id = p.id
  AND e.venue_id IS NULL
  AND p.profile_type IN ('bde', 'private_organizer');