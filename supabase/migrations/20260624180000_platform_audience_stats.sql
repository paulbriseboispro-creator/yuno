-- ============================================================
-- Platform-wide audience & funnel analytics for the super-admin
-- "Global Analytics" page (/admin/analytics).
--
-- visitor_sessions has no super-admin SELECT policy and a client
-- fetch is capped at 10k rows, so we aggregate server-side here.
-- Strictly gated on is_super_admin(); one jsonb payload per call.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_platform_audience_stats(
  p_from timestamptz,
  p_to timestamptz,
  p_venue_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH s AS (
    SELECT *
    FROM public.visitor_sessions
    WHERE visited_at >= p_from
      AND visited_at <= p_to
      AND (p_venue_id IS NULL OR venue_id = p_venue_id)
  )
  SELECT jsonb_build_object(
    'funnel', jsonb_build_object(
      'visitors',    (SELECT COUNT(*) FROM s),
      'carts',       (SELECT COUNT(*) FROM s WHERE added_to_cart),
      'checkouts',   (SELECT COUNT(*) FROM s WHERE proceeded_to_checkout),
      'conversions', (SELECT COUNT(*) FROM s WHERE completed_order)
    ),
    'engagement', jsonb_build_object(
      'unique_visitors',       (SELECT COUNT(DISTINCT visitor_id) FROM s WHERE visitor_id IS NOT NULL),
      'avg_duration_s',        (SELECT COALESCE(AVG(duration_seconds), 0)::int FROM s WHERE duration_seconds IS NOT NULL),
      'avg_scroll',            (SELECT COALESCE(AVG(scroll_depth_max), 0)::int FROM s WHERE scroll_depth_max IS NOT NULL),
      'bounce_count',          (SELECT COUNT(*) FROM s WHERE COALESCE(duration_seconds, 0) < 10 AND COALESCE(pages_viewed, 1) <= 1),
      'returning_count',       (SELECT COUNT(*) FROM s WHERE COALESCE(is_returning, false)),
      'abandoned_carts',       (SELECT COUNT(*) FROM s WHERE added_to_cart AND NOT completed_order),
      'abandoned_value_cents', (SELECT COALESCE(SUM(cart_value_cents), 0) FROM s WHERE added_to_cart AND NOT completed_order)
    ),
    'devices', jsonb_build_object(
      'mobile',       (SELECT COUNT(*) FROM s WHERE device_type = 'mobile'),
      'tablet',       (SELECT COUNT(*) FROM s WHERE device_type = 'tablet'),
      'desktop',      (SELECT COUNT(*) FROM s WHERE device_type = 'desktop'),
      'mobile_conv',  (SELECT COUNT(*) FROM s WHERE device_type = 'mobile'  AND completed_order),
      'tablet_conv',  (SELECT COUNT(*) FROM s WHERE device_type = 'tablet'  AND completed_order),
      'desktop_conv', (SELECT COUNT(*) FROM s WHERE device_type = 'desktop' AND completed_order)
    ),
    'sources', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.visits DESC) FROM (
        SELECT COALESCE(NULLIF(referrer_category, ''), 'unknown') AS referrer_category,
               COUNT(*)                                 AS visits,
               COUNT(*) FILTER (WHERE completed_order)  AS conversions
        FROM s
        GROUP BY COALESCE(NULLIF(referrer_category, ''), 'unknown')
      ) x
    ), '[]'::jsonb),
    'top_campaigns', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.visits DESC) FROM (
        SELECT utm_campaign,
               MAX(utm_source)                          AS utm_source,
               COUNT(*)                                 AS visits,
               COUNT(*) FILTER (WHERE completed_order)  AS conversions
        FROM s
        WHERE utm_campaign IS NOT NULL AND utm_campaign <> ''
        GROUP BY utm_campaign
        ORDER BY COUNT(*) DESC
        LIMIT 8
      ) x
    ), '[]'::jsonb),
    'entry_pages', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.visits DESC) FROM (
        SELECT COALESCE(NULLIF(entry_page_type, ''), 'unknown') AS entry_page_type,
               COUNT(*)                                 AS visits,
               COUNT(*) FILTER (WHERE completed_order)  AS conversions
        FROM s
        GROUP BY COALESCE(NULLIF(entry_page_type, ''), 'unknown')
        ORDER BY COUNT(*) DESC
        LIMIT 8
      ) x
    ), '[]'::jsonb),
    'new_vs_returning', jsonb_build_object(
      'new_visits',       (SELECT COUNT(*) FROM s WHERE NOT COALESCE(is_returning, false)),
      'new_conv',         (SELECT COUNT(*) FROM s WHERE NOT COALESCE(is_returning, false) AND completed_order),
      'returning_visits', (SELECT COUNT(*) FROM s WHERE COALESCE(is_returning, false)),
      'returning_conv',   (SELECT COUNT(*) FROM s WHERE COALESCE(is_returning, false) AND completed_order)
    ),
    'trend', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.day) FROM (
        SELECT to_char(date_trunc('day', visited_at), 'YYYY-MM-DD') AS day,
               COUNT(*)                                 AS visits,
               COUNT(*) FILTER (WHERE completed_order)  AS conversions
        FROM s
        GROUP BY date_trunc('day', visited_at)
      ) x
    ), '[]'::jsonb),
    -- dow: 0=Sunday..6=Saturday, hour: 0..23 (UTC). Frontend remaps to Mon-first.
    'heatmap', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT EXTRACT(dow  FROM visited_at)::int AS dow,
               EXTRACT(hour FROM visited_at)::int AS hour,
               COUNT(*)                           AS count
        FROM s
        GROUP BY 1, 2
      ) x
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_audience_stats(timestamptz, timestamptz, text) TO authenticated;
