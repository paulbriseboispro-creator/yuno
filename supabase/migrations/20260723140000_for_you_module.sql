-- ============================================================================
-- « POUR TOI » — vrai module de recommandation (remplace un simple re-tri)
-- ============================================================================
-- Pourquoi : get_for_you_events classait TOUS les events à venir et renvoyait
-- le top N. Sur une ville à 10 soirées, « top 12 » = les 10 soirées → la
-- colonne « Pour toi » affichait la programmation entière, dans un ordre
-- quasi chronologique. Trois causes, corrigées ici :
--
--   1. AUCUNE PORTE. Rien n'était jamais écarté pour cause de non-pertinence.
--      → ici : une soirée doit être MESURABLEMENT plus « toi » que la moyenne
--        de sa ville (z-score) ou porter une raison explicite (club suivi, DJ
--        suivi). Et le module ne montre JAMAIS plus de 40 % du vivier : il ne
--        peut structurellement plus dégénérer en « toutes les soirées ».
--
--   2. EFFONDREMENT DU VECTEUR MOYEN. Le goût était avg() de tous les signaux.
--      Moyenner 15 embeddings de soirées donne le centre de gravité du
--      clubbing, à peu près équidistant de TOUTE soirée : l'écart de similarité
--      entre candidats s'écrase à quelques centièmes, plus rien ne discrimine.
--      → ici : score = 35 % centroïde + 65 % MEILLEUR ancrage individuel. Qui
--        aime techno ET afro reçoit les deux, au lieu du milieu (= rien).
--
--   3. LE TEMPS MANGEAIT LE GOÛT. La pénalité de 0,005/jour valait 0,035 sur
--      une semaine, soit l'ordre de grandeur de tout l'écart de goût restant :
--      le classement final était de facto chronologique, donc identique au rail
--      « Cette semaine » juste en dessous.
--      → ici : le score est normalisé (z) avant toute pénalité temporelle, et
--        la pénalité plafonne à 0,35 z sur tout l'horizon.
--
-- Signaux ajoutés, qui existaient et dormaient : DJ suivis (favorites.dj_id
-- ↔ dj_embeddings ↔ event_djs), clubs suivis en boost direct (et non plus
-- « toute la programmation du club diluée dans le vecteur »), genres du quiz,
-- budget du quiz, préférence billets/tables. Horizon 45 jours (contre la
-- semaine affichée ailleurs) : le module peut enfin sortir le samedi parfait
-- dans trois semaines, ce que le reste de la page ne sait pas faire.
--
-- Chaque ligne porte SA RAISON (reason_code + reason_value) : un module de reco
-- qui ne sait pas dire pourquoi est indiscernable d'une liste.

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
  -- ── Ancrages : chaque signal reste UN vecteur distinct, avec son poids et
  --    son libellé. C'est ce qui permet le « meilleur ancrage » (max) au lieu
  --    de la moyenne écrasante.
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
           ev.title AS label
      FROM sig s
      JOIN public.event_embeddings e ON e.event_id = s.eid
      JOIN public.events ev ON ev.id = s.eid
    UNION ALL
    -- DJ suivis : leur univers est un ancrage à part entière.
    SELECT d.embedding, 0.70::double precision,
           NULLIF(TRIM(COALESCE(dj.stage_name,
                  CONCAT_WS(' ', dj.first_name, dj.last_name))), '')
      FROM public.favorites f
      JOIN public.dj_embeddings d ON d.dj_id = f.dj_id
      JOIN public.djs dj ON dj.id = f.dj_id
     WHERE f.user_id = v_user AND f.dj_id IS NOT NULL
    UNION ALL
    -- Quiz : seul ancrage disponible tant qu'il n'y a aucun comportement.
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
    -- Le vecteur candidat n'est plus porté au-delà d'ici (1536 dims × N lignes).
    SELECT c.id, c.slug, c.title, c.poster_url, c.start_at, c.end_at,
           c.vid, c.vname, c.vcity, c.org_user, c.has_tables, c.glist,
           -- 35 % « profil global » + 65 % « meilleur ancrage » : le second
           -- terme est ce qui empêche un goût pointu d'être noyé par la moyenne.
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
           + CASE
               WHEN s.min_price IS NULL OR v_budget IS NULL THEN 0
               WHEN v_budget = 'budget' AND s.min_price <  30 THEN 0.30
               WHEN v_budget = 'mid'    AND s.min_price >= 20 AND s.min_price <=  70 THEN 0.30
               WHEN v_budget = 'high'   AND s.min_price >= 50 AND s.min_price <= 150 THEN 0.30
               WHEN v_budget = 'vip'    AND s.min_price >  70 THEN 0.30
               ELSE 0
             END
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
           CASE
             WHEN r.fav_dj_name IS NOT NULL THEN 'dj'
             WHEN r.follows_venue           THEN 'venue'
             WHEN r.best_label IS NOT NULL AND r.best_sim >= 0.45 THEN 'similar'
             WHEN r.matched_genre IS NOT NULL THEN 'genre'
             ELSE 'taste'
           END AS rc,
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
         fs.rc,
         CASE fs.rc
           WHEN 'dj'      THEN fs.fav_dj_name
           WHEN 'venue'   THEN fs.vname
           WHEN 'similar' THEN fs.best_label
           WHEN 'genre'   THEN fs.matched_genre
           ELSE NULL
         END
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
  'plafonnée à 40 % du vivier, avec la raison de chaque recommandation. '
  'Renvoie 0 ligne s''il n''y a pas au moins 3 soirées qui tiennent la porte.';

-- ── Le lineup entre dans l'embedding de la soirée ───────────────────────────
-- Les noms de DJ ne faisaient pas partie du contenu embeddé (titre | genres |
-- lieu | ville | description). Deux soirées techno au même club étaient donc
-- quasi identiques pour le moteur, alors que le line-up est précisément ce qui
-- les distingue pour un clubbeur. On invalide tous les content_hash pour que
-- le cron réembedde avec le line-up (batch de 50 / 5 min, rattrapage naturel).
UPDATE public.event_embeddings SET content_hash = 'stale:lineup-v2';

-- L'ancienne RPC get_for_you_events reste en place (contrat inchangé) mais
-- n'est plus appelée par le front. Les notifs de découverte continuent
-- d'utiliser get_taste_events_for_user, qui a sa propre porte.
