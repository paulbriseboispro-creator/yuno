-- Yuno Links — les soirées cliquées depuis l'affiche gardent leur titre même
-- quand ce sont des soirées partenaires (affiliate_events, pas dans `events`) :
-- le clic emporte le titre dans `meta`, l'analytics le lit en repli.

CREATE OR REPLACE FUNCTION public.get_links_analytics(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_from      timestamptz := p_from;
  v_to        timestamptz := p_to;
  v_gran      text;
  v_step      interval;
  v_totals    jsonb;
  v_series    jsonb;
  v_targets   jsonb;
  v_events    jsonb;
  v_langs     jsonb;
  v_countries jsonb;
  v_devices   jsonb;
  v_referrers jsonb;
  v_utm       jsonb;
  v_wl_cities jsonb;
  v_lead_types jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_from IS NULL OR v_to IS NULL OR v_to <= v_from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;
  IF v_to - v_from > interval '400 days' THEN v_from := v_to - interval '400 days'; END IF;
  IF v_to - v_from <= interval '3 days' THEN
    v_gran := 'hour'; v_step := interval '1 hour';
  ELSE
    v_gran := 'day'; v_step := interval '1 day';
  END IF;

  SELECT jsonb_build_object(
    'views',          count(*) FILTER (WHERE kind = 'view'),
    'visitors',       count(DISTINCT visitor_hash) FILTER (WHERE kind = 'view'),
    'clicks',         count(*) FILTER (WHERE kind = 'click'),
    'click_visitors', count(DISTINCT visitor_hash) FILTER (WHERE kind = 'click'),
    'waitlist',       count(*) FILTER (WHERE kind = 'waitlist' AND target = 'joined'),
    'pro_leads',      count(*) FILTER (WHERE kind = 'pro_lead')
  )
  INTO v_totals
  FROM links_events
  WHERE occurred_at >= v_from AND occurred_at < v_to;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           't', b.bucket,
           'views',    coalesce(x.views, 0),
           'visitors', coalesce(x.visitors, 0),
           'clicks',   coalesce(x.clicks, 0),
           'signups',  coalesce(x.signups, 0)
         ) ORDER BY b.bucket), '[]'::jsonb)
  INTO v_series
  FROM (SELECT generate_series(date_trunc(v_gran, v_from), v_to, v_step) AS bucket) b
  LEFT JOIN (
    SELECT date_trunc(v_gran, occurred_at) AS d,
           count(*) FILTER (WHERE kind = 'view') AS views,
           count(DISTINCT visitor_hash) FILTER (WHERE kind = 'view') AS visitors,
           count(*) FILTER (WHERE kind = 'click') AS clicks,
           count(*) FILTER (WHERE kind IN ('waitlist', 'pro_lead') AND coalesce(target, '') <> 'already') AS signups
    FROM links_events
    WHERE occurred_at >= v_from AND occurred_at < v_to
    GROUP BY 1
  ) x ON x.d = b.bucket
  WHERE b.bucket < v_to;

  SELECT coalesce(jsonb_agg(jsonb_build_object('target', tg, 'clicks', n, 'visitors', v) ORDER BY n DESC), '[]'::jsonb)
  INTO v_targets
  FROM (
    SELECT CASE WHEN target LIKE 'event:%' THEN 'event' ELSE coalesce(target, 'unknown') END AS tg,
           count(*) AS n, count(DISTINCT visitor_hash) AS v
    FROM links_events
    WHERE kind = 'click' AND occurred_at >= v_from AND occurred_at < v_to
    GROUP BY 1
  ) x;

  -- Soirées cliquées : titre depuis `events` pour une soirée Yuno, depuis le
  -- meta du clic pour une soirée partenaire.
  SELECT coalesce(jsonb_agg(jsonb_build_object('event_id', eid, 'title', title, 'clicks', n) ORDER BY n DESC), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT substr(le.target, 7) AS eid,
           coalesce(max(e.title), max(le.meta->>'title')) AS title,
           count(*) AS n
    FROM links_events le
    LEFT JOIN events e ON e.id::text = substr(le.target, 7)
    WHERE le.kind = 'click' AND le.target LIKE 'event:%'
      AND le.occurred_at >= v_from AND le.occurred_at < v_to
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 10
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_langs
  FROM (SELECT coalesce(lang, '?') AS k, count(DISTINCT visitor_hash) AS n
        FROM links_events WHERE kind = 'view' AND occurred_at >= v_from AND occurred_at < v_to GROUP BY 1) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_countries
  FROM (SELECT coalesce(country, '?') AS k, count(DISTINCT visitor_hash) AS n
        FROM links_events WHERE kind = 'view' AND occurred_at >= v_from AND occurred_at < v_to GROUP BY 1
        ORDER BY n DESC LIMIT 12) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_devices
  FROM (SELECT coalesce(device, '?') AS k, count(DISTINCT visitor_hash) AS n
        FROM links_events WHERE kind = 'view' AND occurred_at >= v_from AND occurred_at < v_to GROUP BY 1) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_referrers
  FROM (SELECT coalesce(referrer_host, 'direct') AS k, count(DISTINCT visitor_hash) AS n
        FROM links_events WHERE kind = 'view' AND occurred_at >= v_from AND occurred_at < v_to GROUP BY 1
        ORDER BY n DESC LIMIT 12) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_utm
  FROM (SELECT coalesce(utm_source, '') || CASE WHEN utm_campaign IS NOT NULL THEN ' / ' || utm_campaign ELSE '' END AS k,
               count(DISTINCT visitor_hash) AS n
        FROM links_events
        WHERE kind = 'view' AND (utm_source IS NOT NULL OR utm_campaign IS NOT NULL)
          AND occurred_at >= v_from AND occurred_at < v_to
        GROUP BY 1 ORDER BY n DESC LIMIT 12) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_wl_cities
  FROM (SELECT initcap(trim(city)) AS k, count(*) AS n
        FROM launch_waitlist WHERE source = 'links' AND city IS NOT NULL
        GROUP BY 1 ORDER BY n DESC LIMIT 15) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('k', k, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_lead_types
  FROM (SELECT org_type AS k, count(*) AS n
        FROM links_pro_leads WHERE created_at >= v_from AND created_at < v_to GROUP BY 1) x;

  RETURN jsonb_build_object(
    'granularity',  v_gran,
    'totals',       v_totals,
    'series',       v_series,
    'targets',      v_targets,
    'events',       v_events,
    'langs',        v_langs,
    'countries',    v_countries,
    'devices',      v_devices,
    'referrers',    v_referrers,
    'utm',          v_utm,
    'waitlist_cities', v_wl_cities,
    'lead_types',   v_lead_types
  );
END $$;
