-- DJ marketplace: filtre par rayon géographique autour de la zone du booker.
-- Jusqu'ici le filtre ville était une égalité stricte (lower(d.city)=lower(p_city)),
-- donc un club « Paris » ne voyait jamais un DJ « Boulogne » ou « Paris 11e ». On
-- passe à un rayon en km autour d'un point d'origine (la ville du club / de l'orga,
-- géocodée côté client). Le DJ porte ses coordonnées; l'origine + le rayon arrivent
-- en paramètres. Distance = Haversine en SQL pur (pas besoin de PostGIS/earthdistance).

-- 1. Coordonnées sur les DJs (géocodées depuis djs.city côté client à l'enregistrement).
ALTER TABLE public.djs
  ADD COLUMN IF NOT EXISTS latitude  double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

COMMENT ON COLUMN public.djs.latitude  IS 'GPS latitude (géocodée depuis city) — filtre par rayon de la marketplace.';
COMMENT ON COLUMN public.djs.longitude IS 'GPS longitude (géocodée depuis city) — filtre par rayon de la marketplace.';

-- 2. Backfill des villes existantes (jeu de données réel : Paris, Madrid). Les
--    nouvelles villes sont géocodées à l'enregistrement du profil DJ.
UPDATE public.djs SET latitude = 48.8566, longitude = 2.3522
  WHERE lower(trim(COALESCE(city, ''))) = 'paris'   AND latitude IS NULL;
UPDATE public.djs SET latitude = 40.4168, longitude = -3.7038
  WHERE lower(trim(COALESCE(city, ''))) = 'madrid'  AND latitude IS NULL;

-- 3. RPC mise à jour : 3 nouveaux paramètres (origine + rayon). Signature modifiée →
--    on DROP l'ancienne avant de recréer (sinon surcharge ambiguë côté PostgREST).
DROP FUNCTION IF EXISTS public.search_djs_marketplace(text, text, text, int, numeric, numeric, date, boolean, int, int);

CREATE OR REPLACE FUNCTION public.search_djs_marketplace(
  p_genre        text    DEFAULT NULL,
  p_city         text    DEFAULT NULL,
  p_played_venue text    DEFAULT NULL,
  p_min_followers int    DEFAULT NULL,
  p_min_fee      numeric DEFAULT NULL,
  p_max_fee      numeric DEFAULT NULL,
  p_available_on date    DEFAULT NULL,
  p_booker_mode  boolean DEFAULT false,
  p_origin_lat   double precision DEFAULT NULL,
  p_origin_lng   double precision DEFAULT NULL,
  p_radius_km    numeric DEFAULT NULL,
  p_limit        int     DEFAULT 40,
  p_offset       int     DEFAULT 0
) RETURNS TABLE (
  user_id           uuid,
  handle            text,
  slug              text,
  stage_name        text,
  city              text,
  country           text,
  profile_image_url text,
  music_genres      text[],
  is_verified       boolean,
  rising            boolean,
  resident          boolean,
  resident_scopes   jsonb,
  followers_count   int,
  min_fee           numeric,
  max_fee           numeric,
  currency          text,
  rate_note         text,
  available         boolean,
  completeness_pct  numeric,
  rank_score        numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_booker boolean;
BEGIN
  v_booker := COALESCE(p_booker_mode, false) AND auth.uid() IS NOT NULL;

  RETURN QUERY
  WITH persons AS (
    SELECT DISTINCT ON (d.user_id)
      d.user_id, d.stage_name, d.first_name, d.last_name, d.city, d.country,
      d.profile_image_url, d.music_genres
    FROM public.djs d
    WHERE d.is_active = true AND d.user_id IS NOT NULL
      AND (p_city  IS NULL OR lower(COALESCE(d.city, '')) = lower(p_city))
      AND (p_genre IS NULL OR EXISTS (SELECT 1 FROM unnest(d.music_genres) g WHERE lower(g) = lower(p_genre)))
      -- Rayon géo : actif seulement si origine + rayon fournis. Un DJ sans
      -- coordonnées (city pas encore géocodée) est exclu du périmètre.
      AND (
        p_origin_lat IS NULL OR p_origin_lng IS NULL OR p_radius_km IS NULL
        OR (
          d.latitude IS NOT NULL AND d.longitude IS NOT NULL
          AND ( 6371 * acos( LEAST(1.0,
                  cos(radians(p_origin_lat)) * cos(radians(d.latitude))
                    * cos(radians(d.longitude) - radians(p_origin_lng))
                  + sin(radians(p_origin_lat)) * sin(radians(d.latitude))
                ) ) ) <= p_radius_km
        )
      )
    ORDER BY d.user_id,
             (d.cover_image_url IS NOT NULL) DESC,
             (d.profile_image_url IS NOT NULL) DESC,
             d.updated_at DESC NULLS LAST
  ),
  enriched AS (
    SELECT
      p.user_id,
      h.handle,
      (SELECT dd.slug FROM public.djs dd
        WHERE dd.user_id = p.user_id AND dd.slug IS NOT NULL
        ORDER BY dd.updated_at DESC NULLS LAST LIMIT 1) AS slug,
      COALESCE(NULLIF(btrim(p.stage_name), ''),
               btrim(COALESCE(p.first_name,'') || ' ' || COALESCE(p.last_name,''))) AS stage_name,
      p.city, p.country, p.profile_image_url, COALESCE(p.music_genres, '{}') AS music_genres,
      t.tiers,
      rc.min_fee, rc.max_fee, rc.currency, rc.rate_note,
      COALESCE(rc.is_public, false) AS rate_public,
      CASE WHEN p_available_on IS NULL THEN true ELSE NOT (
             EXISTS (SELECT 1 FROM public.dj_availability a
                      WHERE a.user_id = p.user_id AND a.blocked_date = p_available_on)
          OR EXISTS (SELECT 1 FROM public.dj_sets s JOIN public.djs d2 ON d2.id = s.dj_id
                      WHERE d2.user_id = p.user_id AND s.start_time::date = p_available_on)
          OR EXISTS (SELECT 1 FROM public.event_djs ed
                      JOIN public.djs de ON de.id = ed.dj_id
                      JOIN public.events e ON e.id = ed.event_id AND e.is_active = true
                      WHERE de.user_id = p.user_id AND e.start_at::date = p_available_on)
          OR EXISTS (SELECT 1 FROM public.dj_booking_requests br
                      WHERE br.dj_user_id = p.user_id AND br.status = 'accepted'
                        AND br.requested_date = p_available_on)
      ) END AS available,
      (SELECT count(*) FROM public.dj_sets s JOIN public.djs d3 ON d3.id = s.dj_id
        WHERE d3.user_id = p.user_id AND s.start_time >= now() - interval '90 days')::int AS sets_90
    FROM persons p
    LEFT JOIN public.dj_handles h ON h.user_id = p.user_id
    LEFT JOIN public.dj_rate_card rc ON rc.user_id = p.user_id
    CROSS JOIN LATERAL (SELECT public.get_dj_tiers(p.user_id) AS tiers) t
  )
  SELECT
    e.user_id, e.handle, e.slug, e.stage_name, e.city, e.country, e.profile_image_url, e.music_genres,
    (e.tiers->>'verified')::boolean,
    (e.tiers->>'rising')::boolean,
    (e.tiers->>'resident')::boolean,
    e.tiers->'resident_scopes',
    (e.tiers->>'followers_count')::int,
    CASE WHEN v_booker AND e.rate_public THEN e.min_fee   ELSE NULL END,
    CASE WHEN v_booker AND e.rate_public THEN e.max_fee   ELSE NULL END,
    CASE WHEN v_booker AND e.rate_public THEN e.currency  ELSE NULL END,
    CASE WHEN v_booker AND e.rate_public THEN e.rate_note ELSE NULL END,
    e.available,
    (e.tiers->>'completeness_pct')::numeric,
    ( 30 * (CASE WHEN (e.tiers->>'verified')::boolean THEN 1 ELSE 0 END)
    + 20 * (CASE WHEN (e.tiers->>'rising')::boolean   THEN 1 ELSE 0 END)
    + 15 * (CASE WHEN (e.tiers->>'resident')::boolean THEN 1 ELSE 0 END)
    + 25 * (e.tiers->>'completeness_pct')::numeric
    + 0.10 * LEAST((e.tiers->>'followers_count')::int, 300)
    + 12 * (LEAST(e.sets_90, 6)::numeric / 6) )::numeric AS rank_score
  FROM enriched e
  WHERE e.tiers IS NOT NULL
    AND (p_min_followers IS NULL OR (e.tiers->>'followers_count')::int >= p_min_followers)
    AND (p_played_venue IS NULL OR EXISTS (
          SELECT 1 FROM public.event_djs ed
          JOIN public.djs d4 ON d4.id = ed.dj_id AND d4.user_id = e.user_id
          JOIN public.events ev ON ev.id = ed.event_id AND ev.venue_id = p_played_venue))
    AND (p_available_on IS NULL OR e.available = true)
    AND ( NOT v_booker OR (p_min_fee IS NULL AND p_max_fee IS NULL) OR (
          e.rate_public AND COALESCE(e.min_fee, e.max_fee) IS NOT NULL
          AND COALESCE(e.min_fee, e.max_fee) <= COALESCE(p_max_fee, 'infinity'::numeric)
          AND COALESCE(e.max_fee, e.min_fee) >= COALESCE(p_min_fee, 0)
        ))
  ORDER BY rank_score DESC, e.stage_name ASC
  LIMIT COALESCE(p_limit, 40) OFFSET COALESCE(p_offset, 0);
END; $$;

GRANT EXECUTE ON FUNCTION public.search_djs_marketplace(
  text, text, text, int, numeric, numeric, date, boolean,
  double precision, double precision, numeric, int, int
) TO anon, authenticated;
