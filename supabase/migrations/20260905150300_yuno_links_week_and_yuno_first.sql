-- Yuno Links — deux ajustements produit :
-- 1. Le compteur du bandeau devient « soirées de la semaine » en jours GLISSANTS
--    (les 7 prochains jours à partir de maintenant, soirées en cours incluses),
--    plus lisible qu'un week-end calendaire un mardi. `weekend_events` reste
--    exposé pour information.
-- 2. À l'affiche, les soirées vendues DANS Yuno (billetterie / guest list in-app,
--    club ou organisateur) passent devant les soirées des clubs partenaires
--    (redirection billetterie externe), chaque groupe trié par date.

CREATE OR REPLACE FUNCTION public.get_links_public_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_now_paris timestamp := (now() AT TIME ZONE 'Europe/Paris');
  v_monday    date      := date_trunc('week', v_now_paris)::date;
  v_fri       timestamptz;
  v_mon       timestamptz;
  v_week_end  timestamptz := now() + interval '7 days';
  v_venues    integer;
  v_aff       integer;
  v_upcoming  integer;
  v_aff_up    integer;
  v_weekend   integer;
  v_aff_we    integer;
  v_week      integer;
  v_aff_week  integer;
  v_cities    jsonb;
BEGIN
  IF extract(isodow FROM v_now_paris) = 1 AND extract(hour FROM v_now_paris) < 6 THEN
    v_monday := v_monday - 7;
  END IF;
  v_fri := ((v_monday + 4)::timestamp AT TIME ZONE 'Europe/Paris');
  v_mon := (((v_monday + 7)::timestamp + interval '6 hours') AT TIME ZONE 'Europe/Paris');

  SELECT count(*) INTO v_venues
  FROM venues
  WHERE coalesce(is_hidden, false) = false AND decommissioned_at IS NULL;

  SELECT count(*) INTO v_aff FROM affiliate_venues WHERE is_active = true;

  SELECT count(*) INTO v_upcoming
  FROM events e
  WHERE e.is_active = true AND e.visibility = 'public' AND e.is_discoverable = true
    AND e.end_at >= now()
    AND (e.venue_id IS NULL OR EXISTS (
      SELECT 1 FROM venues v WHERE v.id = e.venue_id
        AND coalesce(v.is_hidden, false) = false AND v.decommissioned_at IS NULL));

  SELECT count(*) INTO v_aff_up
  FROM affiliate_events
  WHERE status IN ('published', 'featured') AND event_date >= (v_now_paris::date - 1);

  -- Semaine glissante : tout ce qui n'est pas fini et commence d'ici 7 jours.
  SELECT count(*) INTO v_week
  FROM events e
  WHERE e.is_active = true AND e.visibility = 'public' AND e.is_discoverable = true
    AND e.end_at >= now() AND e.start_at < v_week_end
    AND (e.venue_id IS NULL OR EXISTS (
      SELECT 1 FROM venues v WHERE v.id = e.venue_id
        AND coalesce(v.is_hidden, false) = false AND v.decommissioned_at IS NULL));

  SELECT count(*) INTO v_aff_week
  FROM affiliate_events
  WHERE status IN ('published', 'featured')
    AND event_date >= (v_now_paris::date - 1)
    AND event_date < (v_week_end AT TIME ZONE 'Europe/Paris')::date;

  SELECT count(*) INTO v_weekend
  FROM events e
  WHERE e.is_active = true AND e.visibility = 'public' AND e.is_discoverable = true
    AND e.end_at >= now() AND e.start_at >= v_fri AND e.start_at < v_mon
    AND (e.venue_id IS NULL OR EXISTS (
      SELECT 1 FROM venues v WHERE v.id = e.venue_id
        AND coalesce(v.is_hidden, false) = false AND v.decommissioned_at IS NULL));

  SELECT count(*) INTO v_aff_we
  FROM affiliate_events
  WHERE status IN ('published', 'featured')
    AND event_date >= (v_monday + 4) AND event_date <= (v_monday + 6);

  SELECT coalesce(jsonb_agg(c ORDER BY n DESC), '[]'::jsonb) INTO v_cities
  FROM (
    SELECT city AS c, count(*) AS n
    FROM (
      SELECT city FROM venues WHERE coalesce(is_hidden, false) = false AND decommissioned_at IS NULL AND city IS NOT NULL
      UNION ALL
      SELECT city FROM affiliate_venues WHERE is_active = true AND city IS NOT NULL
    ) x
    GROUP BY city
    ORDER BY n DESC
    LIMIT 12
  ) y;

  RETURN jsonb_build_object(
    'venues',          v_venues + v_aff,
    'upcoming_events', v_upcoming + v_aff_up,
    'week_events',     v_week + v_aff_week,
    'weekend_events',  v_weekend + v_aff_we,
    'cities',          v_cities,
    'week_until',      v_week_end,
    'weekend_from',    v_fri,
    'weekend_to',      v_mon
  );
END $$;

CREATE OR REPLACE FUNCTION public.get_links_featured_events(p_limit integer DEFAULT 6)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH yuno AS (
    SELECT
      'yuno'::text AS kind,
      e.id::text AS id,
      CASE WHEN e.slug IS NOT NULL AND public.event_host_slug(e.id) IS NOT NULL
           THEN '/events/' || public.event_host_slug(e.id) || '/' || e.slug
           ELSE '/event/' || e.id::text END AS path,
      e.title,
      e.poster_url,
      e.start_at,
      e.end_at,
      coalesce(v.name, e.location_name) AS venue_name,
      coalesce(v.city, e.location_city) AS city,
      (e.start_at <= now() AND e.end_at > now()) AS is_live,
      (SELECT min(tr.price) FROM ticket_rounds tr WHERE tr.event_id = e.id AND tr.is_active = true) AS min_price,
      false AS is_free,
      EXISTS (
        SELECT 1 FROM guest_lists gl
        WHERE gl.event_id = e.id AND gl.is_active = true
          AND coalesce(array_length(gl.public_entry_types, 1), 0) > 0
      ) AS has_guest_list
    FROM events e
    LEFT JOIN venues v ON v.id = e.venue_id
    WHERE e.is_active = true AND e.visibility = 'public' AND e.is_discoverable = true
      AND e.end_at >= now()
      AND (e.venue_id IS NULL OR (coalesce(v.is_hidden, false) = false AND v.decommissioned_at IS NULL))
  ),
  partners AS (
    SELECT
      'affiliate'::text AS kind,
      ae.id::text AS id,
      '/affiliate-event/' || ae.slug AS path,
      ae.name AS title,
      ae.flyer_url AS poster_url,
      ((ae.event_date + coalesce(ae.start_time, time '23:00'))::timestamp AT TIME ZONE 'Europe/Paris') AS start_at,
      ((ae.event_date + coalesce(ae.start_time, time '23:00'))::timestamp AT TIME ZONE 'Europe/Paris') + interval '7 hours' AS end_at,
      av.name AS venue_name,
      av.city,
      false AS is_live,
      CASE WHEN coalesce(ae.is_free, false) THEN NULL ELSE ae.price_from END AS min_price,
      coalesce(ae.is_free, false) AS is_free,
      coalesce(ae.has_guest_list, false) AS has_guest_list
    FROM affiliate_events ae
    JOIN affiliate_venues av ON av.id = ae.affiliate_venue_id AND av.is_active = true
    WHERE ae.status IN ('published', 'featured')
      AND ae.slug IS NOT NULL
      AND coalesce(ae.is_sold_out, false) = false
      AND ae.event_date >= ((now() AT TIME ZONE 'Europe/Paris')::date - 1)
      AND ((ae.event_date + coalesce(ae.start_time, time '23:00'))::timestamp AT TIME ZONE 'Europe/Paris') + interval '7 hours' >= now()
  ),
  merged AS (
    SELECT * FROM (
      SELECT * FROM yuno
      UNION ALL
      SELECT * FROM partners
    ) u
    -- Les soirées vendues dans Yuno d'abord, puis les partenaires ; par date dans chaque groupe.
    ORDER BY (kind = 'yuno') DESC, start_at
    LIMIT greatest(1, least(coalesce(p_limit, 6), 12))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'kind', kind, 'id', id, 'path', path, 'title', title, 'poster_url', poster_url,
    'start_at', start_at, 'end_at', end_at, 'venue_name', venue_name, 'city', city,
    'is_live', is_live, 'min_price', min_price, 'is_free', is_free, 'has_guest_list', has_guest_list
  ) ORDER BY (kind = 'yuno') DESC, start_at), '[]'::jsonb)
  FROM merged;
$$;
