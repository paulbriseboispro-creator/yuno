-- =====================================================================
-- /links : le nom d'un lieu SECRET ne sort plus dans « soirées à l'affiche »
-- =====================================================================
-- get_links_featured_events rendait `coalesce(v.name, e.location_name)` : pour
-- une soirée d'organisateur sans club marquée « Lieu secret »
-- (events.location_is_secret), le nom du lieu partait sur la page publique
-- /links alors que la page soirée, elle, le cache. Corps repris de l'état LIVE ;
-- seule la ligne venue_name change.

CREATE OR REPLACE FUNCTION public.get_links_featured_events(p_limit integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      coalesce(v.name, CASE WHEN coalesce(e.location_is_secret, false) THEN NULL ELSE e.location_name END) AS venue_name,
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
$function$

;
