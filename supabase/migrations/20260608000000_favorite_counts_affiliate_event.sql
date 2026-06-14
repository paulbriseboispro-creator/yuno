-- Extend get_public_favorite_counts to handle 'affiliate_event' type.
-- Previously the CASE had no branch for affiliate_event_id, so counts were always NULL/0.

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
      WHEN _favorite_type = 'club'            THEN f.venue_id
      WHEN _favorite_type = 'event'           THEN f.event_id::text
      WHEN _favorite_type = 'drink'           THEN f.drink_id
      WHEN _favorite_type = 'dj'             THEN f.dj_id::text
      WHEN _favorite_type = 'affiliate_event' THEN f.affiliate_event_id::text
      WHEN _favorite_type = 'affiliate_venue' THEN f.affiliate_venue_id::text
      ELSE NULL
    END AS target_id
    FROM public.favorites f
    WHERE f.favorite_type = _favorite_type
  ) x
  WHERE x.target_id IS NOT NULL
  GROUP BY x.target_id;
$$;
