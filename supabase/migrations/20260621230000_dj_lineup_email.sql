-- Email targets for DJ lineup notifications.
--
-- Like get_dj_lineup_notification_targets (push), but returns emails instead of
-- push subscription tokens. The city geo-filter is identical; notify_all_locations
-- is dropped (the toggle on the public DJ page is removed — email coverage improves
-- naturally as profiles.city is populated over time).
--
-- Dedup: shares the same dj_lineup_notifications table as push, so each subscriber
-- gets at most one notification per event per DJ (push wins when available, email
-- reaches the rest). Called by send-push-notification after the push loop.

CREATE OR REPLACE FUNCTION public.get_dj_lineup_email_targets(
  p_event_id uuid,
  p_dj_id    uuid
) RETURNS TABLE (
  user_id            uuid,
  email              text,
  first_name         text,
  preferred_language text,
  unsubscribe_token  text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_city text;
  v_ok   boolean;
BEGIN
  SELECT e.location_city,
         (e.is_active AND e.end_at >= now() AND e.visibility = 'public')
    INTO v_city, v_ok
  FROM public.events e WHERE e.id = p_event_id;

  -- Silent if city unknown or event not suitable for public notification.
  IF NOT FOUND OR v_ok IS NOT TRUE OR v_city IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (f.user_id)
    f.user_id,
    p.email,
    p.first_name,
    p.preferred_language,
    p.unsubscribe_token
  FROM public.favorites f
  JOIN public.profiles p ON p.id = f.user_id
  WHERE f.dj_id = p_dj_id
    AND f.favorite_type = 'dj'
    AND p.email IS NOT NULL
    AND p.city IS NOT NULL
    AND (
      lower(btrim(p.city)) = lower(btrim(v_city))
      OR position(lower(btrim(v_city)) IN lower(btrim(p.city))) > 0
      OR position(lower(btrim(p.city)) IN lower(btrim(v_city))) > 0
    )
    -- Already notified by push or a previous email → skip.
    AND NOT EXISTS (
      SELECT 1 FROM public.dj_lineup_notifications n
      WHERE n.user_id = f.user_id AND n.event_id = p_event_id AND n.dj_id = p_dj_id
    )
  ORDER BY f.user_id, f.created_at ASC;
END; $$;

REVOKE ALL ON FUNCTION public.get_dj_lineup_email_targets(uuid,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dj_lineup_email_targets(uuid,uuid) TO service_role;
