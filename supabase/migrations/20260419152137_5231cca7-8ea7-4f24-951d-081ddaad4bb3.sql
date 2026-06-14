-- Step 1: Drop legacy organizer system tables
DROP TABLE IF EXISTS public.organizer_followers CASCADE;
DROP TABLE IF EXISTS public.event_organizers CASCADE;
DROP TABLE IF EXISTS public.organizer_invitations CASCADE;
DROP TABLE IF EXISTS public.venue_organizers CASCADE;
DROP TABLE IF EXISTS public.organizers CASCADE;

-- Step 2: Update the discoverability trigger to also approve co-events (organizer + partner_venue)
CREATE OR REPLACE FUNCTION public.evaluate_event_discoverability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Organizer-led events (with or without partner venue)
  IF NEW.organizer_user_id IS NOT NULL THEN
    -- Private events: never discoverable
    IF NEW.event_kind = 'private_event' THEN
      NEW.is_discoverable := false;
    ELSIF NEW.event_kind = 'public_event' THEN
      IF NEW.visibility = 'public'
         AND NEW.poster_url IS NOT NULL
         AND LENGTH(COALESCE(NEW.title, '')) >= 5
         AND LENGTH(COALESCE(NEW.description, '')) >= 30
         AND NEW.start_at IS NOT NULL
         AND NEW.is_active = true
      THEN
        NEW.is_discoverable := true;
        NEW.discovery_status := 'approved';
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