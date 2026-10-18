-- Audit de préparation Yuno CRM (18/10) — DATA-08 : la règle DATA-02 dans le
-- moteur d'analyse client. Rapport : docs/audit/2026-10-18-crm-readiness/REPORT.md.
--
-- Décision de Paul du 18/10 (DATA-02, migration 20261022100000) : sur une
-- soirée à PORTE MESURÉE (_crm_door_measured : au moins 10 billets scannés et
-- 10 %), une ENTRÉE GRATUITE (billet vendu à 0 €) NON SCANNÉE n'est pas une
-- soirée faite. La base des personnes, l'Accueil, le volet d'une soirée et la
-- fiche client la suivent depuis 20261022100000 ; le moteur d'analyse
-- (_crm_an_load) comptait encore toute vente comme une venue.
--
-- Ce qui change, et seulement ça :
--   • _crm_an_load : la table des VENUES (_ana, une ligne par personne et
--     soirée faite) ne garde une vente que si _crm_sale_counts_as_night le
--     dit, avec la même porte _crm_measured_doors que la base des personnes.
--     Une entrée gratuite non scannée sur une porte mesurée est lue comme une
--     invitation non scannée : pas de venue, pas de place dans la taille d'une
--     commande, pas de « premier billet vendu », pas de détenteur d'une
--     commande partagée. Le billet reste chargé (_ant) pour le code postal et
--     le pays de la personne. Suivent sans être réécrits, parce qu'ils lisent
--     _ana : « Ce qui fait venir » (_crm_an_engine, statuts des familles), les
--     hypothèses d'une personne (_crm_an_fill_hyps), le profil d'une personne
--     (crm_person_profile : soirées, artistes vus, séries, « venu une fois »,
--     clés de filtre), le profil d'une soirée (crm_night_profile : entrées,
--     nouveaux venus, retour) et les artistes (crm_artist_stats), donc « Qui
--     cibler » (_crm_night_target_set lit crm_person_profile), « Fidèles du
--     concept » et la recette « Faire revenir après la 1re soirée ». Une
--     personne dont aucune soirée ne compte perd son profil d'analyse au
--     prochain calcul complet (règle existante de crm_analysis_compute).
--   • « Chances de venir » (crm_score_compute) : qui est « déjà venu » (paires
--     d'apprentissage, nouveaux venus, personnes à noter) et l'historique des
--     facteurs (_crm_score_build, inchangé) suivent la règle par _ana. La
--     CIBLE, elle, reste l'achat : le score dit la chance de prendre une place
--     d'ici la soirée, et le journal prévu / réel (_crm_score_settle,
--     _crm_score_journal) le compare aux VENTES. Une entrée gratuite prise par
--     quelqu'un qui n'est pas venu reste un achat : la cible et le rythme
--     d'achat lisent _anbought (nouvelle fonction _crm_an_load_bought),
--     exactement l'ancienne _ana.
--   • Un compte sans entrée gratuite non scannée sur porte mesurée ne voit
--     rien changer : _ana et _anbought y sont l'ancienne _ana, ligne pour ligne
--     (banc : scripts/crm-bench/audit-analysis.mjs, comptes demo, grand,
--     petit, hasard identiques avant / après).
--
-- Limite connue : la projection de remplissage (« ≈ N acheteurs au total »,
-- crm_night_targets, _crm_score_journal, crm_admin_analysis) estime les
-- nouveaux par crm_night_profile.new_people, qui compte désormais des
-- nouveaux VENUS, alors qu'elle se règle sur les nouveaux ACHETEURS. Sur un
-- compte à entrées gratuites, elle sous-estime ; la porte _crm_projection_gate
-- (écart < 15 % sur 8 soirées) la garde fermée tant que c'est le cas. Suite
-- proposée : une colonne « nouveaux acheteurs » à côté de new_people.
--
-- Prérequis : 20261022100000 (portes _crm_sale_counts_as_night et
-- _crm_measured_doors). Chaque fonction est reprise de pg_get_functiondef en
-- prod au 18/10 (_crm_an_load y diffère du dépôt : la réécriture « raw » →
-- colonnes de 20261019300000 ; crm_score_compute = 20261014100000), patchée
-- bloc par bloc ; CREATE OR REPLACE garde les droits. Aucune signature exposée
-- ne change : pas de rechargement du cache de l'API. Les profils et les
-- statuts se recalculent au calcul complet de la nuit (crm-analysis-nightly,
-- crm-score-nightly) ; un statut « Confirmée » demande 2 nuits de suite.

-- ── Les venues ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_an_load(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone, p_cfg jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
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
       AND public._crm_ticket_is_sale(t.status, t.deal_channel)
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
         public._crm_ticket_is_sale(t.status, t.deal_channel) AS sale,
         -- Une vente qui compte comme une SOIRÉE FAITE (DATA-02, 18/10) : pas
         -- une entrée gratuite non scannée sur une porte mesurée. C'est elle
         -- qui fait une venue dans _ana ; `sale` reste l'achat (_anbought).
         public._crm_ticket_is_sale(t.status, t.deal_channel)
           AND public._crm_sale_counts_as_night(t.price, t.scanned_at IS NOT NULL, md.event_id IS NOT NULL) AS night,
         public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) = 'inv' AS inv,
         t.scanned_at IS NOT NULL AS scanned,
         t.deal_channel AS ch,
         t.seating_type AS seat,
         public._crm_ticket_source(t.utm) AS src,
         lower(NULLIF(CASE WHEN jsonb_typeof(t.utm) = 'object' THEN t.utm->>'utm_medium' END, '')) AS medium,
         t.price, NULLIF(btrim(t.deal_name), '') AS deal,
         public._crm_cp_fr(t.zip_code, t.country_code) AS cp,
         upper(NULLIF(btrim(t.country_code), '')) AS country
    FROM public.external_tickets t
    JOIN _ann n ON n.connection_id = t.connection_id AND n.external_id = t.external_event_id
    -- Soirées terminées à la date dont la porte est mesurée (la même porte que
    -- la base des personnes, 20261022100000).
    LEFT JOIN public._crm_measured_doors(p_venue_id, p_organizer_user_id, v_at) md ON md.event_id = t.event_id
   WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     AND t.buyer_email IS NOT NULL
     AND t.status = 'valid'
     AND (public._crm_ticket_is_sale(t.status, t.deal_channel) OR public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) = 'inv')
     AND COALESCE(t.purchased_at, t.first_seen_at) <= v_at;

  -- Les opposés au profilage ne sont jamais chargés.
  DELETE FROM _ant x USING public.crm_profile_optouts o
   WHERE o.scope_key = public.crm_scope_key(p_venue_id, p_organizer_user_id) AND o.email = x.em;

  -- Les VENUES (soirées faites) : une vente qui compte (`night`) ou une
  -- invitation scannée. Une entrée gratuite non scannée sur une porte mesurée
  -- n'y entre pas, ni dans la taille d'une commande, ni comme « premier billet
  -- vendu », ni comme détenteur d'une commande partagée : elle est lue comme
  -- une invitation non scannée. D'ici sortent les artistes vus, les séries
  -- fidèles, « venus une fois », les familles et l'historique du score.
  DROP TABLE IF EXISTS _ana;
  CREATE TEMP TABLE _ana ON COMMIT DROP AS
  WITH ord AS (
    SELECT nid, oid, count(*) AS n, count(DISTINCT em) AS holders
      FROM _ant WHERE night AND oid IS NOT NULL GROUP BY 1, 2
  ), fs AS (
    -- Le premier billet VENDU (et qui compte) de la personne pour la soirée.
    SELECT DISTINCT ON (t.em, t.nid) t.em, t.nid, t.oid, t.src, t.medium, t.price, t.deal, t.bought_at
      FROM _ant t WHERE t.night
     ORDER BY t.em, t.nid, t.bought_at, t.id
  ), g AS (
    SELECT t.em, t.nid,
           bool_or(t.night) AS has_sale,
           bool_or(t.inv AND t.scanned) AS inv_came,
           bool_or(t.scanned) AS scanned,
           min(t.bought_at) AS first_any,
           max(o.n) FILTER (WHERE t.night) AS order_size,
           bool_or(o.holders > 1) FILTER (WHERE t.night) AS multi_holder,
           bool_or(t.ch IN ('onsite', 'venue')) FILTER (WHERE t.night) AS door,
           bool_or(t.seat IN ('Table', 'Booth')) FILTER (WHERE t.night) AS tbl,
           count(*) FILTER (WHERE t.night) AS tickets
      FROM _ant t LEFT JOIN ord o ON o.nid = t.nid AND o.oid = t.oid
     GROUP BY t.em, t.nid
    HAVING bool_or(t.night) OR bool_or(t.inv AND t.scanned)
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
     WHERE o.night AND o.oid IS NOT NULL
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
$function$;

-- ── Les achats, pour la cible du score ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_an_load_bought()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  -- Les ACHATS de la portée chargée par _crm_an_load (lit _ant et _ann) : une
  -- ligne par personne et soirée où elle a une vente ou une invitation
  -- scannée. C'est l'ancienne _ana (avant DATA-08), réduite à ce que le score
  -- lit : la cible « a pris une place » (has_sale), le délai d'achat (lead_h)
  -- et le rang (k). Une entrée gratuite non scannée y reste un achat.
  DROP TABLE IF EXISTS _anbought;
  CREATE TEMP TABLE _anbought ON COMMIT DROP AS
  WITH fs AS (
    -- Le premier billet VENDU de la personne pour la soirée.
    SELECT DISTINCT ON (t.em, t.nid) t.em, t.nid, t.bought_at
      FROM _ant t WHERE t.sale
     ORDER BY t.em, t.nid, t.bought_at, t.id
  ), g AS (
    SELECT t.em, t.nid, bool_or(t.sale) AS has_sale, min(t.bought_at) AS first_any
      FROM _ant t
     GROUP BY t.em, t.nid
    HAVING bool_or(t.sale) OR bool_or(t.inv AND t.scanned)
  )
  SELECT g.em, g.nid, n.start_at, g.has_sale,
         extract(epoch FROM n.start_at - COALESCE(fs.bought_at, g.first_any)) / 3600.0 AS lead_h,
         row_number() OVER (PARTITION BY g.em ORDER BY n.start_at, n.nid)::int AS k
    FROM g JOIN _ann n ON n.nid = g.nid
    LEFT JOIN fs ON fs.em = g.em AND fs.nid = g.nid;
  CREATE INDEX ON _anbought (em, k);
  CREATE INDEX ON _anbought (nid);
  SELECT count(*) INTO v_n FROM _anbought;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_an_load_bought() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_an_load_bought() TO service_role;

-- ── « Chances de venir » : la cible reste l'achat ───────────────────────────
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
  v_off   text[];
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
  v_journal jsonb := '{}'::jsonb;
  v_prior float8;
  v_bt    jsonb;
  v_rn    integer := 0;
  v_rate  float8;
  v_blocked text[];
  i integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'crm_score_compute: service only' USING ERRCODE = '42501';
  END IF;
  IF v_key IS NULL OR (p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  sc := COALESCE(v_cfg->'score', '{}'::jsonb);
  v_off := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(sc->'off') = 'array' THEN sc->'off' ELSE '[]'::jsonb END));
  v_prior := GREATEST(0.1, COALESCE((sc->>'timing_prior')::float8, 2));

  -- Journal prévu / réel (20261013110000) : les soirées finies se comparent à
  -- la réalité avant tout. Une panne du journal ne coûte jamais le score.
  BEGIN
    v_journal := jsonb_build_object('settled', public._crm_score_settle(v_key, p_venue_id, p_organizer_user_id, now()));
  EXCEPTION WHEN others THEN
    v_journal := jsonb_build_object('settle_error', left(SQLERRM, 200));
  END;
  v_neg := LEAST(1, GREATEST(0.01, COALESCE((sc->>'neg_sample')::float8, 0.2)));

  PERFORM public._crm_an_load(p_venue_id, p_organizer_user_id, now(), v_cfg);
  -- Deux tables, deux questions (DATA-02, 18/10) : _ana = les soirées FAITES
  -- (qui est « déjà venu », l'historique, les facteurs) ; _anbought = les
  -- ACHATS (la cible : « a pris une place pour la soirée », et le rythme
  -- d'achat). Le score dit la chance d'acheter d'ici la soirée et le journal
  -- prévu / réel le compare aux ventes : une entrée gratuite prise reste un
  -- achat, même si la personne n'est pas venue.
  PERFORM public._crm_an_load_bought();
  PERFORM public._crm_score_targets(v_key, p_venue_id, p_organizer_user_id, v_cfg, false);

  -- Les soirées des N derniers mois ; les dernières sont tenues à l'écart.
  DELETE FROM _scx WHERE start_at < now() - make_interval(months => COALESCE((sc->>'months')::int, 12));
  SELECT start_at INTO v_cut FROM _scx ORDER BY start_at DESC
   OFFSET GREATEST(COALESCE((sc->>'holdout_nights')::int, 4) - 1, 0) LIMIT 1;
  SELECT count(*) FILTER (WHERE start_at < v_cut), count(*) FILTER (WHERE start_at >= v_cut) INTO v_ntr, v_nva FROM _scx;

  -- Venus pour la première fois PENDANT la vente d'une soirée passée : la part
  -- qui l'a achetée. C'est la chance donnée à ce même cas sur une soirée à
  -- venir (le modèle n'a pas de facteurs pour eux à l'ouverture de la vente).
  SELECT count(*), avg(z.y) INTO v_rn, v_rate
    FROM (SELECT CASE WHEN EXISTS (SELECT 1 FROM _anbought b WHERE b.em = f.em AND b.nid = x.xid AND b.has_sale) THEN 1 ELSE 0 END AS y
            FROM _scx x
            JOIN (SELECT em, min(start_at) AS first_at FROM _ana GROUP BY em) f
              ON f.first_at >= x.cutoff AND f.first_at < x.start_at) z;

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
      SELECT a.em, a.nid FROM _anbought a WHERE a.has_sale
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
      -- Facteurs constants sur ce compte (toutes les soirées pareilles) ou
      -- éteints (score.off) : retirés.
      v_idx := '{}';
      FOR i IN 1..cardinality(v_feat) LOOP
        CONTINUE WHEN v_feat[i] = ANY (v_off);
        IF (SELECT stddev_pop(f[i]) FROM _scf) > 1e-6 THEN v_idx := v_idx || i; END IF;
      END LOOP;
      SELECT * INTO v_mean, v_sd FROM public._crm_score_design(v_idx);
      -- Départ à chaud : les poids d'hier, facteur par facteur (par NOM) ; un
      -- facteur nouveau part de zéro. Ajouter un facteur ne force donc pas un
      -- départ à froid (58 s au lieu de 15 s sur le compte « grand » du banc).
      SELECT ARRAY[m.beta[1]] || ARRAY(SELECT COALESCE(m.beta[array_position(m.features, v_feat[u.j]) + 1], 0)
                                         FROM unnest(v_idx) WITH ORDINALITY u(j, o) ORDER BY u.o)
        INTO v_start FROM public.crm_score_model m
       WHERE m.scope_key = v_key AND m.status IN ('ok', 'weak') AND cardinality(m.beta) = cardinality(m.features) + 1;
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
        -- Rejeu à J-7 : parmi ceux qui n'avaient pas encore acheté une semaine
        -- avant, acheteurs attendus (part restante par personne, historique
        -- d'avant l'ouverture de la vente) contre acheteurs réels.
        WITH fk AS (
          SELECT avg(CASE WHEN a.lead_h <= 168 THEN 1 ELSE 0 END) AS f
            FROM _anbought a WHERE a.has_sale AND a.lead_h IS NOT NULL AND a.k > 1 AND a.start_at < v_cut
        ), pop AS (
          SELECT v.em, v.p, x.cutoff,
                 CASE WHEN b.em IS NOT NULL AND b.lead_h <= 168 THEN 1 ELSE 0 END AS y7
            FROM _scv v JOIN _scx x ON x.xid = v.xid
            LEFT JOIN _anbought b ON b.em = v.em AND b.nid = v.xid AND b.has_sale
           WHERE NOT (b.em IS NOT NULL AND COALESCE(b.lead_h, 0) > 168)
        ), per AS (
          SELECT pop.*,
                 (SELECT count(*) FROM _anbought h WHERE h.em = pop.em AND h.has_sale AND h.lead_h IS NOT NULL AND h.start_at < pop.cutoff) AS n,
                 (SELECT count(*) FROM _anbought h WHERE h.em = pop.em AND h.has_sale AND h.lead_h IS NOT NULL AND h.start_at < pop.cutoff
                     AND h.lead_h <= 168) AS m
            FROM pop
        )
        SELECT jsonb_build_object('hours', 168, 'n', count(*), 'buyers', COALESCE(sum(per.y7), 0),
                 'expected', round(COALESCE(sum(per.p * q.fi / GREATEST(1e-9, 1 - per.p * (1 - q.fi))), 0)::numeric, 1))
          INTO v_bt
          FROM per CROSS JOIN fk
          CROSS JOIN LATERAL (SELECT (v_prior * COALESCE(fk.f, 1) + per.m) / (v_prior + per.n) AS fi) q;
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
            'backtest', v_bt,
            'recent', jsonb_build_object('pairs', v_rn, 'rate', round(v_rate::numeric, 4)),
            'timing_prior', v_prior,
            'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000))),
          now())
  ON CONFLICT (scope_key) DO UPDATE SET status = EXCLUDED.status, features = EXCLUDED.features, mean = EXCLUDED.mean,
    sd = EXCLUDED.sd, beta = EXCLUDED.beta, metrics = EXCLUDED.metrics, trained_at = EXCLUDED.trained_at;

  -- Le score des soirées à venir (seulement avec un modèle validé).
  DELETE FROM public.crm_person_night_score WHERE scope_key = v_key;
  DELETE FROM public.crm_score_night WHERE scope_key = v_key;
  IF v_status = 'ok' THEN
    PERFORM public._crm_score_targets(v_key, p_venue_id, p_organizer_user_id, v_cfg, true);
    -- Parts des achats encore à venir, H = heures restantes avant la soirée :
    -- celle des clients déjà venus (F, à priori de chaque personne) et celle
    -- des PREMIERS achats (projection des nouveaux, crm_score_night).
    ALTER TABLE _scx ADD COLUMN h float8, ADD COLUMN f_known float8, ADD COLUMN f_new float8;
    UPDATE _scx x SET h = GREATEST(0, extract(epoch FROM x.start_at - now()) / 3600.0);
    UPDATE _scx x SET
      f_known = COALESCE(
        (SELECT avg(CASE WHEN a.lead_h <= x.h THEN 1 ELSE 0 END) FROM _anbought a WHERE a.has_sale AND a.lead_h IS NOT NULL AND a.k > 1),
        (SELECT avg(CASE WHEN a.lead_h <= x.h THEN 1 ELSE 0 END) FROM _anbought a WHERE a.has_sale AND a.lead_h IS NOT NULL), 1),
      f_new = COALESCE(
        (SELECT avg(CASE WHEN a.lead_h <= x.h THEN 1 ELSE 0 END) FROM _anbought a WHERE a.has_sale AND a.lead_h IS NOT NULL AND a.k = 1),
        (SELECT avg(CASE WHEN a.lead_h <= x.h THEN 1 ELSE 0 END) FROM _anbought a WHERE a.has_sale AND a.lead_h IS NOT NULL), 1);
    INSERT INTO public.crm_score_night (scope_key, event_id, remaining_share)
    SELECT v_key, x.event_id, x.f_new FROM _scx x WHERE x.event_id IS NOT NULL;
    -- Le rythme d'achat de chaque personne (tout son historique).
    DROP TABLE IF EXISTS _sct;
    CREATE TEMP TABLE _sct ON COMMIT DROP AS
    SELECT x.xid, a.em, count(*) AS n, count(*) FILTER (WHERE a.lead_h <= x.h) AS m
      FROM _scx x CROSS JOIN _anbought a
     WHERE a.has_sale AND a.lead_h IS NOT NULL
     GROUP BY x.xid, a.em;
    CREATE INDEX ON _sct (xid, em);
    -- Les personnes sans place : déjà venues à l'ouverture de la vente
    -- (facteurs à cette date, notées par le modèle), ou venues pour la
    -- première fois depuis (taux du compte pour ce cas).
    DROP TABLE IF EXISTS _scw;
    CREATE TEMP TABLE _scw ON COMMIT DROP AS
    SELECT x.xid, p.em, p.first_at < x.cutoff AS known
      FROM _scx x
      CROSS JOIN (SELECT em, min(start_at) AS first_at FROM _ana GROUP BY em) p
     WHERE NOT EXISTS (
       SELECT 1 FROM public.external_tickets t
        WHERE t.event_id = x.event_id AND lower(t.buyer_email) = p.em AND t.status IN ('valid', 'transferred'));
    DROP TABLE IF EXISTS _scp;
    CREATE TEMP TABLE _scp ON COMMIT DROP AS
    SELECT w.xid, w.em, 0 AS y, 1.0::float8 AS w FROM _scw w WHERE w.known;
    PERFORM public._crm_score_build(v_cfg);
    PERFORM public._crm_score_apply(v_idx, v_mean, v_sd, v_beta);
    -- Facteurs dont la famille d'hypothèse n'est pas confirmée sur le compte :
    -- jamais une raison (décision de Paul, 07/10).
    v_blocked := ARRAY(
      SELECT DISTINCT fs.family FROM public.crm_family_status fs
       WHERE fs.scope_key = v_key AND fs.variant = '' AND fs.status = 'not_supported');
    -- Chance d'acheter D'ICI la soirée, sachant qu'il n'a pas encore acheté :
    -- p·f / (1 − p·(1 − f)), f = sa part des achats encore à venir.
    INSERT INTO public.crm_person_night_score (scope_key, event_id, email, p, label, reasons)
    SELECT v_key, x.event_id, v.em, q.pa,
           CASE WHEN q.pa >= COALESCE((sc->>'high')::float8, 0.30) THEN 'high'
                WHEN q.pa >= COALESCE((sc->>'medium')::float8, 0.10) THEN 'medium' ELSE 'low' END,
           -- Raisons : les facteurs qui poussent sa chance vers le haut ET qu'il
           -- possède vraiment (un trait à zéro n'est jamais une raison) ; « de
           -- passage » et « découverte Shotgun » décrivent un contexte, jamais
           -- une raison de venir ; une famille pas confirmée sur le compte non plus.
           -- Deux facteurs du même libellé (artiste vu, artiste vu récemment)
           -- comptent une fois, avec leur poids cumulé.
           ARRAY(SELECT z.k FROM (
                   SELECT public._crm_score_reason_key(v_feat[v_idx[gi]]) AS k, sum(v.c[gi]) AS c
                     FROM generate_subscripts(v.c, 1) gi
                    WHERE v.c[gi] > 0 AND public._crm_score_reason_key(v_feat[v_idx[gi]]) IS NOT NULL
                      AND (v_feat[v_idx[gi]] = 'rec' OR f.f[v_idx[gi]] > 0)
                    GROUP BY 1) z
                  WHERE z.c > 0.15
                    AND NOT COALESCE(public._crm_score_reason_family(z.k) = ANY (v_blocked), false)
                  ORDER BY z.c DESC LIMIT 3)
      FROM _scv v JOIN _scx x ON x.xid = v.xid
      JOIN _scf f ON f.xid = v.xid AND f.em = v.em
      LEFT JOIN _sct t ON t.xid = v.xid AND t.em = v.em
      CROSS JOIN LATERAL (SELECT (v_prior * x.f_known + COALESCE(t.m, 0)) / (v_prior + COALESCE(t.n, 0)) AS fi) z
      CROSS JOIN LATERAL (SELECT v.p * z.fi / GREATEST(1e-9, 1 - v.p * (1 - z.fi)) AS pa) q
     WHERE x.event_id IS NOT NULL;
    GET DIAGNOSTICS v_scored = ROW_COUNT;
    -- Venus pour la première fois depuis l'ouverture de la vente : le taux du
    -- compte, s'il repose sur assez de cas ; aucune raison.
    IF v_rn >= COALESCE((sc->>'recent_min_pairs')::int, 50) AND v_rate IS NOT NULL THEN
      INSERT INTO public.crm_person_night_score (scope_key, event_id, email, p, label, reasons)
      SELECT v_key, x.event_id, w.em, q.pa,
             CASE WHEN q.pa >= COALESCE((sc->>'high')::float8, 0.30) THEN 'high'
                  WHEN q.pa >= COALESCE((sc->>'medium')::float8, 0.10) THEN 'medium' ELSE 'low' END,
             '{}'::text[]
        FROM _scw w JOIN _scx x ON x.xid = w.xid
        LEFT JOIN _sct t ON t.xid = w.xid AND t.em = w.em
        CROSS JOIN LATERAL (SELECT (v_prior * x.f_known + COALESCE(t.m, 0)) / (v_prior + COALESCE(t.n, 0)) AS fi) z
        CROSS JOIN LATERAL (SELECT v_rate * z.fi / GREATEST(1e-9, 1 - v_rate * (1 - z.fi)) AS pa) q
       WHERE NOT w.known AND x.event_id IS NOT NULL;
      GET DIAGNOSTICS i = ROW_COUNT;
      v_scored := v_scored + i;
    END IF;
    BEGIN
      v_journal := v_journal || jsonb_build_object('logged', public._crm_score_journal(v_key, p_venue_id, p_organizer_user_id));
    EXCEPTION WHEN others THEN
      v_journal := v_journal || jsonb_build_object('journal_error', left(SQLERRM, 200));
    END;
  END IF;
  IF v_journal ? 'settle_error' OR v_journal ? 'journal_error' THEN
    UPDATE public.crm_score_model SET metrics = metrics || jsonb_build_object('journal', v_journal) WHERE scope_key = v_key;
  END IF;

  RETURN jsonb_build_object('scope', v_key, 'status', v_status, 'scored', v_scored, 'journal', v_journal,
    'auc', v_va->'auc', 'auc_base', v_vb->'auc', 'ece', v_va->'ece',
    'auc_active', v_va->'active'->'auc', 'auc_active_base', v_vb->'active'->'auc',
    'backtest', v_bt,
    'ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000));
END;
$function$;
