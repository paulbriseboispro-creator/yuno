-- ============================================================================
-- « POUR TOI » — adaptation à la densité réelle du catalogue
-- ============================================================================
-- Mesuré en prod le 2026-07-23 : 7 soirées publiques à venir sur 45 jours,
-- dont 6 dans UN SEUL club (womber, Paris) ; Ségovie a 2 soirées sur 2 clubs ;
-- Toulouse aucune. Sur ce catalogue, les garde-fous de la première version se
-- neutralisaient l'un l'autre et le module ne se serait JAMAIS affiché :
--
--   • « max 2 soirées par club » sur une ville mono-club plafonnait la
--     sélection à 2 lignes, sous le minimum de 3 requis pour afficher →
--     silence permanent à Paris.
--   • le seuil z ≥ 0,70 est un seuil d'écart-type : sur un vivier de 6, l'écart
--     -type est du bruit, il ne laissait passer qu'une ou deux soirées.
--
-- Trois corrections, toutes des règles de densité (aucune ne rouvre la porte
-- au bug d'origine — le plafond « jamais plus de ~40 % du vivier » reste) :
--
--   1. Le quota par club s'adapte au nombre de clubs réellement programmés
--      dans le vivier. Deux clubs → 2 soirées chacun. Un seul club → le quota
--      vaut le plafond global : dans une ville mono-club, « varier les lieux »
--      n'a pas de sens, la question devient « lesquelles de SES soirées ».
--   2. Le seuil statistique se relâche quand le vivier est petit (< 12), où
--      un écart-type ne veut rien dire. Le plafond porte alors la garantie.
--   3. La raison affichée est classée par INFORMATIVITÉ, pas par force du
--      signal. « Tu suis ce club » est vrai de toute la programmation du club :
--      dans une ville mono-club, les trois cartes afficheraient la même phrase.
--      Une raison propre à LA soirée (le DJ, la ressemblance avec une soirée
--      aimée, le genre) passe donc devant, et « tu suis ce club » devient le
--      repli.

CREATE OR REPLACE FUNCTION public.get_for_you_feed(
  p_city  text DEFAULT NULL,
  p_limit int  DEFAULT 12,
  p_days  int  DEFAULT 45
)
RETURNS TABLE (
  event_id       uuid,
  event_slug     text,
  event_title    text,
  poster_url     text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  venue_id       text,
  venue_name     text,
  venue_city     text,
  organizer_name text,
  organizer_slug text,
  min_price      numeric,
  genres         text[],
  tables_enabled boolean,
  score          double precision,
  reason_code    text,
  reason_value   text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_user      uuid := auth.uid();
  v_opt_out   boolean;
  v_anchors   int;
  v_genres    text[];
  v_budget    text;
  v_booking   text;
  v_pool      int;
  v_venues    int;
  v_cap       int;
  v_per_venue int;
  v_min_z     double precision;
BEGIN
  IF v_user IS NULL THEN RETURN; END IF;

  SELECT p.personalization_opt_out INTO v_opt_out
  FROM public.profiles p WHERE p.id = v_user;
  IF COALESCE(v_opt_out, false) THEN RETURN; END IF;

  SELECT tp.genres, tp.budget, tp.booking_pref
    INTO v_genres, v_budget, v_booking
  FROM public.user_taste_profiles tp WHERE tp.user_id = v_user;
  v_genres := COALESCE(v_genres, '{}'::text[]);

  -- Combien d'ancrages de goût ? Zéro → aucune reco (cold-start propre : le
  -- front masque la section plutôt que d'inventer une sélection).
  SELECT count(*) INTO v_anchors FROM (
    SELECT 1 FROM public.user_taste_profiles tp
     WHERE tp.user_id = v_user AND tp.taste_embedding IS NOT NULL
    UNION ALL
    SELECT 1 FROM public.event_embeddings e WHERE e.event_id IN (
      SELECT t.event_id FROM public.tickets t
       WHERE t.user_id = v_user AND t.status = 'paid'
         AND t.created_at > now() - interval '18 months'
      UNION
      SELECT f.event_id FROM public.favorites f
       WHERE f.user_id = v_user AND f.event_id IS NOT NULL
         AND f.created_at > now() - interval '18 months'
    )
    UNION ALL
    SELECT 1 FROM public.favorites f
      JOIN public.dj_embeddings d ON d.dj_id = f.dj_id
     WHERE f.user_id = v_user AND f.dj_id IS NOT NULL
  ) a;

  IF v_anchors = 0 THEN RETURN; END IF;

  -- Taille du vivier ET nombre de clubs réellement programmés dedans : les
  -- deux pilotent les plafonds ci-dessous.
  SELECT count(*),
         count(DISTINCT COALESCE(ev.venue_id, ev.partner_venue_id, ev.id::text))
    INTO v_pool, v_venues
  FROM public.events ev
  JOIN public.event_embeddings emb ON emb.event_id = ev.id
  LEFT JOIN public.venues v ON v.id = COALESCE(ev.venue_id, ev.partner_venue_id)
  WHERE ev.is_active = true AND ev.visibility = 'public' AND ev.is_discoverable = true
    AND ev.cancelled_at IS NULL
    AND ev.start_at > now() AND ev.start_at <= now() + (p_days || ' days')::interval
    AND (p_city IS NULL OR COALESCE(v.city, ev.location_city) ILIKE '%' || p_city || '%');

  -- Vivier trop maigre : « sélectionner » n'a plus de sens, on se tait.
  IF v_pool < 4 THEN RETURN; END IF;

  -- Plafond global : jamais plus de ~40 % du vivier, plancher à 3 (en dessous
  -- de 3 le module ne s'affiche pas, donc plafonner plus bas revient à le
  -- supprimer). C'est LA garantie structurelle contre « toutes les soirées ».
  v_cap := least(greatest(p_limit, 1), 30, greatest(3, floor(v_pool * 0.4)::int));

  -- Quota par club, adapté au nombre de clubs programmés. Ville mono-club →
  -- le quota vaut le plafond global (varier les lieux est impossible).
  v_per_venue := greatest(2, ceil(v_cap::numeric / greatest(v_venues, 1))::int);

  -- Seuil statistique : un écart-type sur moins de 12 soirées est du bruit.
  v_min_z := CASE WHEN v_pool < 12 THEN 0.25 ELSE 0.70 END;

  RETURN QUERY
  WITH
  sig AS (
    SELECT t.event_id AS eid, 1.00::double precision AS w, t.created_at AS ts
      FROM public.tickets t
     WHERE t.user_id = v_user AND t.status = 'paid'
       AND t.created_at > now() - interval '18 months'
    UNION ALL
    SELECT f.event_id, 0.80::double precision, f.created_at
      FROM public.favorites f
     WHERE f.user_id = v_user AND f.event_id IS NOT NULL
       AND f.created_at > now() - interval '18 months'
  ),
  anchors AS (
    SELECT e.embedding AS emb,
           (s.w * exp(-extract(epoch FROM (now() - s.ts)) / 86400.0 / 240.0))::double precision AS w,
           ev.title AS label
      FROM sig s
      JOIN public.event_embeddings e ON e.event_id = s.eid
      JOIN public.events ev ON ev.id = s.eid
    UNION ALL
    SELECT d.embedding, 0.70::double precision,
           NULLIF(TRIM(COALESCE(dj.stage_name,
                  CONCAT_WS(' ', dj.first_name, dj.last_name))), '')
      FROM public.favorites f
      JOIN public.dj_embeddings d ON d.dj_id = f.dj_id
      JOIN public.djs dj ON dj.id = f.dj_id
     WHERE f.user_id = v_user AND f.dj_id IS NOT NULL
    UNION ALL
    SELECT tp.taste_embedding, 1.00::double precision, NULL::text
      FROM public.user_taste_profiles tp
     WHERE tp.user_id = v_user AND tp.taste_embedding IS NOT NULL
  ),
  centroid AS (
    SELECT avg(a.emb)::extensions.vector(1536) AS emb FROM anchors a
  ),
  cand AS (
    SELECT ev.id, ev.slug, ev.title, ev.poster_url, ev.start_at, ev.end_at,
           COALESCE(ev.venue_id, ev.partner_venue_id) AS vid,
           v.name AS vname,
           COALESCE(v.city, ev.location_city) AS vcity,
           ev.organizer_user_id AS org_user,
           COALESCE(ev.tables_enabled, false) AS has_tables,
           CASE
             WHEN ev.music_genres IS NOT NULL AND array_length(ev.music_genres, 1) > 0
               THEN ev.music_genres
             WHEN ev.music_genre IS NOT NULL THEN ARRAY[ev.music_genre]
             ELSE '{}'::text[]
           END AS glist,
           emb.embedding AS vec
      FROM public.events ev
      JOIN public.event_embeddings emb ON emb.event_id = ev.id
      LEFT JOIN public.venues v ON v.id = COALESCE(ev.venue_id, ev.partner_venue_id)
     WHERE ev.is_active = true AND ev.visibility = 'public' AND ev.is_discoverable = true
       AND ev.cancelled_at IS NULL
       AND ev.start_at > now() AND ev.start_at <= now() + (p_days || ' days')::interval
       AND (p_city IS NULL OR COALESCE(v.city, ev.location_city) ILIKE '%' || p_city || '%')
       AND NOT EXISTS (
         SELECT 1 FROM public.tickets t
          WHERE t.user_id = v_user AND t.event_id = ev.id AND t.status = 'paid'
       )
  ),
  scored AS (
    SELECT c.id, c.slug, c.title, c.poster_url, c.start_at, c.end_at,
           c.vid, c.vname, c.vcity, c.org_user, c.has_tables, c.glist,
           0.35 * (1 - (c.vec OPERATOR(extensions.<=>) ct.emb))
         + 0.65 * COALESCE(best.s, 0) AS taste,
           best.label AS best_label,
           best.s     AS best_sim,
           EXISTS (
             SELECT 1 FROM public.favorites f
              WHERE f.user_id = v_user AND f.venue_id IS NOT NULL AND f.venue_id = c.vid
           ) AS follows_venue,
           fav_dj.dj_name AS fav_dj_name,
           gm.g           AS matched_genre,
           pr.price_from  AS min_price
      FROM cand c
      CROSS JOIN centroid ct
      LEFT JOIN LATERAL (
        SELECT a.label, a.w * (1 - (c.vec OPERATOR(extensions.<=>) a.emb)) AS s
          FROM anchors a
         ORDER BY 2 DESC
         LIMIT 1
      ) best ON true
      LEFT JOIN LATERAL (
        SELECT NULLIF(TRIM(COALESCE(dj.stage_name,
                 CONCAT_WS(' ', dj.first_name, dj.last_name))), '') AS dj_name
          FROM public.event_djs ed
          JOIN public.favorites f ON f.dj_id = ed.dj_id AND f.user_id = v_user
          JOIN public.djs dj ON dj.id = ed.dj_id
         WHERE ed.event_id = c.id
         LIMIT 1
      ) fav_dj ON true
      LEFT JOIN LATERAL (
        SELECT gt.g FROM unnest(c.glist) AS gt(g) WHERE gt.g = ANY(v_genres) LIMIT 1
      ) gm ON true
      LEFT JOIN LATERAL (
        SELECT min(tr.price) AS price_from
          FROM public.ticket_rounds tr
         WHERE tr.event_id = c.id AND tr.is_active = true
      ) pr ON true
  ),
  stats AS (
    SELECT avg(s.taste) AS m,
           COALESCE(NULLIF(stddev_samp(s.taste), 0), 0.0001) AS sd
      FROM scored s
  ),
  ranked AS (
    SELECT s.*,
           ((s.taste - st.m) / st.sd)::double precision AS z,
           ( (s.taste - st.m) / st.sd
           + CASE WHEN s.follows_venue THEN 1.20 ELSE 0 END
           + CASE WHEN s.fav_dj_name IS NOT NULL THEN 1.40 ELSE 0 END
           + CASE WHEN s.matched_genre IS NOT NULL THEN 0.45 ELSE 0 END
           + CASE
               WHEN s.min_price IS NULL OR v_budget IS NULL THEN 0
               WHEN v_budget = 'budget' AND s.min_price <  30 THEN 0.30
               WHEN v_budget = 'mid'    AND s.min_price >= 20 AND s.min_price <=  70 THEN 0.30
               WHEN v_budget = 'high'   AND s.min_price >= 50 AND s.min_price <= 150 THEN 0.30
               WHEN v_budget = 'vip'    AND s.min_price >  70 THEN 0.30
               ELSE 0
             END
           + CASE WHEN v_booking IN ('tables', 'both') AND s.has_tables THEN 0.25 ELSE 0 END
           - least(0.35, extract(epoch FROM (s.start_at - now())) / 86400.0
                         / greatest(p_days, 1) * 0.35)
           )::double precision AS final_score
      FROM scored s CROSS JOIN stats st
  ),
  qualified AS (
    SELECT r.*,
           -- Raison classée par INFORMATIVITÉ : ce qui est propre à CETTE
           -- soirée passe avant ce qui est vrai de tout le club.
           CASE
             WHEN r.fav_dj_name IS NOT NULL THEN 'dj'
             WHEN r.best_label IS NOT NULL AND r.best_sim >= 0.45 THEN 'similar'
             WHEN r.matched_genre IS NOT NULL THEN 'genre'
             WHEN r.follows_venue           THEN 'venue'
             ELSE 'taste'
           END AS rc,
           row_number() OVER (
             PARTITION BY COALESCE(r.vid, r.org_user::text, r.id::text)
             ORDER BY r.final_score DESC
           ) AS venue_rank
      FROM ranked r
     WHERE r.follows_venue
        OR r.fav_dj_name IS NOT NULL
        OR r.z >= v_min_z
  ),
  final_set AS (
    SELECT q.*,
           org.display_name AS org_name,
           org.slug         AS org_slug
      FROM qualified q
      LEFT JOIN public.organizer_profiles org ON org.user_id = q.org_user
     WHERE q.venue_rank <= v_per_venue
     ORDER BY q.final_score DESC
     LIMIT v_cap
  )
  SELECT fs.id, fs.slug, fs.title, fs.poster_url, fs.start_at, fs.end_at,
         fs.vid, fs.vname, fs.vcity,
         fs.org_name, fs.org_slug,
         fs.min_price, fs.glist, fs.has_tables,
         fs.final_score,
         fs.rc,
         CASE fs.rc
           WHEN 'dj'      THEN fs.fav_dj_name
           WHEN 'venue'   THEN fs.vname
           WHEN 'similar' THEN fs.best_label
           WHEN 'genre'   THEN fs.matched_genre
           ELSE NULL
         END
    FROM final_set fs
   WHERE (SELECT count(*) FROM final_set) >= 3
   ORDER BY fs.final_score DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_for_you_feed(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_for_you_feed(text, int, int) TO authenticated;
