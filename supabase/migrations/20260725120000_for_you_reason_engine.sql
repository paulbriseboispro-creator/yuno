-- ============================================================================
-- « POUR TOI » — moteur d'argumentation par carte (fin de la raison unique)
-- ============================================================================
-- Constat : le classement de get_for_you_feed est bon, mais la RAISON affichée
-- sous chaque affiche était choisie par une échelle de priorité fixe
-- (dj > venue > similar > genre > taste), une seule raison par carte. Sur un
-- profil à signal dominant unique — un fan de reggaeton qui a aimé UNE soirée,
-- sans DJ ni club suivi — toutes les cartes retombaient sur la même case
-- « similar », avec la même valeur : « COMME YUNO REGGAETON PARTY » répété à
-- l'identique sur toute la rangée. Une reco qui argumente pareil partout ne
-- prouve rien ; elle ressemble à une étiquette collée, pas à un outil qui te
-- connaît.
--
-- Ce que change cette migration (le SCORE et la PORTE restent identiques —
-- z-score dans le vivier, plafond 40 %, max 2 par club, silence sous 3) :
--
--   1. Chaque carte ne porte plus UNE raison mais la LISTE ORDONNÉE de tous
--      les arguments personnels qu'elle mérite vraiment, du plus spécifique au
--      plus générique. Le front choisit ensuite, carte par carte, le premier
--      argument encore inutilisé sur la rangée : deux cartes ne se justifient
--      jamais deux fois pareil. La variété n'est pas décorative, elle vient de
--      vrais signaux distincts.
--
--   2. Trois arguments nouveaux, tous adossés à un fait client réel :
--      • venue_return — un club où tu as DÉJÀ un billet payé (tu connais la
--        maison), distinct du club « suivi ».
--      • top_genre — ton genre nº1 calculé sur TON comportement (billets +
--        favoris), pas seulement déclaré au quiz. « Reggaeton, ton genre nº1 »
--        est une mesure, pas une supposition.
--      • budget — le prix d'entrée tombe pile dans la fourchette que tu as
--        déclarée. new_venue — un club encore jamais testé qui colle malgré
--        tout à ton goût (cadré « à découvrir »).
--
--   3. « similar » redevient honnête : l'ancrage affiché est forcément une
--      SOIRÉE (event), plus jamais un DJ ou le quiz dont le libellé se serait
--      glissé dans « Comme … ».
--
-- Le contrat de sortie change : reason_code/reason_value (singuliers) laissent
-- la place à `reasons` (jsonb, tableau ordonné [{code,value}]). Seul
-- useForYouFeed lit cette fonction ; get_for_you_events (notifs) est intact.

DROP FUNCTION IF EXISTS public.get_for_you_feed(text, int, int);

CREATE FUNCTION public.get_for_you_feed(
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
  -- Tableau ORDONNÉ des arguments personnels de la carte, du plus spécifique
  -- au plus générique : [{ "code": "dj", "value": "BYAO" }, …]. Se termine
  -- toujours par { "code": "taste", "value": null } (repli garanti). Le front
  -- retient, par carte, le premier argument encore inédit sur la rangée.
  reasons        jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_user    uuid := auth.uid();
  v_opt_out boolean;
  v_anchors int;
  v_genres  text[];
  v_budget  text;
  v_booking text;
  v_pool    int;
  v_cap     int;
  v_min_z   double precision := 0.70;  -- « nettement au-dessus de la moyenne »
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

  -- Taille du vivier : sert au plafond « jamais plus de 40 % de la ville ».
  SELECT count(*) INTO v_pool
  FROM public.events ev
  JOIN public.event_embeddings emb ON emb.event_id = ev.id
  LEFT JOIN public.venues v ON v.id = COALESCE(ev.venue_id, ev.partner_venue_id)
  WHERE ev.is_active = true AND ev.visibility = 'public' AND ev.is_discoverable = true
    AND ev.cancelled_at IS NULL
    AND ev.start_at > now() AND ev.start_at <= now() + (p_days || ' days')::interval
    AND (p_city IS NULL OR COALESCE(v.city, ev.location_city) ILIKE '%' || p_city || '%');

  -- Vivier trop maigre : « sélectionner » n'a plus de sens, on se tait.
  IF v_pool < 4 THEN RETURN; END IF;

  v_cap := least(greatest(p_limit, 1), 30, greatest(3, floor(v_pool * 0.4)::int));

  RETURN QUERY
  WITH
  -- ── Ancrages : chaque signal reste UN vecteur distinct, avec son poids, son
  --    libellé ET son type (event / dj / quiz). Le type permet un « similar »
  --    honnête (jamais un DJ ou le quiz derrière « Comme … »).
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
    -- Soirées achetées / mises en favori, décroissance douce sur ~8 mois :
    -- ce que tu aimais l'an dernier compte moins que le mois dernier.
    SELECT e.embedding AS emb,
           (s.w * exp(-extract(epoch FROM (now() - s.ts)) / 86400.0 / 240.0))::double precision AS w,
           ev.title AS label,
           'event'::text AS kind
      FROM sig s
      JOIN public.event_embeddings e ON e.event_id = s.eid
      JOIN public.events ev ON ev.id = s.eid
    UNION ALL
    -- DJ suivis : leur univers est un ancrage à part entière.
    SELECT d.embedding, 0.70::double precision,
           NULLIF(TRIM(COALESCE(dj.stage_name,
                  CONCAT_WS(' ', dj.first_name, dj.last_name))), ''),
           'dj'::text
      FROM public.favorites f
      JOIN public.dj_embeddings d ON d.dj_id = f.dj_id
      JOIN public.djs dj ON dj.id = f.dj_id
     WHERE f.user_id = v_user AND f.dj_id IS NOT NULL
    UNION ALL
    -- Quiz : seul ancrage disponible tant qu'il n'y a aucun comportement.
    SELECT tp.taste_embedding, 1.00::double precision, NULL::text, 'quiz'::text
      FROM public.user_taste_profiles tp
     WHERE tp.user_id = v_user AND tp.taste_embedding IS NOT NULL
  ),
  centroid AS (
    SELECT avg(a.emb)::extensions.vector(1536) AS emb FROM anchors a
  ),
  -- ── Genre nº1 MESURÉ : histogramme des genres des soirées réellement
  --    achetées / mises en favori. C'est ce qui rend « ton genre nº1 » vrai.
  user_top_genre AS (
    SELECT h.g
      FROM (
        SELECT gg.g, count(*) AS n
          FROM (
            SELECT unnest(
              CASE
                WHEN ev.music_genres IS NOT NULL AND array_length(ev.music_genres, 1) > 0
                  THEN ev.music_genres
                WHEN ev.music_genre IS NOT NULL THEN ARRAY[ev.music_genre]
                ELSE '{}'::text[]
              END) AS g
              FROM public.events ev
             WHERE ev.id IN (
               SELECT t.event_id FROM public.tickets t
                WHERE t.user_id = v_user AND t.status = 'paid'
                  AND t.created_at > now() - interval '18 months'
               UNION
               SELECT f.event_id FROM public.favorites f
                WHERE f.user_id = v_user AND f.event_id IS NOT NULL
                  AND f.created_at > now() - interval '18 months'
             )
          ) gg
         WHERE gg.g IS NOT NULL AND btrim(gg.g) <> ''
         GROUP BY gg.g
      ) h
     ORDER BY h.n DESC, h.g
     LIMIT 1
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
    -- Le vecteur candidat n'est plus porté au-delà d'ici (1536 dims × N lignes).
    SELECT c.id, c.slug, c.title, c.poster_url, c.start_at, c.end_at,
           c.vid, c.vname, c.vcity, c.org_user, c.has_tables, c.glist,
           -- 35 % « profil global » + 65 % « meilleur ancrage » : le second
           -- terme est ce qui empêche un goût pointu d'être noyé par la moyenne.
           0.35 * (1 - (c.vec OPERATOR(extensions.<=>) ct.emb))
         + 0.65 * COALESCE(best.s, 0) AS taste,
           EXISTS (
             SELECT 1 FROM public.favorites f
              WHERE f.user_id = v_user AND f.venue_id IS NOT NULL AND f.venue_id = c.vid
           ) AS follows_venue,
           (c.vid IS NOT NULL AND EXISTS (
             SELECT 1 FROM public.tickets t
               JOIN public.events ev2 ON ev2.id = t.event_id
              WHERE t.user_id = v_user AND t.status = 'paid'
                AND COALESCE(ev2.venue_id, ev2.partner_venue_id) = c.vid
           )) AS visited_venue,
           fav_dj.dj_name  AS fav_dj_name,
           gm.g            AS matched_genre,
           tg.g            AS top_genre_val,
           best_ev.label   AS best_ev_label,
           best_ev.s       AS best_ev_sim,
           pr.price_from   AS min_price,
           CASE
             WHEN pr.price_from IS NULL OR v_budget IS NULL THEN false
             WHEN v_budget = 'budget' AND pr.price_from <  30 THEN true
             WHEN v_budget = 'mid'    AND pr.price_from >= 20 AND pr.price_from <=  70 THEN true
             WHEN v_budget = 'high'   AND pr.price_from >= 50 AND pr.price_from <= 150 THEN true
             WHEN v_budget = 'vip'    AND pr.price_from >  70 THEN true
             ELSE false
           END AS budget_fit
      FROM cand c
      CROSS JOIN centroid ct
      -- Meilleur ancrage TOUS TYPES confondus : sert au SCORE (inchangé).
      LEFT JOIN LATERAL (
        SELECT a.w * (1 - (c.vec OPERATOR(extensions.<=>) a.emb)) AS s
          FROM anchors a
         ORDER BY 1 DESC
         LIMIT 1
      ) best ON true
      -- Meilleur ancrage SOIRÉE uniquement : sert au libellé « Comme … ».
      LEFT JOIN LATERAL (
        SELECT a.label, a.w * (1 - (c.vec OPERATOR(extensions.<=>) a.emb)) AS s
          FROM anchors a
         WHERE a.kind = 'event' AND a.label IS NOT NULL
         ORDER BY 2 DESC
         LIMIT 1
      ) best_ev ON true
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
        SELECT gt.g FROM unnest(c.glist) AS gt(g)
         WHERE gt.g IN (SELECT g FROM user_top_genre) LIMIT 1
      ) tg ON true
      LEFT JOIN LATERAL (
        SELECT min(tr.price) AS price_from
          FROM public.ticket_rounds tr
         WHERE tr.event_id = c.id AND tr.is_active = true
      ) pr ON true
  ),
  stats AS (
    -- Normalisation DANS le vivier : « plus toi que la moyenne de ta ville »
    -- est la seule question qui a du sens. Un score absolu de similarité ne
    -- dit rien (toutes les soirées se ressemblent dans cet espace).
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
           -- Budget déclaré au quiz : une soirée dans ta fourchette remonte.
           + CASE WHEN s.budget_fit THEN 0.30 ELSE 0 END
           + CASE WHEN v_booking IN ('tables', 'both') AND s.has_tables THEN 0.25 ELSE 0 END
           -- Pénalité temporelle PLAFONNÉE : à fit égal la soirée la plus
           -- proche gagne, mais le temps ne peut plus dicter le classement.
           - least(0.35, extract(epoch FROM (s.start_at - now())) / 86400.0
                         / greatest(p_days, 1) * 0.35)
           )::double precision AS final_score
      FROM scored s CROSS JOIN stats st
  ),
  qualified AS (
    SELECT r.*,
           row_number() OVER (
             PARTITION BY COALESCE(r.vid, r.org_user::text, r.id::text)
             ORDER BY r.final_score DESC
           ) AS venue_rank
      FROM ranked r
     -- La porte. Un club ou un DJ que tu suis qualifie toujours (c'est
     -- personnel et rare). Le reste doit dépasser le seuil statistique. Un
     -- simple match de genre ne qualifie PAS : si toute la ville est en
     -- « Open Format », tout repasserait — c'est exactement le bug d'origine.
     WHERE r.follows_venue
        OR r.fav_dj_name IS NOT NULL
        OR r.z >= v_min_z
  ),
  final_set AS (
    -- Deux soirées par club maximum : une reco qui empile le même lieu est
    -- une page de club, pas une sélection.
    SELECT q.*,
           org.display_name AS org_name,
           org.slug         AS org_slug
      FROM qualified q
      LEFT JOIN public.organizer_profiles org ON org.user_id = q.org_user
     WHERE q.venue_rank <= 2
     ORDER BY q.final_score DESC
     LIMIT v_cap
  )
  SELECT fs.id, fs.slug, fs.title, fs.poster_url, fs.start_at, fs.end_at,
         fs.vid, fs.vname, fs.vcity,
         fs.org_name, fs.org_slug,
         fs.min_price, fs.glist, fs.has_tables,
         fs.final_score,
         -- ── Tous les arguments mérités, du plus spécifique au plus générique.
         --    Le front n'en montre qu'un par carte, mais choisit celui qui
         --    n'a pas déjà servi sur la rangée : plus jamais deux justifications
         --    identiques d'affilée. Se termine toujours par « taste » (repli).
         (
           '[]'::jsonb
           || CASE WHEN fs.fav_dj_name IS NOT NULL
                THEN jsonb_build_array(jsonb_build_object('code', 'dj', 'value', fs.fav_dj_name))
                ELSE '[]'::jsonb END
           || CASE WHEN fs.follows_venue AND fs.vname IS NOT NULL
                THEN jsonb_build_array(jsonb_build_object('code', 'venue', 'value', fs.vname))
                ELSE '[]'::jsonb END
           || CASE WHEN fs.visited_venue AND NOT fs.follows_venue AND fs.vname IS NOT NULL
                THEN jsonb_build_array(jsonb_build_object('code', 'venue_return', 'value', fs.vname))
                ELSE '[]'::jsonb END
           || CASE WHEN fs.best_ev_label IS NOT NULL AND fs.best_ev_sim >= 0.45
                THEN jsonb_build_array(jsonb_build_object('code', 'similar', 'value', fs.best_ev_label))
                ELSE '[]'::jsonb END
           || CASE WHEN fs.top_genre_val IS NOT NULL
                THEN jsonb_build_array(jsonb_build_object('code', 'top_genre', 'value', fs.top_genre_val))
                ELSE '[]'::jsonb END
           || CASE WHEN fs.matched_genre IS NOT NULL
                     AND (fs.top_genre_val IS NULL OR fs.matched_genre <> fs.top_genre_val)
                THEN jsonb_build_array(jsonb_build_object('code', 'genre', 'value', fs.matched_genre))
                ELSE '[]'::jsonb END
           || CASE WHEN fs.budget_fit
                THEN jsonb_build_array(jsonb_build_object('code', 'budget', 'value', NULL::text))
                ELSE '[]'::jsonb END
           || CASE WHEN fs.vid IS NOT NULL AND NOT fs.follows_venue
                     AND NOT fs.visited_venue AND fs.vname IS NOT NULL
                THEN jsonb_build_array(jsonb_build_object('code', 'new_venue', 'value', fs.vname))
                ELSE '[]'::jsonb END
           || jsonb_build_array(jsonb_build_object('code', 'taste', 'value', NULL::text))
         ) AS reasons
    FROM final_set fs
   -- Moins de 3 soirées qui tiennent la porte → on ne renvoie rien. Le module
   -- a le droit de se taire ; c'est ce qui le rend crédible quand il parle.
   WHERE (SELECT count(*) FROM final_set) >= 3
   ORDER BY fs.final_score DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_for_you_feed(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_for_you_feed(text, int, int) TO authenticated;

COMMENT ON FUNCTION public.get_for_you_feed(text, int, int) IS
  'Module « Pour toi » d''Explore : sélection personnalisée gatée (z-score dans '
  'le vivier de la ville + clubs/DJs suivis), diversifiée (max 2 par club), '
  'plafonnée à 40 % du vivier. Chaque ligne porte `reasons` : le tableau ordonné '
  'de TOUS ses arguments personnels (dj, venue, venue_return, similar, top_genre, '
  'genre, budget, new_venue, taste). Le front en choisit un par carte, jamais le '
  'même deux fois de suite. Renvoie 0 ligne sous 3 soirées qualifiées.';
