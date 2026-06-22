-- DJ booking requests: capture the requested music style alongside the date,
-- time slot, fee and message so the owner sends a COMPLETE brief and the DJ sees
-- exactly what's being asked. Genres are a free-form text[] mirroring the
-- DJ_GENRES facet on the client (House, Techno, Rap / Hip-Hop, ...).

ALTER TABLE public.dj_booking_requests
  ADD COLUMN IF NOT EXISTS requested_genres text[] NOT NULL DEFAULT '{}';

-- Recreate create_dj_booking_request with the new p_requested_genres arg.
-- The argument list changes (9 -> 10), so CREATE OR REPLACE would leave a second
-- overload behind and make the call ambiguous to PostgREST. Drop the old exact
-- signature first.
DROP FUNCTION IF EXISTS public.create_dj_booking_request(uuid, date, timestamptz, timestamptz, numeric, text, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.create_dj_booking_request(
  p_dj_user_id        uuid,
  p_requested_date    date,
  p_start             timestamptz DEFAULT NULL,
  p_end               timestamptz DEFAULT NULL,
  p_agreed_fee        numeric     DEFAULT NULL,
  p_message           text        DEFAULT NULL,
  p_event_id          uuid        DEFAULT NULL,
  p_venue_id          text        DEFAULT NULL,
  p_organizer_user_id uuid        DEFAULT NULL,
  p_requested_genres  text[]      DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF (p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL)
     OR (p_venue_id IS NULL AND p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of venue or organizer scope is required';
  END IF;

  IF p_venue_id IS NOT NULL AND NOT public.is_venue_owner(auth.uid(), p_venue_id) THEN
    RAISE EXCEPTION 'Unauthorized: not the venue owner';
  END IF;
  IF p_organizer_user_id IS NOT NULL AND p_organizer_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: organizer scope mismatch';
  END IF;
  IF p_dj_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot book yourself'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.djs WHERE user_id = p_dj_user_id AND is_active = true) THEN
    RAISE EXCEPTION 'Target is not an active DJ';
  END IF;

  INSERT INTO public.dj_booking_requests (
    venue_id, organizer_user_id, created_by, dj_user_id, requested_date,
    start_time, end_time, agreed_fee, message, event_id, requested_genres
  ) VALUES (
    p_venue_id, p_organizer_user_id, auth.uid(), p_dj_user_id, p_requested_date,
    p_start, p_end, p_agreed_fee, NULLIF(btrim(p_message), ''), p_event_id,
    COALESCE(p_requested_genres, '{}')
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_dj_booking_request(uuid, date, timestamptz, timestamptz, numeric, text, uuid, text, uuid, text[]) TO authenticated;
