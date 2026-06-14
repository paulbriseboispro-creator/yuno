-- Follow-up hardening: security-invoker views + aggregate favorite RPCs

ALTER VIEW public.app_settings_public SET (security_invoker = true);
ALTER VIEW public.djs_public SET (security_invoker = true);
ALTER VIEW public.venue_subscription_public SET (security_invoker = true);
DROP VIEW IF EXISTS public.favorite_counts;

GRANT SELECT (id, maintenance_mode, maintenance_message, terms_version, terms_url, updated_at)
ON public.app_settings TO anon, authenticated;

GRANT SELECT (
  id, venue_id, first_name, last_name, stage_name, instagram_url, tiktok_url,
  music_genres, bio, description, profile_image_url, cover_image_url,
  soundcloud_url, spotify_url, youtube_url, country, city, is_verified, is_active, slug
)
ON public.djs TO anon, authenticated;

GRANT SELECT (venue_id, subscription_plan, status)
ON public.venue_subscriptions TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_favorite_count(
  _favorite_type text,
  _venue_id text DEFAULT NULL,
  _event_id uuid DEFAULT NULL,
  _drink_id text DEFAULT NULL,
  _dj_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.favorites f
  WHERE f.favorite_type = _favorite_type
    AND (_venue_id IS NULL OR f.venue_id = _venue_id)
    AND (_event_id IS NULL OR f.event_id = _event_id)
    AND (_drink_id IS NULL OR f.drink_id = _drink_id)
    AND (_dj_id IS NULL OR f.dj_id = _dj_id);
$$;

CREATE OR REPLACE FUNCTION public.get_public_favorite_counts(_favorite_type text)
RETURNS TABLE(target_id text, total_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x.target_id, count(*)::integer AS total_count
  FROM (
    SELECT CASE
      WHEN _favorite_type = 'club' THEN f.venue_id
      WHEN _favorite_type = 'event' THEN f.event_id::text
      WHEN _favorite_type = 'drink' THEN f.drink_id
      WHEN _favorite_type = 'dj' THEN f.dj_id::text
      ELSE NULL
    END AS target_id
    FROM public.favorites f
    WHERE f.favorite_type = _favorite_type
  ) x
  WHERE x.target_id IS NOT NULL
  GROUP BY x.target_id;
$$;

REVOKE ALL ON FUNCTION public.get_public_favorite_count(text, text, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_favorite_counts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_favorite_count(text, text, uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_favorite_counts(text) TO anon, authenticated;