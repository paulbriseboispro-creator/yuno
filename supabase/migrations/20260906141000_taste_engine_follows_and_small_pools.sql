-- Moteur de goût v2.1 — correctifs après test en base réelle :
--   • UNION text/uuid : affiliate_venues.id est un uuid, venues.id un text.
--   • Les ORGANISATEURS suivis comptent comme un lieu suivi (follow_hit) et
--     nourrissent le vecteur de goût — un client qui ne suit qu'un collectif
--     n'avait aucun signal.
--   • Petits viviers (< 4 soirées embeddées) : l'affinité seule suffit si elle
--     est au moins moyenne. Sur l'inventaire actuel (1 à 3 soirées Yuno par
--     ville), le test z-score ne pouvait jamais s'exprimer et un client sans
--     genre déclaré ne recevait rien, même pour une soirée de sa ville.
--   • Aucun signal du tout (ni goût, ni genre, ni suivi) → toujours rien.
CREATE OR REPLACE FUNCTION public.get_taste_events_for_user(
  p_user_id uuid,
  p_limit   int DEFAULT 3,
  p_days    int DEFAULT 21
)
RETURNS TABLE (
  event_id      uuid,
  is_affiliate  boolean,
  title         text,
  venue_id      text,
  venue_name    text,
  city          text,
  start_at      timestamptz,
  slug          text,
  music_genres  text[],
  score         double precision,
  reason        text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_taste   extensions.vector(1536);
  v_opt_out boolean;
  v_prefs   jsonb;
  v_genres  text[];
  v_home    int;
  v_follows int;
BEGIN
  SELECT COALESCE(p.discovery_opt_out, false), COALESCE(p.notification_prefs, '{}'::jsonb)
    INTO v_opt_out, v_prefs
    FROM public.profiles p WHERE p.id = p_user_id;
  IF COALESCE(v_opt_out, false) OR COALESCE(v_prefs->>'discovery', 'true') = 'false' THEN RETURN; END IF;

  -- Zone : sans la moindre ville connue, on ne pousse JAMAIS à l'aveugle.
  SELECT count(*) INTO v_home FROM public.user_home_cities(p_user_id);
  IF v_home = 0 THEN RETURN; END IF;

  -- Genres du client : quiz ∪ genres des soirées achetées / suivies (12 mois).
  SELECT array_agg(DISTINCT lower(x.g)) INTO v_genres
  FROM (
    SELECT unnest(tp.genres) AS g FROM public.user_taste_profiles tp WHERE tp.user_id = p_user_id
    UNION ALL
    SELECT unnest(e.music_genres) FROM public.tickets t JOIN public.events e ON e.id = t.event_id
     WHERE t.user_id = p_user_id AND t.status = 'paid' AND t.created_at > now() - interval '12 months'
    UNION ALL
    SELECT unnest(e.music_genres) FROM public.favorites f JOIN public.events e ON e.id = f.event_id
     WHERE f.user_id = p_user_id AND f.event_id IS NOT NULL
    UNION ALL
    SELECT unnest(ae.genres) FROM public.favorites f JOIN public.affiliate_events ae ON ae.id = f.affiliate_event_id
     WHERE f.user_id = p_user_id AND f.affiliate_event_id IS NOT NULL
  ) x WHERE x.g IS NOT NULL AND btrim(x.g) <> '';
  v_genres := COALESCE(v_genres, '{}'::text[]);

  -- Lieux / collectifs suivis (clubs, lieux partenaires, organisateurs).
  SELECT (SELECT count(*) FROM public.favorites f
           WHERE f.user_id = p_user_id AND (f.venue_id IS NOT NULL OR f.affiliate_venue_id IS NOT NULL))
       + (SELECT count(*) FROM public.organizer_profile_followers o WHERE o.user_id = p_user_id)
    INTO v_follows;

  -- Vecteur de goût (cerveau unique : quiz ⊕ comportement ⊕ programmation suivie).
  SELECT avg(emb)::extensions.vector(1536) INTO v_taste
  FROM (
    SELECT tp.taste_embedding AS emb
      FROM public.user_taste_profiles tp
     WHERE tp.user_id = p_user_id AND tp.taste_embedding IS NOT NULL
    UNION ALL
    SELECT e.embedding
      FROM public.event_embeddings e
     WHERE e.event_id IN (
       SELECT t.event_id FROM public.tickets t
        WHERE t.user_id = p_user_id AND t.status = 'paid' AND t.created_at > now() - interval '12 months'
       UNION
       SELECT f.event_id FROM public.favorites f
        WHERE f.user_id = p_user_id AND f.event_id IS NOT NULL AND f.created_at > now() - interval '12 months'
       UNION
       SELECT ev.id FROM public.favorites f
         JOIN public.events ev ON ev.venue_id = f.venue_id
        WHERE f.user_id = p_user_id AND f.venue_id IS NOT NULL AND ev.start_at > now() - interval '12 months'
       UNION
       SELECT ev.id FROM public.organizer_profile_followers o
         JOIN public.events ev ON ev.organizer_user_id = o.organizer_user_id
        WHERE o.user_id = p_user_id AND ev.start_at > now() - interval '12 months'
     )
  ) src;

  -- Aucun signal (ni goût, ni genre, ni suivi) → rien : on ne devine pas.
  IF v_taste IS NULL AND cardinality(v_genres) = 0 AND COALESCE(v_follows, 0) = 0 THEN RETURN; END IF;

  RETURN QUERY
  WITH yuno AS (
    SELECT ev.id AS event_id, false AS is_affiliate, ev.title, ev.venue_id::text AS venue_id,
           COALESCE(v.name, ev.location_name) AS venue_name,
           COALESCE(v.city, ev.location_city) AS city,
           ev.start_at, ev.slug, ev.music_genres,
           CASE WHEN v_taste IS NULL OR emb.embedding IS NULL THEN NULL
                ELSE 1 - (emb.embedding OPERATOR(extensions.<=>) v_taste) END AS sim,
           EXISTS (SELECT 1 FROM unnest(COALESCE(ev.music_genres, '{}')) g WHERE lower(g) = ANY (v_genres)) AS genre_hit,
           (EXISTS (SELECT 1 FROM public.favorites f WHERE f.user_id = p_user_id AND f.venue_id = ev.venue_id)
            OR EXISTS (SELECT 1 FROM public.organizer_profile_followers o
                        WHERE o.user_id = p_user_id AND o.organizer_user_id = ev.organizer_user_id)) AS follow_hit,
           h.weight AS home_w
      FROM public.events ev
      LEFT JOIN public.event_embeddings emb ON emb.event_id = ev.id
      LEFT JOIN public.venues v ON v.id = ev.venue_id
      JOIN public.user_home_cities(p_user_id) h ON h.city_norm = public.search_norm(COALESCE(v.city, ev.location_city))
     WHERE ev.is_active = true AND ev.visibility = 'public' AND ev.is_discoverable = true
       AND ev.cancelled_at IS NULL
       AND COALESCE(ev.requires_access_code, false) = false
       AND ev.start_at > now() AND ev.start_at <= now() + (p_days || ' days')::interval
       -- Inventaire RÉEL : jamais un club caché / décommissionné (club démo inclus).
       AND (ev.venue_id IS NULL OR (COALESCE(v.is_hidden, false) = false AND v.decommissioned_at IS NULL))
       AND NOT EXISTS (SELECT 1 FROM public.tickets t
                        WHERE t.user_id = p_user_id AND t.event_id = ev.id AND t.status = 'paid')
       AND NOT EXISTS (SELECT 1 FROM public.discovery_event_notifications d
                        WHERE d.user_id = p_user_id AND d.event_id = ev.id)
  ),
  partner AS (
    SELECT ae.id AS event_id, true AS is_affiliate, ae.name AS title, av.id::text AS venue_id,
           av.name AS venue_name, av.city,
           (ae.event_date::timestamp + COALESCE(ae.start_time::text, '23:00')::interval) AT TIME ZONE 'Europe/Madrid' AS start_at,
           ae.slug, ae.genres AS music_genres,
           NULL::double precision AS sim,
           EXISTS (SELECT 1 FROM unnest(COALESCE(ae.genres, '{}')) g WHERE lower(g) = ANY (v_genres)) AS genre_hit,
           EXISTS (SELECT 1 FROM public.favorites f WHERE f.user_id = p_user_id AND f.affiliate_venue_id = av.id) AS follow_hit,
           h.weight AS home_w
      FROM public.affiliate_events ae
      JOIN public.affiliate_venues av ON av.id = ae.affiliate_venue_id
      JOIN public.user_home_cities(p_user_id) h ON h.city_norm = public.search_norm(av.city)
     WHERE ae.status = 'published' AND av.is_active = true
       AND COALESCE(ae.is_sold_out, false) = false
       AND ae.event_date >= current_date
       AND ae.event_date <= current_date + p_days
       AND NOT EXISTS (SELECT 1 FROM public.discovery_event_notifications d
                        WHERE d.user_id = p_user_id AND d.event_id = ae.id)
  ),
  pool AS (SELECT * FROM yuno UNION ALL SELECT * FROM partner),
  stats AS (
    SELECT avg(sim) AS avg_sim, COALESCE(stddev_pop(sim), 0) AS sd_sim, count(sim) AS n_sim FROM pool
  ),
  scored AS (
    SELECT p.*,
           -- Score = affinité vectorielle (ou base neutre) + goût déclaré + lieu suivi
           --         + fraîcheur de la date, pondéré par le poids de la ville.
           COALESCE(p.sim, s.avg_sim, 0.5)
             + CASE WHEN p.genre_hit  THEN 0.08 ELSE 0 END
             + CASE WHEN p.follow_hit THEN 0.06 ELSE 0 END
             + (LEAST(p.home_w, 6)::double precision * 0.01)
             - (extract(epoch FROM (p.start_at - now())) / 86400.0) * 0.003 AS score,
           CASE WHEN p.follow_hit THEN 'follow'
                WHEN p.genre_hit  THEN 'genre'
                ELSE 'taste' END AS reason,
           -- Plancher de pertinence : un genre du client, un lieu suivi, ou une
           -- affinité au-dessus du vivier (z ≥ 0,25 dès 4 soirées embeddées,
           -- au moins la moyenne en dessous).
           (p.genre_hit OR p.follow_hit
             OR (p.sim IS NOT NULL AND s.n_sim >= 4 AND p.sim >= s.avg_sim + 0.25 * s.sd_sim)
             OR (p.sim IS NOT NULL AND s.n_sim < 4 AND p.sim >= s.avg_sim - 0.001)) AS relevant
      FROM pool p CROSS JOIN stats s
  )
  SELECT sc.event_id, sc.is_affiliate, sc.title, sc.venue_id, sc.venue_name, sc.city,
         sc.start_at, sc.slug, sc.music_genres, sc.score, sc.reason
    FROM scored sc
   WHERE sc.relevant
   ORDER BY sc.score DESC, sc.start_at
   LIMIT greatest(1, least(p_limit, 10));
END;
$$;
REVOKE ALL ON FUNCTION public.get_taste_events_for_user(uuid, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_taste_events_for_user(uuid, int, int) TO service_role;
