-- ============================================================================
-- Yuno CRM — analyse client : les calculs de nuit et l'écran Automatisations
-- tiennent sur un gros compte (2026-10-13)
--
-- Mesuré au banc (scripts/crm-bench, compte « grand » : 11 900 contacts,
-- 30 800 billets, 60 soirées), AVANT cette migration :
--   crm_analysis_compute (complet)  66,7 s   dont « venu avec un client déjà
--                                            venu » (UPDATE corrélé) 56 s
--   crm_score_compute              151 s     dont rechargement 58 s (même
--                                            UPDATE) et 7 itérations IRLS 75 s
--   crm_automations                126 s     aperçu de la recette 1re soirée
-- Une lecture d'écran passe par l'API, qui coupe à 8 s.
--
-- Rien ne change dans ce qui est calculé :
--   1. _crm_an_load : « venu avec un client déjà venu » en ensembles (même règle) ;
--   2. _first_return_candidates : la fenêtre de dates avant le test « a déjà
--      une place » (CTE matérialisée) ;
--   3. score : variables en colonnes pour les sommes de Newton (même calcul),
--      départ à chaud depuis le modèle d'hier quand les facteurs sont
--      les mêmes, arrêt de Newton à 1e-4 sur les poids centrés-réduits
--      (réglable : crm_analysis_config().score.tol). Le modèle converge vers
--      le même optimum ; AUC et calibration vérifiées identiques au banc.
-- Corps repris du dépôt (= prod, vérifié par scripts/crm-bench/same-as-prod.mjs).
-- ============================================================================

-- ── 1. Chargement de l'analyse ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_an_load(p_venue_id text, p_organizer_user_id uuid, p_at timestamptz, p_cfg jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $$
DECLARE
  v_at timestamptz := COALESCE(p_at, now());
  v_far numeric := COALESCE((p_cfg->'distance'->>'far_km')::numeric, 80);
  v_main text;
  v_n integer;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;

  DROP TABLE IF EXISTS _ann;
  CREATE TEMP TABLE _ann ON COMMIT DROP AS
  WITH ee AS (
    SELECT e.id AS nid, e.connection_id, e.external_id, e.event_id, e.name, e.start_at,
           COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris') AS tz,
           e.launched_at, e.published_at, e.latitude AS lat, e.longitude AS lng,
           upper(NULLIF(btrim(e.country_code), '')) AS country,
           lower(NULLIF(btrim(e.type_of_place), '')) AS fmt,
           e.street, e.city, e.genres, e.artists, e.deals
      FROM public.external_events e
     WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at IS NOT NULL AND e.start_at <= v_at
       AND e.cancelled_at IS NULL
  ), fb AS (
    SELECT t.connection_id, t.external_event_id, min(COALESCE(t.purchased_at, t.first_seen_at)) AS first_buy
      FROM public.external_tickets t
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND public._crm_ticket_is_sale(t.status, t.raw)
     GROUP BY 1, 2
  )
  SELECT ee.nid, ee.connection_id, ee.external_id, ee.event_id, ee.name, ee.start_at, ee.tz,
         ee.launched_at, (ee.launched_at IS NOT NULL) AS launch_known,
         -- Mise en vente : la vraie date Shotgun, sinon le premier billet vendu.
         LEAST(COALESCE(ee.launched_at, fb.first_buy, ee.published_at, ee.start_at - interval '30 days'), ee.start_at) AS sale_at,
         ee.lat, ee.lng, ee.country, ee.fmt,
         public._crm_night_series(ee.name) AS series,
         public._crm_an_slot(ee.start_at, ee.tz, p_cfg) AS slot,
         extract(isodow FROM public._crm_night_date(ee.start_at, ee.tz, 6))::smallint AS wd,
         public._crm_night_date(ee.start_at, ee.tz, 6) AS night_date,
         CASE WHEN ee.lat IS NOT NULL AND ee.lng IS NOT NULL THEN round(ee.lat::numeric, 3) || ',' || round(ee.lng::numeric, 3)
              WHEN NULLIF(btrim(COALESCE(ee.street, '')), '') IS NOT NULL THEN lower(btrim(ee.street)) || '|' || lower(btrim(COALESCE(ee.city, '')))
         END AS place_key,
         ARRAY(SELECT DISTINCT lower(btrim(g)) FROM unnest(COALESCE(ee.genres, '{}')) g WHERE btrim(g) <> '' ORDER BY 1) AS genres,
         ARRAY(SELECT DISTINCT public._crm_artist_key(a)
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ee.artists) = 'array' THEN ee.artists ELSE '[]'::jsonb END) a
                WHERE public._crm_artist_key(a) IS NOT NULL ORDER BY 1) AS arts,
         ARRAY(SELECT DISTINCT (d->>'price')::numeric
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ee.deals) = 'array' THEN ee.deals ELSE '[]'::jsonb END) d
                WHERE (d->>'price') ~ '^[0-9]+(\.[0-9]+)?$' AND (d->>'price')::numeric > 0 ORDER BY 1) AS prices,
         row_number() OVER (ORDER BY ee.start_at, ee.nid)::int AS rn
    FROM ee LEFT JOIN fb ON fb.connection_id = ee.connection_id AND fb.external_event_id = ee.external_id;

  DROP TABLE IF EXISTS _annart;
  CREATE TEMP TABLE _annart ON COMMIT DROP AS
  SELECT DISTINCT ON (n.nid, public._crm_artist_key(a))
         n.nid, public._crm_artist_key(a) AS ak,
         NULLIF(btrim(a->>'name'), '') AS name, NULLIF(btrim(a->>'slug'), '') AS slug,
         CASE WHEN (a->>'avatar') ~ '^https://' THEN a->>'avatar' END AS avatar
    FROM _ann n JOIN public.external_events e ON e.id = n.nid
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.artists) = 'array' THEN e.artists ELSE '[]'::jsonb END) a
   WHERE public._crm_artist_key(a) IS NOT NULL;

  -- Rareté à la date de chaque soirée : sur les soirées commencées jusqu'à
  -- elle (comprise), part de celles où l'artiste jouait.
  DROP TABLE IF EXISTS _anrar;
  CREATE TEMP TABLE _anrar ON COMMIT DROP AS
  SELECT n.nid, a.ak, count(DISTINCT m.nid)::numeric / n.rn AS share, n.rn AS base
    FROM _ann n
    JOIN _ann m ON m.rn <= n.rn
    JOIN _annart a ON a.nid = m.nid
   GROUP BY n.nid, a.ak, n.rn;
  CREATE INDEX ON _anrar (nid, ak);

  DROP TABLE IF EXISTS _ant;
  CREATE TEMP TABLE _ant ON COMMIT DROP AS
  SELECT t.id, lower(t.buyer_email) AS em, n.nid, t.external_order_id AS oid,
         COALESCE(t.purchased_at, t.first_seen_at) AS bought_at,
         public._crm_ticket_is_sale(t.status, t.raw) AS sale,
         public._crm_ticket_gl_kind(t.status, t.price, t.raw) = 'inv' AS inv,
         t.scanned_at IS NOT NULL AS scanned,
         CASE WHEN jsonb_typeof(t.raw) = 'object' THEN t.raw->>'deal_channel' END AS ch,
         CASE WHEN jsonb_typeof(t.raw) = 'object' THEN t.raw->'ticket_seating'->>'type' END AS seat,
         public._crm_ticket_source(t.utm) AS src,
         lower(NULLIF(CASE WHEN jsonb_typeof(t.utm) = 'object' THEN t.utm->>'utm_medium' END, '')) AS medium,
         t.price, NULLIF(btrim(t.deal_name), '') AS deal,
         public._crm_cp_fr(t.zip_code, t.country_code) AS cp,
         upper(NULLIF(btrim(t.country_code), '')) AS country
    FROM public.external_tickets t
    JOIN _ann n ON n.connection_id = t.connection_id AND n.external_id = t.external_event_id
   WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     AND t.buyer_email IS NOT NULL
     AND t.status = 'valid'
     AND (public._crm_ticket_is_sale(t.status, t.raw) OR public._crm_ticket_gl_kind(t.status, t.price, t.raw) = 'inv')
     AND COALESCE(t.purchased_at, t.first_seen_at) <= v_at;

  -- Les opposés au profilage ne sont jamais chargés.
  DELETE FROM _ant x USING public.crm_profile_optouts o
   WHERE o.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id) AND o.email = x.em;

  DROP TABLE IF EXISTS _ana;
  CREATE TEMP TABLE _ana ON COMMIT DROP AS
  WITH ord AS (
    SELECT nid, oid, count(*) AS n, count(DISTINCT em) AS holders
      FROM _ant WHERE sale AND oid IS NOT NULL GROUP BY 1, 2
  ), fs AS (
    -- Le premier billet VENDU de la personne pour la soirée.
    SELECT DISTINCT ON (t.em, t.nid) t.em, t.nid, t.oid, t.src, t.medium, t.price, t.deal, t.bought_at
      FROM _ant t WHERE t.sale
     ORDER BY t.em, t.nid, t.bought_at, t.id
  ), g AS (
    SELECT t.em, t.nid,
           bool_or(t.sale) AS has_sale,
           bool_or(t.inv AND t.scanned) AS inv_came,
           bool_or(t.scanned) AS scanned,
           min(t.bought_at) AS first_any,
           max(o.n) FILTER (WHERE t.sale) AS order_size,
           bool_or(o.holders > 1) FILTER (WHERE t.sale) AS multi_holder,
           bool_or(t.ch IN ('onsite', 'venue')) FILTER (WHERE t.sale) AS door,
           bool_or(t.seat IN ('Table', 'Booth')) FILTER (WHERE t.sale) AS tbl,
           count(*) FILTER (WHERE t.sale) AS tickets
      FROM _ant t LEFT JOIN ord o ON o.nid = t.nid AND o.oid = t.oid
     GROUP BY t.em, t.nid
    HAVING bool_or(t.sale) OR bool_or(t.inv AND t.scanned)
  )
  SELECT g.em, g.nid, n.start_at, n.series, n.rn,
         COALESCE(fs.bought_at, g.first_any) AS bought_at,
         g.has_sale, g.inv_came, (NOT g.has_sale AND g.inv_came) AS invited_only, g.scanned,
         COALESCE(g.order_size, 0)::int AS order_size, COALESCE(g.multi_holder, false) AS multi_holder,
         COALESCE(g.door, false) AS door, COALESCE(g.tbl, false) AS tbl, g.tickets::int AS tickets,
         fs.oid, fs.src, fs.medium, fs.price, fs.deal,
         extract(epoch FROM n.start_at - COALESCE(fs.bought_at, g.first_any)) / 3600.0 AS lead_h,
         CASE WHEN n.launch_known AND fs.bought_at IS NOT NULL
              THEN extract(epoch FROM fs.bought_at - n.launched_at) / 3600.0 END AS since_launch_h,
         CASE WHEN fs.price IS NOT NULL AND fs.price > 0 AND cardinality(n.prices) > 0
              THEN 1 + (SELECT count(*) FROM unnest(n.prices) x WHERE x < fs.price) END AS tier_rank,
         cardinality(n.prices) AS tier_count,
         row_number() OVER (PARTITION BY g.em ORDER BY n.start_at, n.nid)::int AS k,
         false AS with_returning
    FROM g JOIN _ann n ON n.nid = g.nid
    LEFT JOIN fs ON fs.em = g.em AND fs.nid = g.nid;
  CREATE INDEX ON _ana (em, k);
  CREATE INDEX ON _ana (nid);

  -- « Sa place était dans une commande avec un client déjà venu » : un autre
  -- détenteur de la même commande avait une venue à une soirée antérieure.
  -- En ensembles (même règle qu'avant) : la 1re venue de chaque autre détenteur
  -- de la commande, comparée à la soirée. La sous-requête corrélée d'avant
  -- coûtait 56 s sur un compte de 30 000 billets (banc, 13/10).
  WITH f AS (
    SELECT em, min(start_at) AS first_at FROM _ana GROUP BY em
  ), h AS (
    SELECT DISTINCT o.nid, o.oid, o.em, f.first_at
      FROM _ant o JOIN f ON f.em = o.em
     WHERE o.sale AND o.oid IS NOT NULL
  )
  UPDATE _ana a SET with_returning = true
    FROM (SELECT DISTINCT x.em, x.nid
            FROM _ana x JOIN h ON h.nid = x.nid AND h.oid = x.oid AND h.em <> x.em AND h.first_at < x.start_at
           WHERE x.oid IS NOT NULL) q
   WHERE q.em = a.em AND q.nid = a.nid;

  DROP TABLE IF EXISTS _anp;
  CREATE TEMP TABLE _anp ON COMMIT DROP AS
  SELECT x.em, x.cp, x.country, pc.lat, pc.lng
    FROM (SELECT t.em,
                 (array_agg(t.cp ORDER BY t.bought_at DESC) FILTER (WHERE t.cp IS NOT NULL))[1] AS cp,
                 (array_agg(t.country ORDER BY t.bought_at DESC) FILTER (WHERE t.country ~ '^[A-Z]{2}$'))[1] AS country
            FROM _ant t GROUP BY t.em) x
    LEFT JOIN public.crm_postal_codes_fr pc ON pc.cp = x.cp;

  -- Pays principal du compte : celui de ses soirées, sinon de ses acheteurs.
  SELECT country INTO v_main FROM _ann WHERE country IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1;
  IF v_main IS NULL THEN
    SELECT country INTO v_main FROM _anp WHERE country IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1;
  END IF;
  ALTER TABLE _anp ADD COLUMN main_country text, ADD COLUMN dist_first integer, ADD COLUMN passing boolean;
  UPDATE _anp p SET main_country = COALESCE(v_main, 'FR');
  -- Distance à sa première soirée ; « de passage » = étranger, ou plus loin
  -- que le seuil. Inconnu = null (jamais « local » par défaut).
  UPDATE _anp p SET
    dist_first = round(public._crm_km(p.lat, p.lng, n.lat, n.lng))::int
    FROM _ana a JOIN _ann n ON n.nid = a.nid
   WHERE a.em = p.em AND a.k = 1;
  UPDATE _anp p SET passing = CASE
      WHEN p.country IS NOT NULL AND p.country <> p.main_country THEN true
      WHEN p.dist_first IS NOT NULL THEN p.dist_first > v_far
      WHEN p.country IS NOT NULL THEN false END;

  SELECT count(*) INTO v_n FROM _anp;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_an_load(text, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_an_load(text, uuid, timestamptz, jsonb) TO service_role;

-- ── 2. Candidats de la recette « Faire revenir après la 1re soirée » ──────────
CREATE OR REPLACE FUNCTION public._first_return_candidates(p_venue_id text, p_organizer_user_id uuid, p_since timestamptz)
 RETURNS TABLE(em text, first_end timestamptz, due_at timestamptz, delay_days integer, pick_event_id uuid, pick_reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH sc AS (
    SELECT public.crm_scope_key(p_venue_id, p_organizer_user_id) AS k,
           public._first_return_delay_days(p_venue_id, p_organizer_user_id) AS d,
           COALESCE((public.crm_analysis_config()->'rarity'->>'resident_share')::numeric, 0.2) AS res
  ),
  -- MATERIALIZED : la fenêtre de dates d'abord (une centaine de personnes),
  -- le test « a déjà une place » ensuite. Sans lui, le planificateur testait
  -- chaque client venu une fois contre chaque soirée à venir avant de filtrer
  -- les dates : 126 s pour l'écran Automatisations d'un compte de 12 000 contacts.
  once AS MATERIALIZED (
    SELECT p.email AS em, p.tags,
           COALESCE(e.end_at, e.start_at + interval '6 hours') AS first_end,
           lower(public._crm_night_series(e.title)) AS series,
           extract(isodow FROM ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) - interval '8 hours')) AS dow,
           sc.d
      FROM sc
      JOIN public.crm_person_profile p ON p.scope_key = sc.k
      JOIN public.events e ON e.id = NULLIF(p.first_facts->>'event_id', '')::uuid
     WHERE p.nights = 1
       AND NOT ('pass' = ANY (p.tags))
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(days => sc.d) <= now()
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(days => sc.d) > now() - interval '7 days'
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(days => sc.d) >= COALESCE(p_since, '-infinity'::timestamptz)
  ),
  upcoming AS (
    SELECT e.id, e.start_at,
           lower(public._crm_night_series(e.title)) AS series,
           extract(isodow FROM ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris')) - interval '8 hours')) AS dow,
           ARRAY(SELECT DISTINCT 'g:' || lower(btrim(g))
                   FROM unnest(COALESCE(e.music_genres, '{}'::text[]) || ARRAY[e.music_genre]) g
                  WHERE g IS NOT NULL AND btrim(g) <> '') AS genres,
           ARRAY(SELECT DISTINCT 'a:' || z.k
                   FROM public.external_events x
                   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(x.artists, '[]'::jsonb)) a
                   CROSS JOIN LATERAL (SELECT public._crm_artist_key(a) AS k) z
                  WHERE x.event_id = e.id AND z.k IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM public.crm_artist_stats st, sc
                                     WHERE st.scope_key = sc.k AND st.artist_key = z.k AND st.share > sc.res)) AS arts
      FROM public.events e
     WHERE e.status = 'active' AND (e.is_active OR e.external_source IS NOT NULL) AND e.cancelled_at IS NULL
       AND (e.visibility = 'public' OR e.external_source IS NOT NULL) AND NOT COALESCE(e.requires_access_code, false)
       AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.start_at > now() + interval '24 hours'
       AND e.start_at <= now() + interval '35 days'
       AND ((e.ticketing_enabled OR e.external_ticket_url IS NOT NULL) AND NOT e.tickets_sold_out)
  )
  SELECT o.em, o.first_end, o.first_end + make_interval(days => o.d), o.d, pick.id, pick.reason
    FROM once o
    LEFT JOIN LATERAL (
      SELECT u.id,
             CASE WHEN u.artist_hit THEN 'artist' WHEN u.series_hit THEN 'series' WHEN u.genre_hits > 0 THEN 'genre'
                  WHEN u.dow_hit THEN 'weekday' ELSE 'next' END AS reason
        FROM (
          SELECT up.id, up.start_at,
                 (up.series IS NOT NULL AND up.series = o.series) AS series_hit,
                 (o.tags && up.arts) AS artist_hit,
                 (SELECT count(*) FROM unnest(up.genres) g WHERE g = ANY (o.tags))::integer AS genre_hits,
                 (up.dow = o.dow) AS dow_hit
            FROM upcoming up
        ) u
       ORDER BY (CASE WHEN u.artist_hit THEN 4 ELSE 0 END) + (CASE WHEN u.series_hit THEN 4 ELSE 0 END)
                + 2 * LEAST(2, u.genre_hits) + (CASE WHEN u.dow_hit THEN 1 ELSE 0 END) DESC,
                u.start_at ASC
       LIMIT 1
    ) pick ON true
   -- Il revient déjà : une place pour une soirée à venir de la portée.
   WHERE NOT EXISTS (
     SELECT 1 FROM public.events e
      WHERE e.start_at > now() AND e.cancelled_at IS NULL
        AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
          OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
        AND public._email_event_holder(e.id, o.em)
   );
$function$;
REVOKE ALL ON FUNCTION public._first_return_candidates(text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- ── 3. Score : régression à chaud ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_score_design(p_idx integer[], OUT o_mean float8[], OUT o_sd float8[])
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE i integer; m float8; s float8;
BEGIN
  o_mean := '{}'; o_sd := '{}';
  FOR i IN 1..cardinality(p_idx) LOOP
    SELECT sum(w * f[p_idx[i]]) / sum(w), sqrt(GREATEST(sum(w * f[p_idx[i]] ^ 2) / sum(w) - (sum(w * f[p_idx[i]]) / sum(w)) ^ 2, 0))
      INTO m, s FROM _scf;
    o_mean := o_mean || COALESCE(m, 0);
    o_sd := o_sd || CASE WHEN COALESCE(s, 0) < 1e-6 THEN 1 ELSE s END;
  END LOOP;
  DROP TABLE IF EXISTS _scz;
  -- Une colonne par variable (x1 = 1, l'intercept ; x2… = facteurs centrés-
  -- réduits) : les sommes de Newton lisent des colonnes et non un tableau,
  -- c'est ce qui coûtait (10 s par itération sur 53 000 lignes au banc).
  EXECUTE format('CREATE TEMP TABLE _scz ON COMMIT DROP AS SELECT 1::float8 AS x1%s, f.y, f.w FROM _scf f',
    COALESCE((SELECT string_agg(format(', (f.f[%s] - (%s)::float8) / (%s)::float8 AS x%s', p_idx[gi], o_mean[gi], o_sd[gi], gi + 1), '' ORDER BY gi)
                FROM generate_subscripts(p_idx, 1) gi), ''));
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_design(integer[]) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public._crm_logit_fit(integer, float8, integer);
CREATE OR REPLACE FUNCTION public._crm_logit_fit(p_k integer, p_l2 float8, p_iter integer,
                                                 p_start float8[] DEFAULT NULL, p_tol float8 DEFAULT 1e-6)
 RETURNS float8[]
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  n integer := p_k + 1;
  -- Départ : le modèle d'hier quand il a les mêmes facteurs (1 itération au
  -- lieu de 8), sinon zéro.
  beta float8[] := CASE WHEN cardinality(p_start) = p_k + 1 THEN p_start ELSE array_fill(0::float8, ARRAY[p_k + 1]) END;
  dot text;
  gsql text;
  hsql text;
  g float8[];
  h float8[];
  hh float8[];
  d float8[];
  it integer;
  i integer; j integer;
  mx float8;
BEGIN
  FOR it IN 1..p_iter LOOP
    dot := '';
    FOR i IN 1..n LOOP
      dot := dot || CASE WHEN i > 1 THEN ' + ' ELSE '' END || format('(%s)::float8 * x%s', beta[i], i);
    END LOOP;
    gsql := ''; hsql := '';
    FOR i IN 1..n LOOP
      gsql := gsql || CASE WHEN i > 1 THEN ', ' ELSE '' END || format('sum(w * (y - p) * x%s)', i);
      FOR j IN i..n LOOP
        hsql := hsql || CASE WHEN hsql <> '' THEN ', ' ELSE '' END || format('sum(w * p * (1 - p) * x%s * x%s)', i, j);
      END LOOP;
    END LOOP;
    EXECUTE format('SELECT ARRAY[%s]::float8[], ARRAY[%s]::float8[] FROM (SELECT *, 1 / (1 + exp(-LEAST(30, GREATEST(-30, %s)))) AS p FROM _scz) z',
                   gsql, hsql, dot) INTO g, hh;
    IF g IS NULL OR hh IS NULL THEN RETURN NULL; END IF;
    -- H symétrique à plat, plus la pénalité.
    h := array_fill(0::float8, ARRAY[n * n]);
    d := NULL;
    DECLARE c integer := 0; BEGIN
      FOR i IN 1..n LOOP
        FOR j IN i..n LOOP
          c := c + 1;
          h[(i - 1) * n + j] := hh[c];
          h[(j - 1) * n + i] := hh[c];
        END LOOP;
      END LOOP;
    END;
    FOR i IN 2..n LOOP
      h[(i - 1) * n + i] := h[(i - 1) * n + i] + p_l2;
      g[i] := g[i] - p_l2 * beta[i];
    END LOOP;
    d := public._crm_solve(h, g, n);
    IF d IS NULL THEN RETURN NULL; END IF;
    mx := 0;
    FOR i IN 1..n LOOP
      beta[i] := beta[i] + d[i];
      mx := GREATEST(mx, abs(d[i]));
    END LOOP;
    EXIT WHEN mx < p_tol;
  END LOOP;
  RETURN beta;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_logit_fit(integer, float8, integer, float8[], float8) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_score_compute(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_key   text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cfg   jsonb := public.crm_analysis_config();
  sc      jsonb;
  v_t0    timestamptz := clock_timestamp();
  v_feat  text[] := public._crm_score_features();
  v_all   integer[] := ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  v_base  integer[] := ARRAY[1, 2];
  v_idx   integer[];
  v_cut   timestamptz;
  v_ntr   integer; v_nva integer;
  v_mean  float8[]; v_sd float8[]; v_beta float8[]; v_start float8[];
  b_mean  float8[]; b_sd float8[]; b_beta float8[];
  v_tr    jsonb; v_va jsonb; v_vb jsonb;
  v_pos   integer;
  v_neg   float8;
  v_status text;
  v_scored integer := 0;
  i integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'crm_score_compute: service only' USING ERRCODE = '42501';
  END IF;
  IF v_key IS NULL OR (p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  sc := COALESCE(v_cfg->'score', '{}'::jsonb);
  v_neg := LEAST(1, GREATEST(0.01, COALESCE((sc->>'neg_sample')::float8, 0.2)));

  PERFORM public._crm_an_load(p_venue_id, p_organizer_user_id, now(), v_cfg);
  PERFORM public._crm_score_targets(v_key, p_venue_id, p_organizer_user_id, v_cfg, false);

  -- Les soirées des N derniers mois ; les dernières sont tenues à l'écart.
  DELETE FROM _scx WHERE start_at < now() - make_interval(months => COALESCE((sc->>'months')::int, 12));
  SELECT start_at INTO v_cut FROM _scx ORDER BY start_at DESC
   OFFSET GREATEST(COALESCE((sc->>'holdout_nights')::int, 4) - 1, 0) LIMIT 1;
  SELECT count(*) FILTER (WHERE start_at < v_cut), count(*) FILTER (WHERE start_at >= v_cut) INTO v_ntr, v_nva FROM _scx;

  IF v_cut IS NULL OR v_ntr < COALESCE((sc->>'min_train_nights')::int, 8) THEN
    v_status := 'insufficient';
    v_tr := jsonb_build_object('nights', COALESCE(v_ntr, 0));
  ELSE
    -- Paires : toute personne déjà venue avant l'ouverture de la vente ;
    -- achats gardés, non-achats échantillonnés et repondérés.
    DROP TABLE IF EXISTS _scp;
    CREATE TEMP TABLE _scp ON COMMIT DROP AS
    WITH known AS (
      SELECT x.xid, a.em
        FROM _scx x JOIN _ana a ON a.start_at < x.cutoff
       GROUP BY x.xid, a.em
    ), bought AS (
      SELECT a.em, a.nid FROM _ana a WHERE a.has_sale
    )
    SELECT k.xid, k.em, CASE WHEN b.em IS NOT NULL THEN 1 ELSE 0 END AS y,
           CASE WHEN b.em IS NOT NULL OR x.start_at >= v_cut THEN 1.0 ELSE 1.0 / v_neg END AS w,
           x.start_at >= v_cut AS valid
      FROM known k
      JOIN _scx x ON x.xid = k.xid
      LEFT JOIN bought b ON b.em = k.em AND b.nid = k.xid
     WHERE b.em IS NOT NULL OR x.start_at >= v_cut
        OR (abs(hashtext(k.em || ':' || k.xid::text)) % 1000) < v_neg * 1000;

    PERFORM public._crm_score_build(v_cfg);
    ALTER TABLE _scf ADD COLUMN valid boolean;
    UPDATE _scf f SET valid = p.valid FROM _scp p WHERE p.xid = f.xid AND p.em = f.em;

    SELECT count(*) FILTER (WHERE y = 1 AND NOT valid) INTO v_pos FROM _scf;
    v_tr := jsonb_build_object('nights', v_ntr, 'rows', (SELECT count(*) FROM _scf WHERE NOT valid), 'pos', v_pos);

    IF v_pos < COALESCE((sc->>'min_pos_train')::int, 200) THEN
      v_status := 'insufficient';
    ELSE
      -- Apprentissage sur les soirées d'avant la coupure.
      ALTER TABLE _scf RENAME TO _scf_all;
      CREATE TEMP TABLE _scf ON COMMIT DROP AS SELECT * FROM _scf_all WHERE NOT valid;
      -- Facteurs constants sur ce compte (toutes les soirées pareilles) : retirés.
      v_idx := '{}';
      FOR i IN 1..12 LOOP
        IF (SELECT stddev_pop(f[i]) FROM _scf) > 1e-6 THEN v_idx := v_idx || i; END IF;
      END LOOP;
      SELECT * INTO v_mean, v_sd FROM public._crm_score_design(v_idx);
          -- Départ à chaud : les poids d'hier si les facteurs retenus sont les mêmes.
      SELECT CASE WHEN m.features = ARRAY(SELECT v_feat[j] FROM unnest(v_idx) j) THEN m.beta END
        INTO v_start FROM public.crm_score_model m WHERE m.scope_key = v_key AND m.status IN ('ok', 'weak');
      v_beta := public._crm_logit_fit(cardinality(v_idx), COALESCE((sc->>'l2')::float8, 1.0), COALESCE((sc->>'iterations')::int, 12),
                                      v_start, COALESCE((sc->>'tol')::float8, 1e-4));
      SELECT * INTO b_mean, b_sd FROM public._crm_score_design(v_base);
      b_beta := public._crm_logit_fit(2, COALESCE((sc->>'l2')::float8, 1.0), COALESCE((sc->>'iterations')::int, 12),
                                      NULL, COALESCE((sc->>'tol')::float8, 1e-4));

      -- Validation sur les soirées tenues à l'écart (population complète).
      DROP TABLE _scf;
      CREATE TEMP TABLE _scf ON COMMIT DROP AS SELECT * FROM _scf_all WHERE valid;
      IF v_beta IS NULL OR b_beta IS NULL THEN
        v_status := 'failed';
      ELSE
        PERFORM public._crm_score_apply(v_idx, v_mean, v_sd, v_beta);
        v_va := public._crm_score_eval();
        -- Valeur ajoutée mesurée sur les clients ACTIFS (dernière soirée il y
        -- a moins de 180 jours) : sur toute la base, la récence seule trie
        -- déjà presque parfaitement (ceux qui ne reviennent jamais).
        DELETE FROM _scv v USING _scf f WHERE f.xid = v.xid AND f.em = v.em AND f.f[1] > ln(181);
        v_va := v_va || jsonb_build_object('active', public._crm_score_eval());
        PERFORM public._crm_score_apply(v_base, b_mean, b_sd, b_beta);
        v_vb := public._crm_score_eval();
        DELETE FROM _scv v USING _scf f WHERE f.xid = v.xid AND f.em = v.em AND f.f[1] > ln(181);
        v_vb := v_vb || jsonb_build_object('active', public._crm_score_eval());
        v_status := CASE
          WHEN COALESCE((v_va->>'pos')::int, 0) < COALESCE((sc->>'min_pos_valid')::int, 50) THEN 'insufficient'
          WHEN COALESCE((v_va->>'auc')::float8, 0) >= COALESCE((sc->>'auc_min')::float8, 0.70)
           AND COALESCE((v_va->'active'->>'auc')::float8, 0) >= COALESCE((v_vb->'active'->>'auc')::float8, 0) + COALESCE((sc->>'auc_gain')::float8, 0.02)
           AND COALESCE((v_va->>'ece')::float8, 1) <= COALESCE((sc->>'ece_max')::float8, 0.05)
            THEN 'ok'
          ELSE 'weak' END;
      END IF;
      DROP TABLE _scf_all;
    END IF;
  END IF;

  INSERT INTO public.crm_score_model AS m (scope_key, venue_id, organizer_user_id, status, features, mean, sd, beta, metrics, trained_at)
  VALUES (v_key, p_venue_id, p_organizer_user_id, v_status,
          CASE WHEN v_idx IS NOT NULL THEN ARRAY(SELECT v_feat[j] FROM unnest(v_idx) j) END,
          v_mean, v_sd, v_beta,
          jsonb_strip_nulls(jsonb_build_object('train', v_tr, 'valid', v_va, 'baseline', v_vb,
            'valid_nights', v_nva, 'rules_version', (v_cfg->>'rules_version')::int,
            'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000))),
          now())
  ON CONFLICT (scope_key) DO UPDATE SET status = EXCLUDED.status, features = EXCLUDED.features, mean = EXCLUDED.mean,
    sd = EXCLUDED.sd, beta = EXCLUDED.beta, metrics = EXCLUDED.metrics, trained_at = EXCLUDED.trained_at;

  -- Le score des soirées à venir (seulement avec un modèle validé).
  DELETE FROM public.crm_person_night_score WHERE scope_key = v_key;
  DELETE FROM public.crm_score_night WHERE scope_key = v_key;
  IF v_status = 'ok' THEN
    PERFORM public._crm_score_targets(v_key, p_venue_id, p_organizer_user_id, v_cfg, true);
    -- Part des achats encore à venir : ventes passées faites à moins de H
    -- heures de leur soirée, H = heures restantes avant celle-ci.
    ALTER TABLE _scx ADD COLUMN f float8;
    UPDATE _scx x SET f = COALESCE((
      SELECT avg(CASE WHEN a.lead_h <= GREATEST(0, extract(epoch FROM x.start_at - now()) / 3600.0) THEN 1 ELSE 0 END)
        FROM _ana a WHERE a.has_sale AND a.lead_h IS NOT NULL), 1);
    INSERT INTO public.crm_score_night (scope_key, event_id, remaining_share)
    SELECT v_key, x.event_id, x.f FROM _scx x WHERE x.event_id IS NOT NULL;
    DROP TABLE IF EXISTS _scp;
    CREATE TEMP TABLE _scp ON COMMIT DROP AS
    SELECT x.xid, p.em, 0 AS y, 1.0::float8 AS w
      FROM _scx x
      CROSS JOIN (SELECT DISTINCT em FROM _ana) p
     WHERE NOT EXISTS (
       SELECT 1 FROM public.external_tickets t
        WHERE t.event_id = x.event_id AND lower(t.buyer_email) = p.em AND t.status IN ('valid', 'transferred'));
    PERFORM public._crm_score_build(v_cfg);
    PERFORM public._crm_score_apply(v_idx, v_mean, v_sd, v_beta);
    -- Chance d'acheter D'ICI la soirée, sachant qu'il n'a pas encore acheté :
    -- p·f / (1 − p·(1 − f)), f = part des achats qui reste à venir.
    INSERT INTO public.crm_person_night_score (scope_key, event_id, email, p, label, reasons)
    SELECT v_key, x.event_id, v.em, q.pa,
           CASE WHEN q.pa >= COALESCE((sc->>'high')::float8, 0.30) THEN 'high'
                WHEN q.pa >= COALESCE((sc->>'medium')::float8, 0.10) THEN 'medium' ELSE 'low' END,
           -- Raisons : les facteurs qui poussent sa chance vers le haut ET qu'il
           -- possède vraiment (un trait à zéro n'est jamais une raison) ; « de
           -- passage » et « découverte Shotgun » décrivent un contexte, jamais
           -- une raison de venir.
           ARRAY(SELECT v_feat[v_idx[gi]] FROM generate_subscripts(v.c, 1) gi
                  WHERE v.c[gi] > 0.15 AND v_feat[v_idx[gi]] NOT IN ('far', 'disc')
                    AND (v_feat[v_idx[gi]] = 'rec' OR f.f[v_idx[gi]] > 0)
                  ORDER BY v.c[gi] DESC LIMIT 3)
      FROM _scv v JOIN _scx x ON x.xid = v.xid
      JOIN _scf f ON f.xid = v.xid AND f.em = v.em
      CROSS JOIN LATERAL (SELECT v.p * x.f / GREATEST(1e-9, 1 - v.p * (1 - x.f)) AS pa) q
     WHERE x.event_id IS NOT NULL;
    GET DIAGNOSTICS v_scored = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('scope', v_key, 'status', v_status, 'scored', v_scored,
    'auc', v_va->'auc', 'auc_base', v_vb->'auc', 'ece', v_va->'ece',
    'auc_active', v_va->'active'->'auc', 'auc_active_base', v_vb->'active'->'auc',
    'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_score_compute(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_score_compute(text, uuid) TO service_role;
