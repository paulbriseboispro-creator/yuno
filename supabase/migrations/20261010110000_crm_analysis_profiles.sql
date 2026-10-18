-- ============================================================================
-- Yuno CRM — analyse client, lot B : les profils PRÉ-CALCULÉS (2026-10-07).
-- Plan : docs/designs/CRM_CLIENT_ANALYSIS_PLAN.md, consignes :
-- docs/designs/CRM_CLIENT_ANALYSIS_PROMPT.md.
--
-- Rien de ceci ne tourne à l'écran : _crm_people_build (chaque écran de la
-- Console, machine Nano) ne fait qu'UNE jointure de plus. Tout se calcule
-- hors ligne, par portée, dans des tables sans policy :
--
--   crm_artist_seen     (connexion, soirée, artiste, 1re apparition) : la
--                       mémoire des annonces de line-up, alimentée à chaque
--                       synchro. Les soirées déjà en base reçoivent leur date
--                       de publication comme borne, drapeau « inconnue ».
--   crm_night_profile   ce que chaque soirée a attiré (série, artistes et leur
--                       rareté À LA DATE de la soirée, genres BRUTS de
--                       Shotgun, format, créneau, jour, lieu, entrées,
--                       nouveaux, rythme de vente, origine des nouveaux).
--   crm_person_profile  par personne : les faits de son 1er billet VENDU, ses
--                       agrégats (artistes, genres, formats, séries, profil
--                       d'achat, à plusieurs, distance) et, au lot C, ses
--                       hypothèses ; `tags` alimente les filtres de _cp.
--   crm_artist_stats    par artiste : soirées, entrées, nouveaux amenés,
--                       revenants parmi eux, vus deux fois ou plus.
--   crm_profile_optouts droit d'opposition : un contact exclu n'a plus de
--                       profil et n'est jamais recalculé.
--
-- Rafraîchissement : ticketing_after_sync() marque les e-mails touchés
-- (crm_analysis_dirty) ; le cron `crm-analysis-refresh` (toutes les 30 min,
-- budget de 4 s) recalcule ceux-là ; `crm-analysis-nightly` refait une
-- portée entière par passage (statuts des familles, lot C).
-- Purge : avec la connexion (suppression ou déconnexion), avec le contact
-- (_crm_erase_contacts), avec le compte (clés étrangères).
--
-- Un contact venu seulement d'un fichier importé n'a ni line-up ni commande :
-- il n'a pas de profil d'analyse (il garde son profil et sa trajectoire dans
-- _cp).
-- ============================================================================

-- ── 1. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_artist_seen (
  connection_id     uuid NOT NULL REFERENCES public.ticketing_connections(id) ON DELETE CASCADE,
  external_event_id text NOT NULL,
  artist_key        text NOT NULL,
  first_seen_at     timestamptz NOT NULL,
  -- false : l'artiste était déjà là au premier passage de Yuno (soirée
  -- importée) ; `first_seen_at` n'est alors qu'une borne (publication).
  announce_known    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (connection_id, external_event_id, artist_key)
);
ALTER TABLE public.crm_artist_seen ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_analysis_state (
  scope_key         text PRIMARY KEY,
  venue_id          text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  dirty_at          timestamptz,
  last_mark_at      timestamptz,
  computed_at       timestamptz,
  full_at           timestamptz,
  rules_version     integer,
  coverage          jsonb,
  duration_ms       integer,
  people            integer,
  -- Calcul complet : trajectoire du compte (délai de retour, revenants), sans
  -- donnée personnelle.
  stats             jsonb,
  last_error        text,
  last_error_at     timestamptz,
  CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);
ALTER TABLE public.crm_analysis_state ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_analysis_dirty (
  scope_key text NOT NULL REFERENCES public.crm_analysis_state(scope_key) ON DELETE CASCADE,
  email     text NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, email)
);
ALTER TABLE public.crm_analysis_dirty ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_night_profile (
  scope_key         text NOT NULL,
  venue_id          text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  external_event_id uuid NOT NULL REFERENCES public.external_events(id) ON DELETE CASCADE,
  event_id          uuid,
  title             text,
  starts_at         timestamptz,
  night_date        date,
  series            text,
  slot              text,
  weekday           smallint,
  format            text,
  place_key         text,
  genres            text[] NOT NULL DEFAULT '{}',
  -- [{k, name, slug, avatar, share, resident, first}] : `share` = part des
  -- soirées du compte, jusqu'à celle-ci comprise, où l'artiste jouait.
  artists           jsonb NOT NULL DEFAULT '[]'::jsonb,
  entries           integer NOT NULL DEFAULT 0,
  buyers            integer NOT NULL DEFAULT 0,
  new_people        integer NOT NULL DEFAULT 0,
  new_share         numeric,
  launch_known      boolean NOT NULL DEFAULT false,
  launch_48h_share  numeric,
  -- Origine des nouveaux : {src: {code: n}, far, foreign, group, lead_days}.
  new_origin        jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_eligible      integer NOT NULL DEFAULT 0,
  new_returned      integer NOT NULL DEFAULT 0,
  rules_version     integer,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, external_event_id)
);
CREATE INDEX IF NOT EXISTS crm_night_profile_event ON public.crm_night_profile (event_id);
ALTER TABLE public.crm_night_profile ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_person_profile (
  scope_key         text NOT NULL,
  venue_id          text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email             text NOT NULL,
  nights            integer NOT NULL DEFAULT 0,
  first_facts       jsonb NOT NULL DEFAULT '{}'::jsonb,
  agg               jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{f, s, k, p}] : famille, force (strong | medium | weak), clé de preuve,
  -- paramètres. Le statut de la famille se lit À L'AFFICHAGE (lot C).
  hyps              jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags              text[] NOT NULL DEFAULT '{}',
  dist_km           integer,
  passing           boolean,
  rules_version     integer,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, email)
);
ALTER TABLE public.crm_person_profile ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_artist_stats (
  scope_key         text NOT NULL,
  venue_id          text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  artist_key        text NOT NULL,
  name              text,
  slug              text,
  avatar            text,
  nights            integer NOT NULL DEFAULT 0,
  entries           integer NOT NULL DEFAULT 0,
  new_brought       integer NOT NULL DEFAULT 0,
  new_eligible      integer NOT NULL DEFAULT 0,
  new_returned      integer NOT NULL DEFAULT 0,
  fans              integer NOT NULL DEFAULT 0,
  share             numeric,
  last_night        timestamptz,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, artist_key)
);
ALTER TABLE public.crm_artist_stats ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_profile_optouts (
  scope_key  text NOT NULL,
  email      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (scope_key, email)
);
ALTER TABLE public.crm_profile_optouts ENABLE ROW LEVEL SECURITY;
-- Aucune policy sur ces tables : écrites par les fonctions SECURITY DEFINER
-- ci-dessous, lues par les RPC gardées (lot D).

-- ── 2. Petites règles pures ─────────────────────────────────────────────────
-- Clé stable d'un artiste Shotgun : son id, sinon son slug, sinon son nom.
CREATE OR REPLACE FUNCTION public._crm_artist_key(p_a jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN jsonb_typeof(p_a) = 'object' THEN
    COALESCE('id:' || NULLIF(btrim(p_a->>'id'), ''),
             'slug:' || lower(NULLIF(btrim(p_a->>'slug'), '')),
             'name:' || lower(NULLIF(btrim(p_a->>'name'), ''))) END;
$$;

-- Créneau d'une soirée, d'après l'heure LOCALE de son début.
CREATE OR REPLACE FUNCTION public._crm_an_slot(p_start timestamptz, p_tz text, p_cfg jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN h >= COALESCE((p_cfg->'slots'->>'after')::int, 5) AND h < COALESCE((p_cfg->'slots'->>'day')::int, 11) THEN 'after'
    WHEN h >= COALESCE((p_cfg->'slots'->>'day')::int, 11) AND h < COALESCE((p_cfg->'slots'->>'sunset')::int, 16) THEN 'day'
    WHEN h >= COALESCE((p_cfg->'slots'->>'sunset')::int, 16) AND h < COALESCE((p_cfg->'slots'->>'evening')::int, 20) THEN 'sunset'
    WHEN h >= COALESCE((p_cfg->'slots'->>'evening')::int, 20) AND h < COALESCE((p_cfg->'slots'->>'night')::int, 23) THEN 'evening'
    ELSE 'night' END
  FROM (SELECT extract(hour FROM p_start AT TIME ZONE COALESCE(NULLIF(p_tz, ''), 'Europe/Paris'))::int AS h) x
  WHERE p_start IS NOT NULL;
$$;

-- Distance à vol d'oiseau, en km (formule de haversine).
CREATE OR REPLACE FUNCTION public._crm_km(p_lat1 double precision, p_lng1 double precision,
                                          p_lat2 double precision, p_lng2 double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 2 * 6371 * asin(sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
           + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)))
   WHERE p_lat1 IS NOT NULL AND p_lng1 IS NOT NULL AND p_lat2 IS NOT NULL AND p_lng2 IS NOT NULL;
$$;

-- Code postal français à 5 chiffres (null hors de France ou illisible).
CREATE OR REPLACE FUNCTION public._crm_cp_fr(p_zip text, p_country text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN COALESCE(upper(btrim(p_country)), 'FR') = 'FR'
                   AND regexp_replace(COALESCE(p_zip, ''), '\s', '', 'g') ~ '^[0-9]{5}$'
              THEN regexp_replace(p_zip, '\s', '', 'g') END;
$$;

REVOKE ALL ON FUNCTION public._crm_artist_key(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._crm_an_slot(timestamptz, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._crm_km(double precision, double precision, double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._crm_cp_fr(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_artist_key(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_an_slot(timestamptz, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_km(double precision, double precision, double precision, double precision) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_cp_fr(text, text) TO authenticated, service_role;

-- ── 3. Chargement d'une portée en tables temporaires ────────────────────────
-- Une seule lecture des soirées et des billets de la portée, à la date
-- `p_at`. Tables (ON COMMIT DROP) :
--   _ann    soirées commencées (nid = external_events.id), traits, mise en vente ;
--   _annart artistes de chaque soirée ;
--   _anrar  rareté de chaque artiste À LA DATE de chaque soirée (part des
--           soirées commencées jusque-là où il jouait) ;
--   _ant    billets : ventes, et invitations ;
--   _ana    une venue par (personne, soirée) : billet vendu, ou invitation
--           scannée (même règle que _cp) ; rang `k`, délais, commande ;
--   _anp    une ligne par personne : code postal, pays, coordonnées.
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
  UPDATE _ana a SET with_returning = true
   WHERE a.oid IS NOT NULL AND EXISTS (
     SELECT 1 FROM _ant o
       JOIN _ana b ON b.em = o.em AND b.start_at < a.start_at
      WHERE o.nid = a.nid AND o.oid = a.oid AND o.sale AND o.em <> a.em);

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

-- ── 4. Profils de soirée et d'artiste ───────────────────────────────────────
-- Lit les tables de _crm_an_load ; remplace les lignes de la portée.
CREATE OR REPLACE FUNCTION public._crm_an_write_nights(p_venue_id text, p_organizer_user_id uuid, p_at timestamptz, p_cfg jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_at timestamptz := COALESCE(p_at, now());
  v_ret interval := make_interval(days => COALESCE((p_cfg->'return'->>'days')::int, 180));
  v_res numeric := COALESCE((p_cfg->'rarity'->>'resident_share')::numeric, 0.2);
  v_minb int := COALESCE((p_cfg->'rarity'->>'min_nights')::int, 5);
  v_far numeric := COALESCE((p_cfg->'distance'->>'far_km')::numeric, 80);
  v_grp int := COALESCE((p_cfg->'group'->>'min_tickets')::int, 2);
  v_n integer;
BEGIN
  -- Nouveaux venus (1re venue sur le compte), une fois : distance, retour.
  DROP TABLE IF EXISTS _annew;
  CREATE TEMP TABLE _annew ON COMMIT DROP AS
  SELECT a.em, a.nid, a.start_at, a.src, a.has_sale, a.invited_only, a.order_size, a.lead_h,
         p.country, p.main_country,
         round(public._crm_km(p.lat, p.lng, n.lat, n.lng)) AS km,
         (a.start_at <= v_at - v_ret) AS eligible,
         (b.start_at IS NOT NULL AND b.start_at <= a.start_at + v_ret) AS returned
    FROM _ana a
    JOIN _ann n ON n.nid = a.nid
    LEFT JOIN _anp p ON p.em = a.em
    LEFT JOIN _ana b ON b.em = a.em AND b.k = 2
   WHERE a.k = 1;
  CREATE INDEX ON _annew (nid);

  DELETE FROM public.crm_night_profile WHERE scope_key = v_key;
  WITH st AS (
    SELECT a.nid, count(*) AS entries, count(*) FILTER (WHERE a.has_sale) AS buyers,
           count(*) FILTER (WHERE a.k = 1) AS newp
      FROM _ana a GROUP BY 1
  ), sl AS (
    SELECT t.nid, count(*) AS sales,
           count(*) FILTER (WHERE t.bought_at <= m.launched_at + interval '48 hours') AS early
      FROM _ant t JOIN _ann m ON m.nid = t.nid
     WHERE t.sale AND m.launch_known GROUP BY 1
  ), nw AS (
    SELECT w.nid,
           count(*) FILTER (WHERE w.km > v_far) AS far,
           count(*) FILTER (WHERE w.country IS NOT NULL AND w.country <> w.main_country) AS foreign_n,
           count(*) FILTER (WHERE w.order_size >= v_grp) AS grp,
           count(*) FILTER (WHERE w.invited_only) AS invited,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY w.lead_h) FILTER (WHERE w.has_sale AND w.lead_h >= 0) / 24)::numeric, 1) AS lead_days,
           count(*) FILTER (WHERE w.eligible) AS eligible,
           count(*) FILTER (WHERE w.eligible AND w.returned) AS returned
      FROM _annew w GROUP BY 1
  ), src AS (
    SELECT z.nid, jsonb_object_agg(z.src, z.c) AS src
      FROM (SELECT nid, COALESCE(CASE WHEN invited_only THEN 'gl' ELSE src END, 'of') AS src, count(*) AS c
              FROM _annew GROUP BY 1, 2) z
     GROUP BY z.nid
  ), firstplay AS (
    -- Rang de la première soirée du compte où chaque artiste joue.
    SELECT a.ak, min(m.rn) AS rn FROM _annart a JOIN _ann m ON m.nid = a.nid GROUP BY 1
  ), arts AS (
    SELECT a.nid, jsonb_agg(jsonb_build_object(
             'k', a.ak, 'name', a.name, 'slug', a.slug, 'avatar', a.avatar,
             'share', round(r.share, 3),
             'resident', r.base >= v_minb AND r.share > v_res,
             'first', fp.rn = n.rn) ORDER BY r.share, a.name) AS artists
      FROM _annart a
      JOIN _ann n ON n.nid = a.nid
      JOIN _anrar r ON r.nid = a.nid AND r.ak = a.ak
      JOIN firstplay fp ON fp.ak = a.ak
     GROUP BY a.nid
  )
  INSERT INTO public.crm_night_profile (
    scope_key, venue_id, organizer_user_id, external_event_id, event_id, title, starts_at, night_date,
    series, slot, weekday, format, place_key, genres, artists, entries, buyers, new_people, new_share,
    launch_known, launch_48h_share, new_origin, new_eligible, new_returned, rules_version, computed_at)
  SELECT v_key, p_venue_id, p_organizer_user_id, n.nid, n.event_id, n.name, n.start_at, n.night_date,
         n.series, n.slot, n.wd, n.fmt, n.place_key, n.genres, COALESCE(ar.artists, '[]'::jsonb),
         COALESCE(st.entries, 0), COALESCE(st.buyers, 0), COALESCE(st.newp, 0),
         CASE WHEN COALESCE(st.entries, 0) > 0 THEN round(st.newp::numeric / st.entries, 3) END,
         n.launch_known,
         CASE WHEN n.launch_known AND COALESCE(sl.sales, 0) > 0 THEN round(sl.early::numeric / sl.sales, 3) END,
         jsonb_build_object('src', COALESCE(sr.src, '{}'::jsonb), 'far', COALESCE(nw.far, 0),
                            'foreign', COALESCE(nw.foreign_n, 0), 'group', COALESCE(nw.grp, 0),
                            'invited', COALESCE(nw.invited, 0), 'lead_days', nw.lead_days),
         COALESCE(nw.eligible, 0), COALESCE(nw.returned, 0),
         (p_cfg->>'rules_version')::int, now()
    FROM _ann n
    LEFT JOIN st ON st.nid = n.nid
    LEFT JOIN sl ON sl.nid = n.nid
    LEFT JOIN nw ON nw.nid = n.nid
    LEFT JOIN src sr ON sr.nid = n.nid
    LEFT JOIN arts ar ON ar.nid = n.nid;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM public.crm_artist_stats WHERE scope_key = v_key;
  WITH xa AS (
    SELECT y.ak, x.em, x.nid, x.k FROM _ana x JOIN _annart y ON y.nid = x.nid
  ), ent AS (
    SELECT ak, count(*) AS entries, count(*) FILTER (WHERE k = 1) AS new_brought FROM xa GROUP BY 1
  ), fans AS (
    SELECT ak, count(*) AS fans FROM (SELECT ak, em FROM xa GROUP BY 1, 2 HAVING count(DISTINCT nid) >= 2) f GROUP BY 1
  ), ret AS (
    SELECT y.ak, count(*) FILTER (WHERE w.eligible) AS eligible, count(*) FILTER (WHERE w.eligible AND w.returned) AS returned
      FROM _annew w JOIN _annart y ON y.nid = w.nid GROUP BY 1
  ), last_share AS (
    SELECT DISTINCT ON (r.ak) r.ak, r.share FROM _anrar r JOIN _ann m ON m.nid = r.nid ORDER BY r.ak, m.rn DESC
  ), meta AS (
    SELECT a.ak,
           (array_agg(a.name ORDER BY n.start_at DESC) FILTER (WHERE a.name IS NOT NULL))[1] AS name,
           (array_agg(a.slug ORDER BY n.start_at DESC) FILTER (WHERE a.slug IS NOT NULL))[1] AS slug,
           (array_agg(a.avatar ORDER BY n.start_at DESC) FILTER (WHERE a.avatar IS NOT NULL))[1] AS avatar,
           count(DISTINCT a.nid) AS nights, max(n.start_at) AS last_night
      FROM _annart a JOIN _ann n ON n.nid = a.nid GROUP BY 1
  )
  INSERT INTO public.crm_artist_stats (
    scope_key, venue_id, organizer_user_id, artist_key, name, slug, avatar, nights, entries,
    new_brought, new_eligible, new_returned, fans, share, last_night, computed_at)
  SELECT v_key, p_venue_id, p_organizer_user_id, m.ak, m.name, m.slug, m.avatar, m.nights,
         COALESCE(e.entries, 0), COALESCE(e.new_brought, 0), COALESCE(r.eligible, 0), COALESCE(r.returned, 0),
         COALESCE(f.fans, 0), round(ls.share, 3), m.last_night, now()
    FROM meta m
    LEFT JOIN ent e ON e.ak = m.ak
    LEFT JOIN fans f ON f.ak = m.ak
    LEFT JOIN ret r ON r.ak = m.ak
    LEFT JOIN last_share ls ON ls.ak = m.ak;

  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_an_write_nights(text, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_an_write_nights(text, uuid, timestamptz, jsonb) TO service_role;

-- ── 5. Profils de personne ──────────────────────────────────────────────────
-- Construit _anpp (une ligne par personne de `_antg`, la liste des e-mails
-- à recalculer), puis le lot C y pose les hypothèses (_crm_an_fill_hyps) avant
-- l'écriture. Les faits sont ceux d'AVANT p_at.
CREATE OR REPLACE FUNCTION public._crm_an_write_people(p_venue_id text, p_organizer_user_id uuid, p_at timestamptz, p_cfg jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_res numeric := COALESCE((p_cfg->'rarity'->>'resident_share')::numeric, 0.2);
  v_minb int := COALESCE((p_cfg->'rarity'->>'min_nights')::int, 5);
  v_early numeric := COALESCE((p_cfg->'buy'->>'early_days')::numeric, 14) * 24;
  v_launch numeric := COALESCE((p_cfg->'buy'->>'launch_hours')::numeric, 24);
  v_last numeric := COALESCE((p_cfg->'buy'->>'last_minute_hours')::numeric, 24);
  v_far numeric := COALESCE((p_cfg->'distance'->>'far_km')::numeric, 80);
  v_grp int := COALESCE((p_cfg->'group'->>'min_tickets')::int, 2);
  v_n integer;
BEGIN
  -- Classes d'achat de chaque venue payée (null = inconnu).
  DROP TABLE IF EXISTS _anbuy;
  CREATE TEMP TABLE _anbuy ON COMMIT DROP AS
  SELECT a.em, a.nid, a.k,
         CASE WHEN a.has_sale THEN a.lead_h >= v_early END AS early,
         CASE WHEN a.has_sale AND a.since_launch_h IS NOT NULL THEN a.since_launch_h BETWEEN 0 AND v_launch END AS launch,
         CASE WHEN a.has_sale THEN a.lead_h BETWEEN 0 AND v_last END AS last_minute,
         CASE WHEN a.has_sale THEN a.door END AS door,
         CASE WHEN a.has_sale THEN a.order_size >= v_grp END AS grp,
         CASE WHEN a.has_sale THEN a.tbl END AS tbl
    FROM _ana a JOIN _antg g ON g.em = a.em;

  -- Agrégats par personne, calculés une fois (jamais une sous-requête par
  -- personne : une base de 12 000 contacts doit passer en quelques secondes).
  DROP TABLE IF EXISTS _anme;
  CREATE TEMP TABLE _anme ON COMMIT DROP AS SELECT a.* FROM _ana a JOIN _antg g ON g.em = a.em;
  CREATE INDEX ON _anme (em);

  DROP TABLE IF EXISTS _anpx;
  CREATE TEMP TABLE _anpx ON COMMIT DROP AS
  WITH art AS (
    SELECT m.em, y.ak,
           (array_agg(y.name ORDER BY m.start_at DESC) FILTER (WHERE y.name IS NOT NULL))[1] AS name,
           count(DISTINCT m.nid) AS n, count(DISTINCT m.series) AS series_n,
           -- Fois où il était RARE à la date de la soirée (pas un résident).
           count(DISTINCT m.nid) FILTER (WHERE NOT (r.base >= v_minb AND r.share > v_res)) AS rare_n
      FROM _anme m JOIN _annart y ON y.nid = m.nid
      JOIN _anrar r ON r.nid = m.nid AND r.ak = y.ak
     GROUP BY m.em, y.ak
  ), art_r AS (
    SELECT art.*, row_number() OVER (PARTITION BY em ORDER BY n DESC, rare_n DESC, name) AS rk FROM art
  ), art_j AS (
    SELECT em,
           jsonb_agg(jsonb_build_object('k', ak, 'name', name, 'n', n, 'series', series_n, 'rare', rare_n)
                     ORDER BY rk) FILTER (WHERE rk <= 8) AS j,
           array_agg('a:' || ak) AS tags
      FROM art_r GROUP BY em
  ), gen AS (
    SELECT m.em, g AS v, count(*) AS n
      FROM _anme m JOIN _ann n ON n.nid = m.nid CROSS JOIN LATERAL unnest(n.genres) g GROUP BY 1, 2
  ), gen_j AS (
    SELECT em, jsonb_agg(jsonb_build_object('v', v, 'n', n) ORDER BY rk) FILTER (WHERE rk <= 6) AS j,
           array_agg('g:' || v) AS tags
      FROM (SELECT gen.*, row_number() OVER (PARTITION BY em ORDER BY n DESC, v) AS rk FROM gen) z GROUP BY em
  ), gen_tot AS (
    SELECT m.em, count(*) AS n FROM _anme m JOIN _ann n ON n.nid = m.nid WHERE cardinality(n.genres) > 0 GROUP BY 1
  ), trait AS (
    SELECT m.em, 'format' AS f, n.fmt AS v FROM _anme m JOIN _ann n ON n.nid = m.nid WHERE n.fmt IS NOT NULL
    UNION ALL SELECT m.em, 'slot', n.slot FROM _anme m JOIN _ann n ON n.nid = m.nid WHERE n.slot IS NOT NULL
    UNION ALL SELECT m.em, 'weekday', n.wd::text FROM _anme m JOIN _ann n ON n.nid = m.nid
    UNION ALL SELECT m.em, 'place', n.place_key FROM _anme m JOIN _ann n ON n.nid = m.nid WHERE n.place_key IS NOT NULL
  ), trait_c AS (
    SELECT em, f, v, count(*) AS n FROM trait GROUP BY 1, 2, 3
  ), trait_j AS (
    SELECT em, jsonb_object_agg(f, vals) AS j FROM (
      SELECT em, f, jsonb_agg(jsonb_build_object('v', v, 'n', n) ORDER BY n DESC, v) AS vals FROM trait_c GROUP BY 1, 2) z
     GROUP BY em
  ), fmt_t AS (
    SELECT em, array_agg('fmt:' || v) AS tags FROM trait_c WHERE f = 'format' GROUP BY em
  ), ser AS (
    SELECT m.em, m.series AS v, count(*) AS n,
           count(DISTINCT array_to_string(n.arts, '|')) FILTER (WHERE cardinality(n.arts) > 0) AS lineups
      FROM _anme m JOIN _ann n ON n.nid = m.nid WHERE m.series IS NOT NULL GROUP BY 1, 2
  ), ser_j AS (
    SELECT em, jsonb_agg(jsonb_build_object('v', v, 'n', n, 'lineups', lineups) ORDER BY rk) FILTER (WHERE rk <= 6) AS j,
           array_agg('s:' || lower(v)) AS tags
      FROM (SELECT ser.*, row_number() OVER (PARTITION BY em ORDER BY n DESC, v) AS rk FROM ser) z GROUP BY em
  ), buy AS (
    SELECT b.em,
           count(*) FILTER (WHERE b.early IS NOT NULL) AS n,
           count(*) FILTER (WHERE b.early) AS early,
           count(*) FILTER (WHERE b.launch IS NOT NULL) AS launch_known,
           count(*) FILTER (WHERE b.launch) AS launch,
           count(*) FILTER (WHERE b.last_minute) AS last_minute,
           count(*) FILTER (WHERE b.door) AS door,
           count(*) FILTER (WHERE b.grp) AS grp,
           count(*) FILTER (WHERE b.tbl) AS tbl
      FROM _anbuy b GROUP BY 1
  ), tot AS (
    SELECT m.em, count(*) AS nights FROM _anme m GROUP BY 1
  )
  SELECT t.em, t.nights::int AS nights, aj.j AS art_j, aj.tags AS art_t, gj.j AS gen_j, gj.tags AS gen_t,
         COALESCE(gt.n, 0) AS gen_n, tj.j AS trait_j, ft.tags AS fmt_t, sj.j AS ser_j, sj.tags AS ser_t,
         b.n AS b_n, b.early AS b_early, b.launch_known AS b_lk, b.launch AS b_launch,
         b.last_minute AS b_last, b.door AS b_door, b.grp AS b_grp, b.tbl AS b_tbl
    FROM tot t
    LEFT JOIN art_j aj ON aj.em = t.em
    LEFT JOIN gen_j gj ON gj.em = t.em
    LEFT JOIN gen_tot gt ON gt.em = t.em
    LEFT JOIN trait_j tj ON tj.em = t.em
    LEFT JOIN fmt_t ft ON ft.em = t.em
    LEFT JOIN ser_j sj ON sj.em = t.em
    LEFT JOIN buy b ON b.em = t.em;

  -- Artistes de la 1re soirée de chacun (avec leur rareté à cette date).
  DROP TABLE IF EXISTS _anfa;
  CREATE TEMP TABLE _anfa ON COMMIT DROP AS
  SELECT y.nid, jsonb_agg(jsonb_build_object('k', y.ak, 'name', y.name,
                    'rare', NOT (r.base >= v_minb AND r.share > v_res)) ORDER BY r.share, y.name) AS j
    FROM _annart y JOIN _anrar r ON r.nid = y.nid AND r.ak = y.ak
   WHERE y.nid IN (SELECT nid FROM _anme WHERE k = 1)
   GROUP BY y.nid;

  DROP TABLE IF EXISTS _anpp;
  CREATE TEMP TABLE _anpp ON COMMIT DROP AS
  SELECT x.em, x.nights,
         jsonb_build_object(
           'nid', f.nid, 'event_id', fn.event_id, 'title', fn.name, 'start_at', f.start_at, 'series', f.series,
           'deal', f.deal, 'tier_rank', f.tier_rank, 'tier_count', f.tier_count,
           'lead_days', CASE WHEN f.has_sale AND f.lead_h IS NOT NULL THEN round((f.lead_h / 24)::numeric, 1) END,
           'since_launch_h', CASE WHEN f.since_launch_h IS NOT NULL THEN round(f.since_launch_h::numeric, 1) END,
           'src', f.src, 'medium', f.medium, 'order_size', f.order_size, 'multi_holder', f.multi_holder,
           'with_returning', f.with_returning, 'invitation', f.invited_only, 'table', f.tbl, 'door', f.door,
           'dist_km', p.dist_first, 'artists', COALESCE(fa.j, '[]'::jsonb)) AS first_facts,
         jsonb_build_object(
           'artists', COALESCE(x.art_j, '[]'::jsonb),
           'genres', COALESCE(x.gen_j, '[]'::jsonb),
           'genre_nights', x.gen_n,
           'traits', COALESCE(x.trait_j, '{}'::jsonb),
           'series', COALESCE(x.ser_j, '[]'::jsonb),
           'buy', CASE WHEN x.b_n IS NOT NULL THEN jsonb_build_object(
                     'n', x.b_n, 'early', x.b_early, 'launch_known', x.b_lk, 'launch', x.b_launch,
                     'last_minute', x.b_last, 'door', x.b_door, 'group', x.b_grp, 'table', x.b_tbl) END,
           'country', p.country, 'main_country', p.main_country, 'cp_known', p.cp IS NOT NULL) AS agg,
         p.dist_first AS dist_km, p.passing,
         -- Clés de filtre (_crm_filter_sql) : artistes, genres, formats, séries,
         -- profil d'achat dominant, à plusieurs, canal d'arrivée, distance.
         ARRAY(
           SELECT DISTINCT tg FROM unnest(
             COALESCE(x.art_t, '{}') || COALESCE(x.gen_t, '{}') || COALESCE(x.fmt_t, '{}') || COALESCE(x.ser_t, '{}')
             || ARRAY[
                  CASE WHEN x.b_n > 0 AND x.b_early * 2 >= x.b_n AND x.b_early > 0 THEN 'b:early' END,
                  CASE WHEN x.b_lk > 0 AND x.b_launch * 2 >= x.b_lk AND x.b_launch > 0 THEN 'b:launch' END,
                  CASE WHEN x.b_n > 0 AND x.b_last * 2 >= x.b_n AND x.b_last > 0 THEN 'b:last_minute' END,
                  CASE WHEN x.b_n > 0 AND x.b_door * 2 >= x.b_n AND x.b_door > 0 THEN 'b:door' END,
                  CASE WHEN x.b_n > 0 AND x.b_grp * 2 >= x.b_n AND x.b_grp > 0 THEN 'grp:group'
                       WHEN x.b_n > 0 THEN 'grp:solo' END,
                  CASE WHEN f.with_returning THEN 'grp:brought' END,
                  CASE WHEN f.invited_only THEN 'ch:gl' WHEN f.src IS NOT NULL THEN 'ch:' || f.src END,
                  CASE WHEN p.passing THEN 'pass'
                       WHEN p.passing IS FALSE AND p.dist_first IS NOT NULL THEN 'loc' END]
           ) tg WHERE tg IS NOT NULL ORDER BY 1) AS tags,
         '[]'::jsonb AS hyps
    FROM _anpx x
    JOIN _anme f ON f.em = x.em AND f.k = 1
    JOIN _ann fn ON fn.nid = f.nid
    LEFT JOIN _anfa fa ON fa.nid = f.nid
    LEFT JOIN _anp p ON p.em = x.em;
  CREATE INDEX ON _anpp (em);

  -- Lot C : hypothèses de chaque personne (force + preuve), et clés `h:`.
  PERFORM public._crm_an_fill_hyps(p_venue_id, p_organizer_user_id, p_cfg);

  DELETE FROM public.crm_person_profile pp USING _antg g WHERE pp.scope_key = v_key AND pp.email = g.em;
  INSERT INTO public.crm_person_profile (scope_key, venue_id, organizer_user_id, email, nights, first_facts, agg,
                                         hyps, tags, dist_km, passing, rules_version, computed_at)
  SELECT v_key, p_venue_id, p_organizer_user_id, x.em, x.nights, x.first_facts, x.agg, x.hyps, x.tags,
         x.dist_km, x.passing, (p_cfg->>'rules_version')::int, now()
    FROM _anpp x;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_an_write_people(text, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_an_write_people(text, uuid, timestamptz, jsonb) TO service_role;

-- Points d'accroche du lot C (moteur d'hypothèses). Sans lui : aucune
-- hypothèse, aucun statut.
CREATE OR REPLACE FUNCTION public._crm_an_fill_hyps(p_venue_id text, p_organizer_user_id uuid, p_cfg jsonb)
RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
CREATE OR REPLACE FUNCTION public._crm_an_engine(p_venue_id text, p_organizer_user_id uuid, p_at timestamptz, p_cfg jsonb, p_full boolean)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
REVOKE ALL ON FUNCTION public._crm_an_fill_hyps(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._crm_an_engine(text, uuid, timestamptz, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_an_fill_hyps(text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._crm_an_engine(text, uuid, timestamptz, jsonb, boolean) TO service_role;

-- ── 6. Calcul d'une portée ──────────────────────────────────────────────────
-- p_full = true : toute la portée + statuts des familles (lot C) + historique.
-- p_full = false : les e-mails marqués (au plus p_max), soirées et artistes.
CREATE OR REPLACE FUNCTION public.crm_analysis_compute(p_venue_id text, p_organizer_user_id uuid,
                                                       p_full boolean DEFAULT false, p_max integer DEFAULT 3000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cfg jsonb := public.crm_analysis_config();
  v_t0 timestamptz := clock_timestamp();
  v_people integer;
  v_nights integer;
  v_targets integer;
  v_engine jsonb;
  v_cov jsonb;
BEGIN
  -- session_user, jamais current_user (toujours le propriétaire en DEFINER).
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'crm_analysis_compute: service only' USING ERRCODE = '42501';
  END IF;
  IF v_key IS NULL OR (p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.crm_analysis_state (scope_key, venue_id, organizer_user_id)
  VALUES (v_key, p_venue_id, p_organizer_user_id) ON CONFLICT (scope_key) DO NOTHING;

  v_cov := public._crm_signal_coverage(p_venue_id, p_organizer_user_id);
  DROP TABLE IF EXISTS _ancov;
  CREATE TEMP TABLE _ancov ON COMMIT DROP AS SELECT v_cov AS cov;
  v_people := public._crm_an_load(p_venue_id, p_organizer_user_id, now(), v_cfg);

  DROP TABLE IF EXISTS _antg;
  IF p_full THEN
    CREATE TEMP TABLE _antg ON COMMIT DROP AS SELECT DISTINCT em FROM _ana;
  ELSE
    CREATE TEMP TABLE _antg ON COMMIT DROP AS
    SELECT DISTINCT d.email AS em FROM (
      SELECT email FROM public.crm_analysis_dirty WHERE scope_key = v_key ORDER BY marked_at LIMIT GREATEST(1, p_max)) d;
  END IF;
  SELECT count(*) INTO v_targets FROM _antg;

  -- Le moteur d'hypothèses (lot C) calcule les statuts des familles avant les
  -- personnes : une passe complète seulement (le test au hasard est le plus
  -- coûteux).
  v_engine := public._crm_an_engine(p_venue_id, p_organizer_user_id, now(), v_cfg, p_full);
  v_nights := public._crm_an_write_nights(p_venue_id, p_organizer_user_id, now(), v_cfg);
  PERFORM public._crm_an_write_people(p_venue_id, p_organizer_user_id, now(), v_cfg);

  IF p_full THEN
    -- Trajectoire du compte : délai entre la 1re et la 2e venue (quand
    -- relancer), retour à 180 jours des nouveaux venus assez anciens.
    UPDATE public.crm_analysis_state s SET stats = (
      WITH r AS (
        SELECT extract(epoch FROM b.start_at - a.start_at) / 86400.0 AS d
          FROM _ana a JOIN _ana b ON b.em = a.em AND b.k = 2 WHERE a.k = 1
      ), w AS (
        SELECT count(*) FILTER (WHERE eligible) AS n, count(*) FILTER (WHERE eligible AND returned) AS ret FROM _annew
      ), o AS (
        SELECT count(*) AS people, count(*) FILTER (WHERE mk = 1) AS once
          FROM (SELECT em, max(k) AS mk FROM _ana GROUP BY em) z
      )
      SELECT jsonb_build_object(
               'people', o.people, 'once', o.once,
               'returners', (SELECT count(*) FROM r),
               'median_days', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY d)::numeric) FROM r),
               'p25_days', (SELECT round(percentile_cont(0.25) WITHIN GROUP (ORDER BY d)::numeric) FROM r),
               'p75_days', (SELECT round(percentile_cont(0.75) WITHIN GROUP (ORDER BY d)::numeric) FROM r),
               'eligible', w.n, 'returned', w.ret)
        FROM w, o)
     WHERE s.scope_key = v_key;

    -- Une personne qui n'a plus de venue (billets remboursés, adresse effacée)
    -- perd son profil.
    DELETE FROM public.crm_person_profile pp
     WHERE pp.scope_key = v_key AND NOT EXISTS (SELECT 1 FROM _antg g WHERE g.em = pp.email);
    DELETE FROM public.crm_analysis_dirty WHERE scope_key = v_key;
  ELSE
    DELETE FROM public.crm_analysis_dirty d USING _antg g WHERE d.scope_key = v_key AND d.email = g.em;
  END IF;

  UPDATE public.crm_analysis_state s SET
    computed_at = now(),
    full_at = CASE WHEN p_full THEN now() ELSE s.full_at END,
    dirty_at = CASE WHEN EXISTS (SELECT 1 FROM public.crm_analysis_dirty d WHERE d.scope_key = v_key) THEN s.dirty_at END,
    rules_version = (v_cfg->>'rules_version')::int,
    coverage = v_cov,
    duration_ms = (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int,
    people = (SELECT count(*) FROM public.crm_person_profile pp WHERE pp.scope_key = v_key),
    last_error = NULL
   WHERE s.scope_key = v_key;

  RETURN jsonb_build_object('scope', v_key, 'full', p_full, 'people', v_people, 'targets', v_targets,
                            'nights', v_nights, 'engine', v_engine,
                            'ms', (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::int);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_analysis_compute(text, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_analysis_compute(text, uuid, boolean, integer) TO service_role;

-- ── 7. Rafraîchissement (crons) ─────────────────────────────────────────────
-- Les portées marquées, une à la fois, tant que le budget de temps tient
-- (modèle : moteur d'e-mails, 4 s par passe). Une portée jamais calculée en
-- entier passe d'abord par un calcul complet.
CREATE OR REPLACE FUNCTION public.crm_analysis_refresh(p_budget_ms integer DEFAULT 4000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  s record;
  v_done integer := 0;
  v_out jsonb := '[]'::jsonb;
  v_r jsonb;
BEGIN
  LOOP
    EXIT WHEN extract(epoch FROM clock_timestamp() - v_t0) * 1000 > p_budget_ms;
    SELECT st.* INTO s FROM public.crm_analysis_state st
     WHERE st.dirty_at IS NOT NULL
       AND (st.computed_at IS NULL OR st.computed_at < now() - interval '1 minute')
     ORDER BY st.full_at NULLS FIRST, st.dirty_at
     LIMIT 1 FOR UPDATE SKIP LOCKED;
    EXIT WHEN NOT FOUND;
    BEGIN
      v_r := public.crm_analysis_compute(s.venue_id, s.organizer_user_id, s.full_at IS NULL, 3000);
      v_out := v_out || jsonb_build_array(v_r);
    EXCEPTION WHEN others THEN
      UPDATE public.crm_analysis_state SET last_error = left(SQLERRM, 500), last_error_at = now(),
             computed_at = now() WHERE scope_key = s.scope_key;
      v_out := v_out || jsonb_build_array(jsonb_build_object('scope', s.scope_key, 'error', SQLSTATE));
    END;
    v_done := v_done + 1;
  END LOOP;
  RETURN jsonb_build_object('scopes', v_done, 'runs', v_out);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_analysis_refresh(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_analysis_refresh(integer) TO service_role;

-- La nuit : UNE portée entière par passage, la plus anciennement recalculée.
CREATE OR REPLACE FUNCTION public.crm_analysis_nightly()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s record;
  v_r jsonb;
BEGIN
  -- Toute portée qui a une billetterie active entre dans le registre.
  INSERT INTO public.crm_analysis_state (scope_key, venue_id, organizer_user_id, dirty_at)
  SELECT DISTINCT public.crm_scope_key(c.venue_id, c.organizer_user_id), c.venue_id, c.organizer_user_id, now()
    FROM public.ticketing_connections c
   WHERE c.status <> 'disconnected'
  ON CONFLICT (scope_key) DO NOTHING;

  SELECT st.* INTO s FROM public.crm_analysis_state st
   WHERE (st.full_at IS NULL OR st.full_at < date_trunc('day', now()))
     AND EXISTS (SELECT 1 FROM public.ticketing_connections c
                  WHERE c.status <> 'disconnected'
                    AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = st.scope_key)
   ORDER BY st.full_at NULLS FIRST
   LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('scopes', 0); END IF;
  BEGIN
    v_r := public.crm_analysis_compute(s.venue_id, s.organizer_user_id, true, 0);
  EXCEPTION WHEN others THEN
    UPDATE public.crm_analysis_state SET last_error = left(SQLERRM, 500), last_error_at = now(),
           full_at = now() WHERE scope_key = s.scope_key;
    PERFORM public.emit_admin_notification(
      'admin_crm_analysis_failed', 'Analyse client CRM en échec', SQLERRM, 'normal',
      'crm_scope', s.scope_key, jsonb_build_object('sqlstate', SQLSTATE),
      'crm_analysis_failed:' || s.scope_key || ':' || to_char(now(), 'YYYY-MM-DD'), NULL);
    RETURN jsonb_build_object('scope', s.scope_key, 'error', SQLSTATE);
  END;
  RETURN v_r;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_analysis_nightly() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_analysis_nightly() TO service_role;

-- ── 8. Marquage après chaque synchro ────────────────────────────────────────
-- Appelé par ticketing_after_sync (jamais bloquant) : la mémoire des annonces
-- de line-up et les e-mails des billets synchronisés depuis la dernière fois.
CREATE OR REPLACE FUNCTION public._crm_analysis_mark_sync(p_connection_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c public.ticketing_connections%ROWTYPE;
  v_key text;
  v_since timestamptz;
  v_max timestamptz;
  v_seen integer;
  v_marked integer;
BEGIN
  SELECT * INTO c FROM public.ticketing_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_key := public.crm_scope_key(c.venue_id, c.organizer_user_id);

  -- Un artiste vu pour la première fois sur une soirée : sa date d'annonce
  -- est connue (à la fréquence de la synchro près) dès que l'import initial
  -- est fini ; avant, la publication de la soirée sert de borne.
  INSERT INTO public.crm_artist_seen (connection_id, external_event_id, artist_key, first_seen_at, announce_known)
  SELECT e.connection_id, e.external_id, public._crm_artist_key(a),
         CASE WHEN c.initial_import_done_at IS NOT NULL AND c.initial_import_done_at < now() - interval '5 minutes'
              THEN now() ELSE COALESCE(e.published_at, e.first_seen_at) END,
         c.initial_import_done_at IS NOT NULL AND c.initial_import_done_at < now() - interval '5 minutes'
    FROM public.external_events e
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.artists) = 'array' THEN e.artists ELSE '[]'::jsonb END) a
   WHERE e.connection_id = p_connection_id AND public._crm_artist_key(a) IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_seen = ROW_COUNT;

  INSERT INTO public.crm_analysis_state (scope_key, venue_id, organizer_user_id)
  VALUES (v_key, c.venue_id, c.organizer_user_id) ON CONFLICT (scope_key) DO NOTHING;
  SELECT last_mark_at INTO v_since FROM public.crm_analysis_state WHERE scope_key = v_key FOR UPDATE;

  SELECT max(t.synced_at) INTO v_max FROM public.external_tickets t
   WHERE t.connection_id = p_connection_id AND t.synced_at > COALESCE(v_since, '-infinity'::timestamptz);
  IF v_max IS NULL THEN
    RETURN jsonb_build_object('artists_seen', v_seen, 'marked', 0);
  END IF;

  INSERT INTO public.crm_analysis_dirty (scope_key, email)
  SELECT DISTINCT v_key, lower(t.buyer_email)
    FROM public.external_tickets t
   WHERE t.connection_id = p_connection_id AND t.buyer_email IS NOT NULL
     AND t.synced_at > COALESCE(v_since, '-infinity'::timestamptz)
     AND NOT EXISTS (SELECT 1 FROM public.crm_profile_optouts o WHERE o.scope_key = v_key AND o.email = lower(t.buyer_email))
  ON CONFLICT (scope_key, email) DO UPDATE SET marked_at = now();
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  UPDATE public.crm_analysis_state SET last_mark_at = v_max,
         dirty_at = CASE WHEN v_marked > 0 THEN COALESCE(dirty_at, now()) ELSE dirty_at END
   WHERE scope_key = v_key;
  RETURN jsonb_build_object('artists_seen', v_seen, 'marked', v_marked);
END;
$$;
REVOKE ALL ON FUNCTION public._crm_analysis_mark_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_analysis_mark_sync(uuid) TO service_role;

-- ── 9. Purge ────────────────────────────────────────────────────────────────
-- Avec la connexion : supprimée (ticketing_purge) ou déconnectée. Les profils
-- de la portée partent dès qu'il ne lui reste aucune billetterie active.
CREATE OR REPLACE FUNCTION public._crm_analysis_purge_scope(p_scope_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.crm_person_profile WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_night_profile WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_artist_stats WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_analysis_state WHERE scope_key = p_scope_key;  -- et crm_analysis_dirty (cascade)
END;
$$;
REVOKE ALL ON FUNCTION public._crm_analysis_purge_scope(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_analysis_purge_scope(text) TO service_role;

CREATE OR REPLACE FUNCTION public._crm_analysis_on_connection_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := public.crm_scope_key(OLD.venue_id, OLD.organizer_user_id);
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (NEW.status = 'disconnected' AND OLD.status IS DISTINCT FROM 'disconnected') THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticketing_connections c
                  WHERE c.id <> OLD.id AND c.status <> 'disconnected'
                    AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = v_key) THEN
    PERFORM public._crm_analysis_purge_scope(v_key);
  END IF;
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN others THEN
  -- Une purge d'analyse ne doit jamais empêcher la déconnexion elle-même.
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public._crm_analysis_on_connection_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_crm_analysis_connection_purge ON public.ticketing_connections;
CREATE TRIGGER trg_crm_analysis_connection_purge
  AFTER UPDATE OF status OR DELETE ON public.ticketing_connections
  FOR EACH ROW EXECUTE FUNCTION public._crm_analysis_on_connection_change();

-- ── 10. Droit d'opposition : exclure un contact du profilage ────────────────
-- Écriture (éditeur et plus), jamais en accès assisté. Le profil est effacé
-- et ne sera jamais recalculé ; `p_on = false` lève l'exclusion (le profil
-- revient au prochain calcul).
CREATE OR REPLACE FUNCTION public.crm_profile_optout(p_venue_id text, p_organizer_user_id uuid, p_email text, p_on boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_em text := lower(btrim(COALESCE(p_email, '')));
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(public.is_support_session(), false) THEN
    RAISE EXCEPTION 'support_session_forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_em !~ '@' THEN RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023'; END IF;
  IF COALESCE(p_on, true) THEN
    INSERT INTO public.crm_profile_optouts (scope_key, email, created_by) VALUES (v_key, v_em, auth.uid())
    ON CONFLICT (scope_key, email) DO NOTHING;
    DELETE FROM public.crm_person_profile WHERE scope_key = v_key AND email = v_em;
    DELETE FROM public.crm_analysis_dirty WHERE scope_key = v_key AND email = v_em;
  ELSE
    DELETE FROM public.crm_profile_optouts WHERE scope_key = v_key AND email = v_em;
    IF EXISTS (SELECT 1 FROM public.crm_analysis_state WHERE scope_key = v_key) THEN
      INSERT INTO public.crm_analysis_dirty (scope_key, email) VALUES (v_key, v_em) ON CONFLICT DO NOTHING;
      UPDATE public.crm_analysis_state SET dirty_at = COALESCE(dirty_at, now()) WHERE scope_key = v_key;
    END IF;
  END IF;
  RETURN jsonb_build_object('email', v_em, 'excluded', COALESCE(p_on, true));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_profile_optout(text, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_profile_optout(text, uuid, text, boolean) TO authenticated, service_role;

-- ── 11. Crons ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('crm-analysis-refresh') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-analysis-refresh');
  PERFORM cron.schedule('crm-analysis-refresh', '7,37 * * * *', 'SELECT public.crm_analysis_refresh(4000)');
  PERFORM cron.unschedule('crm-analysis-nightly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-analysis-nightly');
  -- Une portée par passage, de 2 h à 4 h 30 UTC (six portées par nuit).
  PERFORM cron.schedule('crm-analysis-nightly', '19,49 2-4 * * *', 'SELECT public.crm_analysis_nightly()');
END $$;

-- ── 12. La synchro marque ce qui a changé ───────────────────────────────────
-- Corps de 20261009172000, plus le marquage (3e).
CREATE OR REPLACE FUNCTION public.ticketing_after_sync(p_connection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.ticketing_connections%ROWTYPE;
  x RECORD;
  v_event uuid;
  v_end timestamptz;
  v_created integer := 0;
  v_updated integer := 0;
  v_linked integer := 0;
  v_consent integer := 0;
  v_withdrawn integer := 0;
  v_n integer;
  v_an jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ticketing_after_sync: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.ticketing_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'unknown_connection'); END IF;

  -- 3a. Soirées miroir (création ou mise à jour de ce qui a changé).
  FOR x IN
    SELECT ee.*, ev.id AS mirror_id
      FROM public.external_events ee
      LEFT JOIN public.events ev ON ev.id = ee.event_id
     WHERE ee.connection_id = p_connection_id
       AND ee.start_at IS NOT NULL
  LOOP
    v_end := CASE WHEN x.end_at IS NOT NULL AND x.end_at > x.start_at THEN x.end_at
                  ELSE x.start_at + interval '6 hours' END;
    IF x.mirror_id IS NULL THEN
      INSERT INTO public.events (
        venue_id, organizer_user_id, title, start_at, end_at, description, image_url, poster_url,
        music_genres, music_genre, location_address, location_city, timezone, published_at,
        status, cancelled_at, tickets_sold_out, event_kind, external_source, external_ticket_url,
        is_active, visibility, ticketing_enabled, tables_enabled
      ) VALUES (
        c.venue_id, c.organizer_user_id, COALESCE(NULLIF(btrim(x.name), ''), 'Soirée'), x.start_at, v_end,
        x.description, x.cover_url, x.cover_url,
        x.genres, COALESCE(x.genres[1], 'Open Format'), x.street, x.city, x.timezone, x.published_at,
        CASE WHEN x.cancelled_at IS NOT NULL THEN 'cancelled' ELSE 'active' END, x.cancelled_at,
        COALESCE(x.left_tickets = 0, false),
        (CASE WHEN c.venue_id IS NOT NULL THEN 'club_event' ELSE 'organizer_event' END)::public.event_kind,
        x.provider, x.url, false, 'private', false, false
      ) RETURNING id INTO v_event;
      UPDATE public.external_events SET event_id = v_event WHERE id = x.id;
      -- Line-up : artistes sans compte Yuno, posés une fois (modèle invité).
      INSERT INTO public.event_guest_artists (event_id, name, photo_url, position)
      SELECT v_event, left(a->>'name', 120), NULLIF(a->>'avatar', ''), (ord - 1)::integer
        FROM jsonb_array_elements(COALESCE(x.artists, '[]'::jsonb)) WITH ORDINALITY AS t(a, ord)
       WHERE NULLIF(btrim(a->>'name'), '') IS NOT NULL
       LIMIT 40;
      v_created := v_created + 1;
    ELSE
      UPDATE public.events e SET
        title = COALESCE(NULLIF(btrim(x.name), ''), e.title),
        start_at = x.start_at,
        end_at = v_end,
        description = COALESCE(x.description, e.description),
        image_url = COALESCE(x.cover_url, e.image_url),
        poster_url = COALESCE(x.cover_url, e.poster_url),
        music_genres = CASE WHEN cardinality(x.genres) > 0 THEN x.genres ELSE e.music_genres END,
        location_address = COALESCE(x.street, e.location_address),
        location_city = COALESCE(x.city, e.location_city),
        timezone = COALESCE(x.timezone, e.timezone),
        published_at = COALESCE(x.published_at, e.published_at),
        status = CASE WHEN x.cancelled_at IS NOT NULL THEN 'cancelled' ELSE 'active' END,
        cancelled_at = x.cancelled_at,
        tickets_sold_out = COALESCE(x.left_tickets = 0, false),
        external_ticket_url = COALESCE(x.url, e.external_ticket_url)
      WHERE e.id = x.mirror_id
        AND (e.title IS DISTINCT FROM COALESCE(NULLIF(btrim(x.name), ''), e.title)
          OR e.start_at IS DISTINCT FROM x.start_at OR e.end_at IS DISTINCT FROM v_end
          OR e.cancelled_at IS DISTINCT FROM x.cancelled_at
          OR e.tickets_sold_out IS DISTINCT FROM COALESCE(x.left_tickets = 0, false)
          OR e.published_at IS DISTINCT FROM COALESCE(x.published_at, e.published_at)
          OR e.image_url IS DISTINCT FROM COALESCE(x.cover_url, e.image_url)
          OR e.external_ticket_url IS DISTINCT FROM COALESCE(x.url, e.external_ticket_url));
          -- Les genres ne déclenchent pas de mise à jour : trg_canonical_genres
          -- les réécrit au vocabulaire Yuno, ils ne seraient jamais « égaux ».
          -- Ils suivent quand un autre champ change.
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_updated := v_updated + v_n;
    END IF;
  END LOOP;

  -- 3b. Billets → soirée miroir.
  UPDATE public.external_tickets t
     SET event_id = ee.event_id
    FROM public.external_events ee
   WHERE t.connection_id = p_connection_id
     AND ee.connection_id = p_connection_id
     AND ee.external_id = t.external_event_id
     AND ee.event_id IS NOT NULL
     AND t.event_id IS DISTINCT FROM ee.event_id;
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  -- 3c. Accord newsletter rapporté par la billetterie → registre de la portée.
  --     Jamais un désabonné (la ligne existe : on n'y touche pas), jamais une
  --     adresse purgée (email_opt_outs) ni supprimée (bounce, plainte), jamais
  --     un acheteur dont le DERNIER signal chez la billetterie est un retrait.
  IF c.venue_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions
      (venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    SELECT DISTINCT ON (lower(t.buyer_email))
           c.venue_id, lower(t.buyer_email), true, 'connector:' || c.provider, 'ticketing',
           COALESCE(t.purchased_at, t.first_seen_at), t.buyer_first_name, t.buyer_last_name
      FROM public.external_tickets t
     WHERE t.connection_id = p_connection_id
       AND t.newsletter_optin IS TRUE
       AND t.buyer_email IS NOT NULL
       AND t.status IN ('valid', 'transferred')
       AND NOT public.is_email_suppressed(t.buyer_email)
       AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                        WHERE o.venue_id = c.venue_id AND lower(o.email) = lower(t.buyer_email))
       AND NOT EXISTS (
         SELECT 1 FROM (
           SELECT t2.newsletter_optin FROM public.external_tickets t2
            WHERE t2.connection_id = p_connection_id AND lower(t2.buyer_email) = lower(t.buyer_email)
              AND t2.newsletter_optin IS NOT NULL
            ORDER BY COALESCE(t2.source_updated_at, t2.purchased_at, t2.first_seen_at) DESC NULLS LAST
            LIMIT 1) z
          WHERE z.newsletter_optin IS FALSE)
     ORDER BY lower(t.buyer_email), t.purchased_at DESC NULLS LAST
    ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_consent = ROW_COUNT;
  ELSIF c.organizer_user_id IS NOT NULL THEN
    INSERT INTO public.newsletter_subscriptions
      (organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    SELECT DISTINCT ON (lower(t.buyer_email))
           c.organizer_user_id, lower(t.buyer_email), true, 'connector:' || c.provider, 'ticketing',
           COALESCE(t.purchased_at, t.first_seen_at), t.buyer_first_name, t.buyer_last_name
      FROM public.external_tickets t
     WHERE t.connection_id = p_connection_id
       AND t.newsletter_optin IS TRUE
       AND t.buyer_email IS NOT NULL
       AND t.status IN ('valid', 'transferred')
       AND NOT public.is_email_suppressed(t.buyer_email)
       AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                        WHERE o.organizer_user_id = c.organizer_user_id AND lower(o.email) = lower(t.buyer_email))
       AND NOT EXISTS (
         SELECT 1 FROM (
           SELECT t2.newsletter_optin FROM public.external_tickets t2
            WHERE t2.connection_id = p_connection_id AND lower(t2.buyer_email) = lower(t.buyer_email)
              AND t2.newsletter_optin IS NOT NULL
            ORDER BY COALESCE(t2.source_updated_at, t2.purchased_at, t2.first_seen_at) DESC NULLS LAST
            LIMIT 1) z
          WHERE z.newsletter_optin IS FALSE)
     ORDER BY lower(t.buyer_email), t.purchased_at DESC NULLS LAST
    ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_consent = ROW_COUNT;
  END IF;

  -- 3d. Désinscription rapportée par la billetterie : l'accord qu'ELLE avait
  --     donné (source connector:%) est retiré quand son DERNIER signal pour
  --     cette personne est un retrait postérieur à l'accord. Tracé.
  WITH g AS (
    SELECT DISTINCT ON (lower(t.buyer_email))
           lower(t.buyer_email) AS em, t.newsletter_optin AS opt,
           COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) AS at
      FROM public.external_tickets t
     WHERE t.connection_id = p_connection_id
       AND t.buyer_email IS NOT NULL
       AND t.newsletter_optin IS NOT NULL
     ORDER BY lower(t.buyer_email), COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) DESC NULLS LAST
  ),
  off AS (
    UPDATE public.newsletter_subscriptions s
       SET opted_in = false, opted_out_at = now()
      FROM g
     WHERE g.opt IS FALSE
       AND lower(s.email) = g.em
       AND ((c.venue_id IS NOT NULL AND s.venue_id = c.venue_id)
         OR (c.venue_id IS NULL AND c.organizer_user_id IS NOT NULL AND s.organizer_user_id = c.organizer_user_id))
       AND s.opted_in AND s.opted_out_at IS NULL
       AND COALESCE(s.source, '') LIKE 'connector:%'
       AND (s.consent_recorded_at IS NULL OR g.at IS NULL OR g.at > s.consent_recorded_at)
    RETURNING s.email, s.user_id
  ),
  logged AS (
    INSERT INTO public.marketing_consent_events
      (user_id, email, channel, venue_id, organizer_user_id, action, wording_key, wording_text, source)
    SELECT o.user_id, lower(o.email), 'email', c.venue_id, CASE WHEN c.venue_id IS NULL THEN c.organizer_user_id END,
           'withdrawn', 'connector_newsletter_optout',
           'Désinscription de la newsletter rapportée par la billetterie (' || c.provider || ')',
           'connector:' || c.provider
      FROM off o
    RETURNING 1
  )
  SELECT count(*) INTO v_withdrawn FROM logged;

  -- 3e. Analyse client (20261010110000) : mémoire des annonces de line-up et
  --     e-mails à recalculer. Jamais bloquant pour la synchro.
  BEGIN
    v_an := public._crm_analysis_mark_sync(p_connection_id);
  EXCEPTION WHEN others THEN
    v_an := jsonb_build_object('error', SQLSTATE);
  END;

  RETURN jsonb_build_object('events_created', v_created, 'events_updated', v_updated,
                            'tickets_linked', v_linked, 'consents_added', v_consent,
                            'consents_withdrawn', v_withdrawn, 'analysis', v_an);
END;
$function$;

-- ── 13. Effacer un contact efface son profil ─────────────────────────────────
-- Corps de 20261004235500, plus le profil d'analyse.
CREATE OR REPLACE FUNCTION public._crm_erase_contacts(p_venue_id text, p_organizer_user_id uuid, p_emails text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emails text[];
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(e))), '{}') INTO v_emails
    FROM unnest(p_emails) e WHERE e IS NOT NULL AND btrim(e) <> '';
  IF cardinality(v_emails) = 0 THEN RETURN 0; END IF;

  DELETE FROM public.crm_contact_notes WHERE scope_key = v_key AND lower(email) = ANY (v_emails);

  -- Analyse client (20261010110000) : profil et file de recalcul. L'exclusion
  -- du profilage (crm_profile_optouts), mémoire d'un refus, reste.
  DELETE FROM public.crm_person_profile WHERE scope_key = v_key AND email = ANY (v_emails);
  DELETE FROM public.crm_analysis_dirty WHERE scope_key = v_key AND email = ANY (v_emails);

  DELETE FROM public.crm_import_journal j
   USING public.crm_imports i
   WHERE i.list_import_id = j.list_import_id AND i.scope_key = v_key AND lower(j.email) = ANY (v_emails);

  DELETE FROM public.imported_contacts c
   WHERE ((p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
     AND lower(c.email) = ANY (v_emails);

  -- Un désabonnement reste : c'est la mémoire du refus.
  DELETE FROM public.newsletter_subscriptions ns
   WHERE ((p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id))
     AND lower(ns.email) = ANY (v_emails)
     AND ns.opted_in;

  DELETE FROM public.venue_sms_contacts vc
   WHERE ((p_venue_id IS NOT NULL AND vc.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND vc.organizer_user_id = p_organizer_user_id))
     AND lower(vc.email) = ANY (v_emails)
     AND NOT vc.unsubscribed;

  -- Les ventes de la billetterie connectée gardent leur montant, sans identité.
  UPDATE public.external_tickets t
     SET buyer_email = NULL, buyer_first_name = NULL, buyer_last_name = NULL, buyer_phone = NULL,
         buyer_ref = NULL, holder_email = NULL, holder_first_name = NULL, holder_last_name = NULL,
         raw = '{}'::jsonb
   WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     AND lower(t.buyer_email) = ANY (v_emails);

  DELETE FROM public.contact_engagement ce
   WHERE ((p_venue_id IS NOT NULL AND ce.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ce.organizer_user_id = p_organizer_user_id))
     AND lower(ce.email) = ANY (v_emails);

  -- Les envois passés restent comptés, sous une adresse qui ne désigne plus personne.
  UPDATE public.email_campaign_recipients r
     SET email = 'erased-' || md5(lower(r.email)) || '@erased.invalid',
         first_name = NULL, last_name = NULL, user_id = NULL
    FROM public.email_campaigns c
   WHERE c.id = r.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND r.status NOT IN ('pending', 'sending')
     AND lower(r.email) = ANY (v_emails);

  UPDATE public.email_campaign_events ev
     SET recipient_email = 'erased-' || md5(lower(ev.recipient_email)) || '@erased.invalid',
         metadata = ((COALESCE(ev.metadata, '{}'::jsonb) - 'to' - 'headers')
                     #- '{open,ipAddress}' #- '{open,userAgent}'
                     #- '{click,ipAddress}' #- '{click,userAgent}')
    FROM public.email_campaigns c
   WHERE c.id = ev.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     AND lower(ev.recipient_email) = ANY (v_emails);

  DELETE FROM public.contact_base_cache cb
   WHERE cb.scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id)
     AND lower(cb.email) = ANY (v_emails);
  UPDATE public.contact_base_cache_state
     SET dirty_at = now()
   WHERE scope_key = public.contact_base_scope_key(p_venue_id, p_organizer_user_id);

  RETURN cardinality(v_emails);
END;
$$;

-- ── 14. Registre des personnes : une jointure de plus ───────────────────────
-- Corps de 20261008210000. Deux changements : `first_utm` ne lit que le 1er
-- billet VENDU (par date d'achat), et `_cp` porte les clés de filtre de
-- l'analyse (an_tags, an_dist_km), lues dans crm_person_profile.
CREATE OR REPLACE FUNCTION public._crm_people_build(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_at timestamptz := COALESCE(p_at, now());
  v_rules record;
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_tonight uuid;
  v_n integer;
BEGIN
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _cpt;
  CREATE TEMP TABLE _cpt ON COMMIT DROP AS
    SELECT * FROM public._crm_tickets(p_venue_id, p_organizer_user_id) x
     WHERE x.bought_at <= v_at;

  -- Guest list (invitations + billets à 0 €), migration 20261008100000.
  DROP TABLE IF EXISTS _cpg;
  CREATE TEMP TABLE _cpg ON COMMIT DROP AS
    SELECT lower(t.buyer_email) AS email, t.event_id, e.start_at AS event_start,
           COALESCE(e.end_at, e.start_at + interval '6 hours') AS event_end,
           public._crm_ticket_gl_kind(t.status, t.price, t.raw) AS kind,
           t.scanned_at, COALESCE(t.purchased_at, t.first_seen_at) AS at,
           NULLIF(btrim(t.deal_name), '') AS deal
      FROM public.external_tickets t
      LEFT JOIN public.events e ON e.id = t.event_id
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND t.buyer_email IS NOT NULL
       AND public._crm_ticket_gl_kind(t.status, t.price, t.raw) IS NOT NULL
       AND COALESCE(t.purchased_at, t.first_seen_at) <= v_at;

  -- « Ce soir » : la prochaine soirée si elle a lieu aujourd'hui (ou est en cours).
  SELECT e.id INTO v_tonight
    FROM public.events e
   WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
     AND e.external_source IS NOT NULL
     AND COALESCE(e.end_at, e.start_at + interval '8 hours') > v_at
     AND (e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
         <= (v_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
   ORDER BY e.start_at LIMIT 1;

  DROP TABLE IF EXISTS _cp;
  CREATE TEMP TABLE _cp ON COMMIT DROP AS
  WITH att AS (
    -- Une soirée faite = un billet acheté (même à 0 €), ou une invitation
    -- scannée à la porte.
    SELECT t.email, t.event_id, t.event_start FROM _cpt t WHERE t.email IS NOT NULL
    UNION ALL
    SELECT g.email, g.event_id, g.event_start FROM _cpg g
     WHERE g.kind = 'inv' AND g.scanned_at IS NOT NULL AND g.event_id IS NOT NULL
  ), agg AS (
    SELECT a.email,
           count(DISTINCT a.event_id) FILTER (WHERE a.event_start <= v_at) AS nights,
           count(DISTINCT a.event_id) FILTER (WHERE a.event_start <= v_at
                 AND a.event_start > v_at - make_interval(months => v_rules.regular_window_months)) AS nights_win,
           min(a.event_start) FILTER (WHERE a.event_start <= v_at) AS first_night,
           max(a.event_start) FILTER (WHERE a.event_start <= v_at) AS last_night
      FROM att a
     GROUP BY a.email
  ), buy AS (
    SELECT t.email,
           COALESCE(sum(t.amount), 0) AS spent,
           array_agg(DISTINCT t.event_id) FILTER (WHERE t.event_id IS NOT NULL) AS events,
           bool_or(t.event_id = v_tonight) AS tonight,
           min(t.bought_at) AS first_buy,
           count(DISTINCT COALESCE(t.event_id::text, t.id::text)) FILTER (WHERE t.amount > 0) AS paid_n,
           min(t.bought_at) FILTER (WHERE t.amount > 0) AS first_paid,
           bool_or(t.event_start > v_at) AS upcoming
      FROM _cpt t
     WHERE t.email IS NOT NULL
     GROUP BY t.email
  ), cov AS (
    -- Soirées terminées dont la porte a scanné au moins la moitié des billets.
    SELECT t.event_id
      FROM public.external_tickets t
      JOIN public.events e ON e.id = t.event_id
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND t.status = 'valid'
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') <= v_at
     GROUP BY t.event_id
    HAVING count(*) FILTER (WHERE t.scanned_at IS NOT NULL) >= 0.5 * count(*)
  ), gl AS (
    SELECT g.email,
           count(DISTINCT g.event_id) AS gl_n,
           count(DISTINCT g.event_id) FILTER (WHERE g.scanned_at IS NOT NULL) AS gl_came,
           min(g.event_start) AS gl_first,
           array_agg(DISTINCT g.event_id) FILTER (WHERE g.event_id IS NOT NULL) AS gl_events,
           count(*) FILTER (WHERE g.scanned_at IS NULL AND g.event_id IN (SELECT cov.event_id FROM cov)) AS gl_noshow,
           bool_or(g.event_id = v_tonight) AS gl_tonight,
           bool_or(g.event_start > v_at) AS gl_upcoming
      FROM _cpg g
     GROUP BY g.email
  ), first_utm AS (
    -- Le 1er billet VENDU (ni invitation, ni remboursé, ni duplicata), par
    -- date d'achat (20261010110000).
    SELECT DISTINCT ON (lower(et.buyer_email)) lower(et.buyer_email) AS email,
           et.utm->>'utm_source' AS utm_source, et.utm->>'utm_medium' AS utm_medium
      FROM public.external_tickets et
     WHERE et.buyer_email IS NOT NULL
       AND public._crm_ticket_is_sale(et.status, et.raw)
       AND ((p_venue_id IS NOT NULL AND et.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND et.organizer_user_id = p_organizer_user_id))
     ORDER BY lower(et.buyer_email), COALESCE(et.purchased_at, et.first_seen_at), et.id
  ), prof AS (
    -- Profil rapporté par Shotgun (âge, genre, ville, pays) : la valeur connue
    -- la plus récente de chaque acheteur (catalogue de segments, 20261008200000).
    SELECT lower(t.buyer_email) AS email,
           (array_agg(t.age ORDER BY COALESCE(t.purchased_at, t.first_seen_at) DESC)
              FILTER (WHERE t.age BETWEEN 12 AND 110))[1] AS age,
           (array_agg(t.gender ORDER BY COALESCE(t.purchased_at, t.first_seen_at) DESC)
              FILTER (WHERE t.gender IN ('female', 'male', 'other')))[1] AS gender,
           (array_agg(upper(btrim(t.country_code)) ORDER BY COALESCE(t.purchased_at, t.first_seen_at) DESC)
              FILTER (WHERE btrim(t.country_code) ~* '^[a-z]{2}$'))[1] AS country,
           (array_agg(btrim(t.city) ORDER BY COALESCE(t.purchased_at, t.first_seen_at) DESC)
              FILTER (WHERE NULLIF(btrim(t.city), '') IS NOT NULL))[1] AS city
      FROM public.external_tickets t
     WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       AND t.buyer_email IS NOT NULL
       AND (t.age IS NOT NULL OR t.gender IS NOT NULL OR t.country_code IS NOT NULL OR t.city IS NOT NULL)
     GROUP BY 1
  ), page_first AS (
    -- Première inscription CONFIRMÉE par une page d'inscription de la portée.
    SELECT lower(e.email) AS email, min(e.created_at) AS at
      FROM public.crm_signup_entries e
      JOIN public.crm_signup_pages pg ON pg.id = e.page_id
     WHERE e.email IS NOT NULL AND e.confirmed_at IS NOT NULL AND e.created_at <= v_at
       AND pg.venue_id IS NOT DISTINCT FROM p_venue_id
       AND pg.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     GROUP BY 1
  ), fh AS (
    -- Historique d'un fichier importé (20261008210000).
    SELECT * FROM public._crm_file_history(p_venue_id, p_organizer_user_id, v_at)
  ), base AS (
    SELECT lower(c.email) AS email, c.first_name, c.last_name, c.phone_e164, c.email_ok, c.phone_ok,
           c.origin, COALESCE(c.added_at, c.created_at) AS added_at, c.eng_status, c.bounced,
           c.list_import_id,
           c.age AS f_age, c.gender AS f_gender, c.country_code AS f_country,
           NULLIF(btrim(c.city), '') AS f_city, NULLIF(btrim(c.zone), '') AS f_zone
      FROM _cr c
     WHERE c.email IS NOT NULL
       AND COALESCE(c.added_at, c.created_at, '-infinity'::timestamptz) <= v_at
  )
  SELECT b.email, b.first_name, b.last_name, b.phone_e164 AS phone, b.email_ok, b.phone_ok, b.origin,
         b.added_at, b.eng_status, COALESCE(b.bounced, false) AS bounced, b.list_import_id,
         -- Soirées, dépense, dates : billets Shotgun ET historique des fichiers (voir `h`).
         h.nights::int AS nights, COALESCE(a.nights_win, 0)::int AS nights_win,
         h.first_night, h.last_night, round(h.spent, 2) AS spent,
         COALESCE(y.events, '{}'::uuid[]) AS events, COALESCE(y.tonight, false) OR COALESCE(g.gl_tonight, false) AS tonight,
         CASE WHEN pf.at IS NOT NULL AND (y.first_buy IS NULL OR pf.at < y.first_buy) THEN 'page'
              WHEN COALESCE(a.nights, 0) > 0 AND lower(u.utm_source) LIKE 'yuno%' THEN 'utm'
              WHEN COALESCE(a.nights, 0) > 0 THEN 'shotgun'
              WHEN b.origin IN ('import', 'both') THEN 'import'
              ELSE 'other' END AS source,
         u.utm_source, u.utm_medium,
         CASE
           -- A acheté pour une soirée à venir sans en avoir encore fait : nouveau
           -- client, pas un « contact connu » (import, inscription).
           WHEN h.nights = 0 THEN CASE WHEN y.first_buy IS NOT NULL THEN 'nou' ELSE 'none' END
           -- A repris une place : il n'a pas décroché.
           WHEN h.last_night < v_at - make_interval(months => v_rules.lapse_months)
                AND NOT COALESCE(y.upcoming, false) THEN 'end'
           -- « Habitué » se prouve par des soirées DATÉES (billets) : un total de
           -- fichier ne dit pas combien tombent dans la fenêtre.
           WHEN a.nights_win >= v_rules.regular_min_nights THEN 'hab'
           WHEN h.first_night >= v_at - interval '90 days' THEN 'nou'
           ELSE 'occ' END AS lifecycle,
         n.tags, n.note,
         h.paid_n::int AS paid_n,
         COALESCE(g.gl_n, 0)::int AS gl_n,
         COALESCE(g.gl_came, 0)::int AS gl_came,
         g.gl_first,
         COALESCE(g.gl_events, '{}'::uuid[]) AS gl_events,
         COALESCE(g.gl_noshow, 0)::int AS gl_noshow,
         -- Devenu client : premier billet PAYANT acheté après sa première soirée en guest list.
         (g.gl_first IS NOT NULL AND y.first_paid IS NOT NULL AND y.first_paid > g.gl_first) AS gl_conv,
         -- Catalogue de segments (20261008200000) : profil (Shotgun d'abord, puis
         -- vos fichiers), place pour une soirée à venir, dépense par soirée payée.
         COALESCE(pr.age, CASE WHEN b.f_age BETWEEN 12 AND 110 THEN b.f_age END) AS age,
         COALESCE(pr.gender, CASE WHEN b.f_gender IN ('female', 'male', 'other') THEN b.f_gender END) AS gender,
         COALESCE(pr.country, CASE WHEN btrim(b.f_country) ~* '^[a-z]{2}$' THEN upper(btrim(b.f_country)) END) AS country,
         COALESCE(pr.city, b.f_city, b.f_zone) AS area,
         public._crm_area_key(COALESCE(pr.city, b.f_city, b.f_zone)) AS area_key,
         (COALESCE(y.upcoming, false) OR COALESCE(g.gl_upcoming, false)) AS upcoming,
         CASE WHEN h.paid_n > 0 THEN round(h.spent / h.paid_n, 2) END AS basket,
         -- Ce que dit le fichier, et comment il a compté (fiche client).
         f.f_nights AS hist_nights, f.f_spent AS hist_spent, f.f_last AS hist_last, m.mode AS hist_mode, f.f_list AS hist_list,
         -- Analyse client (20261010110000) : clés de filtre pré-calculées.
         COALESCE(ap.tags, '{}'::text[]) AS an_tags, ap.dist_km AS an_dist_km
    FROM base b
    LEFT JOIN agg a ON a.email = b.email
    LEFT JOIN buy y ON y.email = b.email
    LEFT JOIN gl g ON g.email = b.email
    LEFT JOIN first_utm u ON u.email = b.email
    LEFT JOIN page_first pf ON pf.email = b.email
    LEFT JOIN prof pr ON pr.email = b.email
    LEFT JOIN fh f ON f.email = b.email
    LEFT JOIN public.crm_person_profile ap ON ap.scope_key = v_scope AND ap.email = b.email
    -- Comment l'historique d'un fichier compte :
    --   'added' — il précède le premier billet Shotgun (deux billetteries, ou
    --             pas encore de Shotgun) : les deux s'additionnent ;
    --   'file' / 'live' — les deux se recouvrent (un export de la même
    --             billetterie réimporté) : la source qui connaît le plus de
    --             soirées, JAMAIS la somme (pas de double compte).
    CROSS JOIN LATERAL (
      SELECT CASE WHEN f.email IS NULL THEN NULL
                  WHEN y.first_buy IS NULL OR f.f_asof < y.first_buy - interval '2 days' THEN 'added'
                  WHEN f.f_nights > COALESCE(a.nights, 0) THEN 'file'
                  ELSE 'live' END AS mode
    ) m
    CROSS JOIN LATERAL (
      SELECT CASE m.mode WHEN 'added' THEN COALESCE(a.nights, 0) + f.f_nights WHEN 'file' THEN f.f_nights ELSE COALESCE(a.nights, 0) END AS nights,
             CASE m.mode WHEN 'added' THEN COALESCE(y.spent, 0) + f.f_spent WHEN 'file' THEN f.f_spent ELSE COALESCE(y.spent, 0) END AS spent,
             CASE m.mode WHEN 'added' THEN COALESCE(y.paid_n, 0) + f.f_paid WHEN 'file' THEN f.f_paid ELSE COALESCE(y.paid_n, 0) END AS paid_n,
             CASE WHEN m.mode IS NULL THEN a.last_night ELSE GREATEST(a.last_night, f.f_last) END AS last_night,
             CASE WHEN m.mode IS NULL THEN a.first_night ELSE LEAST(a.first_night, f.f_first) END AS first_night
    ) h
    LEFT JOIN public.crm_contact_notes n ON n.scope_key = v_scope AND n.email = b.email;

  -- Comportement face aux messages (12 mois avant la date) : reçus, envois
  -- cliqués, et « a cliqué sans acheter » (dernier clic des 90 jours sans
  -- billet acheté dans les 7 jours qui suivent).
  ALTER TABLE _cp ADD COLUMN msg_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN click_n integer NOT NULL DEFAULT 0,
                  ADD COLUMN last_click timestamptz,
                  ADD COLUMN click_nobuy boolean NOT NULL DEFAULT false;
  WITH c AS (
    SELECT ec.id FROM public.email_campaigns ec
     WHERE ec.status IN ('sent', 'sending') AND ec.sent_at IS NOT NULL
       AND ec.sent_at <= v_at AND ec.sent_at > v_at - interval '12 months'
       AND ec.venue_id IS NOT DISTINCT FROM p_venue_id
       AND ec.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
  ), r AS (
    SELECT lower(x.email) AS em, count(*) AS n
      FROM public.email_campaign_recipients x JOIN c ON c.id = x.campaign_id
     WHERE x.status IN ('sent', 'complained')
     GROUP BY 1
  ), k AS (
    SELECT lower(ev.recipient_email) AS em, count(DISTINCT ev.campaign_id) AS n, max(ev.created_at) AS last
      FROM public.email_campaign_events ev JOIN c ON c.id = ev.campaign_id
     WHERE ev.event_type = 'clicked' AND ev.created_at <= v_at AND ev.recipient_email IS NOT NULL
     GROUP BY 1
  )
  UPDATE _cp p
     SET msg_n = COALESCE(r.n, 0), click_n = COALESCE(k.n, 0), last_click = k.last
    FROM (SELECT DISTINCT em FROM (SELECT em FROM r UNION SELECT em FROM k) u) e
    LEFT JOIN r ON r.em = e.em
    LEFT JOIN k ON k.em = e.em
   WHERE p.email = e.em;
  UPDATE _cp p
     SET click_nobuy = true
   WHERE p.last_click > v_at - interval '90 days'
     AND NOT EXISTS (SELECT 1 FROM _cpt t
                      WHERE t.email = p.email AND t.bought_at > p.last_click
                        AND t.bought_at <= LEAST(p.last_click + interval '7 days', v_at));

  SELECT count(*) INTO v_n FROM _cp;
  RETURN v_n;
END;
$function$;

-- ── 15. Filtres : les clés de l'analyse ─────────────────────────────────────
-- Corps de 20261008200000, plus : hyp, artist, genre, fmt, series, buy, grp,
-- arr (canal d'arrivée), dist_min, dist_max, pass.
CREATE OR REPLACE FUNCTION public._crm_filter_sql(p_def jsonb, p_alias text DEFAULT 'p'::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  a text := quote_ident(COALESCE(p_alias, 'p'));
  parts text[] := '{}';
  d jsonb := COALESCE(p_def, '{}'::jsonb);
  f jsonb := COALESCE(p_def->'f', '{}'::jsonb);
  v text;
  lst text;
  ors text[];
  q text;
  dig text;
BEGIN
  v := d->>'seg';
  IF v IS NOT NULL AND v <> 'all' THEN
    IF v IN ('hab', 'occ', 'nou', 'end', 'none') THEN parts := array_append(parts, format('%s.lifecycle = %L', a, v));
    ELSE parts := array_append(parts, 'false'); END IF;
  END IF;

  IF jsonb_typeof(f->'ev') = 'array' AND jsonb_array_length(f->'ev') > 0 THEN
    ors := '{}';
    SELECT string_agg(format('%L', x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'ev') x WHERE x ~ '^[0-9a-f-]{36}$';
    IF lst IS NOT NULL THEN ors := array_append(ors, format('%s.events && ARRAY[%s]::uuid[]', a, lst)); END IF;
    IF f->'ev' ? 'T' THEN ors := array_append(ors, format('%s.tonight', a)); END IF;
    parts := array_append(parts, CASE WHEN array_length(ors, 1) IS NULL THEN 'false' ELSE '(' || array_to_string(ors, ' OR ') || ')' END);
  END IF;

  v := f->>'last';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN '0-30' THEN format('%s.last_night >= now() - interval ''30 days''', a)
      WHEN '30-90' THEN format('(%s.last_night < now() - interval ''30 days'' AND %s.last_night >= now() - interval ''90 days'')', a, a)
      WHEN '90-180' THEN format('(%s.last_night < now() - interval ''90 days'' AND %s.last_night >= now() - interval ''180 days'')', a, a)
      WHEN '180+' THEN format('%s.last_night < now() - interval ''180 days''', a)
      ELSE 'false' END);
  END IF;

  -- Un nombre illisible ne retire plus la condition (le segment devenait
  -- « tout le monde ») : il ne garde personne.
  v := f->>'last_gt_days';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$'
      THEN format('%s.last_night < now() - make_interval(days => %s)', a, v) ELSE 'false' END);
  END IF;

  v := f->>'nb';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN '0' THEN format('%s.nights = 0', a)
      WHEN '1' THEN format('%s.nights = 1', a)
      WHEN '2' THEN format('%s.nights = 2', a)
      WHEN '3-5' THEN format('%s.nights BETWEEN 3 AND 5', a)
      WHEN '6+' THEN format('%s.nights >= 6', a)
      ELSE 'false' END);
  END IF;

  v := f->>'sp';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN '<50' THEN format('%s.spent < 50', a)
      WHEN '50-200' THEN format('%s.spent BETWEEN 50 AND 200', a)
      WHEN '200+' THEN format('%s.spent > 200', a)
      ELSE 'false' END);
  END IF;

  IF jsonb_typeof(f->'rc') = 'array' AND jsonb_array_length(f->'rc') > 0 THEN
    ors := '{}';
    IF f->'rc' ? 'mail' THEN ors := array_append(ors, format('%s.email_ok', a)); END IF;
    IF f->'rc' ? 'sms' THEN ors := array_append(ors, format('%s.phone_ok', a)); END IF;
    IF f->'rc' ? 'none' THEN ors := array_append(ors, format('(NOT %s.email_ok AND NOT %s.phone_ok)', a, a)); END IF;
    parts := array_append(parts, CASE WHEN array_length(ors, 1) IS NULL THEN 'false' ELSE '(' || array_to_string(ors, ' OR ') || ')' END);
  END IF;

  IF jsonb_typeof(f->'src') = 'array' AND jsonb_array_length(f->'src') > 0 THEN
    SELECT string_agg(format('%L', x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'src') x WHERE x IN ('shotgun', 'utm', 'import', 'page', 'other');
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.source IN (%s)', a, lst) END);
  END IF;

  IF jsonb_typeof(f->'tags') = 'array' AND jsonb_array_length(f->'tags') > 0 THEN
    SELECT string_agg(format('%L', x), ',') INTO lst FROM jsonb_array_elements_text(f->'tags') x;
    parts := array_append(parts, format('COALESCE(%s.tags, ''{}'') && ARRAY[%s]::text[]', a, lst));
  END IF;

  v := f->>'msg';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'never_clicked' THEN format('(%s.msg_n >= 3 AND %s.click_n = 0)', a, a)
      WHEN 'clicked_no_buy' THEN format('%s.click_nobuy', a)
      WHEN 'never_sent' THEN format('%s.msg_n = 0', a)
      ELSE 'false' END);
  END IF;

  -- Guest list (20261008100000). Valeur inconnue ⇒ personne.
  v := f->>'gl';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'any' THEN format('%s.gl_n > 0', a)
      WHEN 'only' THEN format('(%s.gl_n > 0 AND %s.paid_n = 0)', a, a)
      WHEN 'loyal' THEN format('(%s.gl_n >= 3 AND %s.paid_n = 0)', a, a)
      WHEN 'conv' THEN format('%s.gl_conv', a)
      WHEN 'noshow' THEN format('%s.gl_noshow >= 2', a)
      ELSE 'false' END);
  END IF;

  IF jsonb_typeof(f->'glev') = 'array' AND jsonb_array_length(f->'glev') > 0 THEN
    SELECT string_agg(format('%L', x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'glev') x WHERE x ~ '^[0-9a-f-]{36}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.gl_events && ARRAY[%s]::uuid[]', a, lst) END);
  END IF;

  -- ── Catalogue de segments (20261008200000). Valeur illisible ⇒ personne. ──
  v := f->>'nb_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$' THEN format('%s.nights >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'nb_max';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$' THEN format('%s.nights <= %s', a, v) ELSE 'false' END);
  END IF;
  -- Venu il y a moins de N jours.
  v := f->>'last_lt_days';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$'
      THEN format('%s.last_night >= now() - make_interval(days => %s)', a, v) ELSE 'false' END);
  END IF;
  v := f->>'sp_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' THEN format('%s.spent >= %s', a, v) ELSE 'false' END);
  END IF;
  -- Dépense par soirée payée (personne sans billet payant : aucune valeur, jamais retenue).
  v := f->>'basket_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' THEN format('%s.basket >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'paid_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$' THEN format('%s.paid_n >= %s', a, v) ELSE 'false' END);
  END IF;
  -- Âge et genre : une personne dont on ne connaît pas l'âge n'entre dans aucune tranche.
  v := f->>'age_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,3}$' THEN format('%s.age >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'age_max';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,3}$' THEN format('%s.age <= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'gender';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v IN ('female', 'male', 'other') THEN format('%s.gender = %L', a, v) ELSE 'false' END);
  END IF;
  -- Ville (clé de _crm_area_key) et pays (ISO 2).
  IF jsonb_typeof(f->'area') = 'array' AND jsonb_array_length(f->'area') > 0 THEN
    SELECT string_agg(format('%L', public._crm_area_key(x)), ',') INTO lst
      FROM jsonb_array_elements_text(f->'area') x WHERE public._crm_area_key(x) IS NOT NULL;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.area_key IN (%s)', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'country') = 'array' AND jsonb_array_length(f->'country') > 0 THEN
    SELECT string_agg(format('%L', upper(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'country') x WHERE btrim(x) ~* '^[a-z]{2}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.country IN (%s)', a, lst) END);
  END IF;
  v := f->>'country_not';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN btrim(v) ~* '^[a-z]{2}$'
      THEN format('(%s.country IS NOT NULL AND %s.country <> %L)', a, a, upper(btrim(v))) ELSE 'false' END);
  END IF;
  -- Place (billet ou invitation) pour une soirée qui n'a pas encore commencé.
  v := f->>'up';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'yes' THEN format('%s.upcoming', a)
      WHEN 'no' THEN format('NOT %s.upcoming', a)
      ELSE 'false' END);
  END IF;
  -- A cliqué sur un lien d'un e-mail il y a moins de N jours.
  v := f->>'click_lt_days';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,4}$'
      THEN format('%s.last_click >= now() - make_interval(days => %s)', a, v) ELSE 'false' END);
  END IF;
  -- Canaux joignables ensemble ou seuls.
  v := f->>'ch';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'both' THEN format('(%s.email_ok AND %s.phone_ok)', a, a)
      WHEN 'email_only' THEN format('(%s.email_ok AND NOT %s.phone_ok)', a, a)
      WHEN 'sms_only' THEN format('(%s.phone_ok AND NOT %s.email_ok)', a, a)
      ELSE 'false' END);
  END IF;

  -- ── Analyse client (20261010110000) : clés pré-calculées (crm_person_profile.tags).
  --    Valeur illisible ⇒ personne. Un contact sans profil (fichier seul) n'a
  --    aucune clé : il n'entre dans aucun de ces filtres.
  IF jsonb_typeof(f->'hyp') = 'array' AND jsonb_array_length(f->'hyp') > 0 THEN
    SELECT string_agg(format('%L', 'h:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'hyp') x WHERE x ~ '^[a-z_]{2,24}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'artist') = 'array' AND jsonb_array_length(f->'artist') > 0 THEN
    SELECT string_agg(format('%L', 'a:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'artist') x WHERE x ~ '^(id|slug|name):.{1,160}$';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'genre') = 'array' AND jsonb_array_length(f->'genre') > 0 THEN
    SELECT string_agg(format('%L', 'g:' || lower(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'genre') x WHERE length(btrim(x)) BETWEEN 1 AND 60;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'fmt') = 'array' AND jsonb_array_length(f->'fmt') > 0 THEN
    SELECT string_agg(format('%L', 'fmt:' || lower(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'fmt') x WHERE length(btrim(x)) BETWEEN 1 AND 40;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'series') = 'array' AND jsonb_array_length(f->'series') > 0 THEN
    SELECT string_agg(format('%L', 's:' || lower(btrim(x))), ',') INTO lst
      FROM jsonb_array_elements_text(f->'series') x WHERE length(btrim(x)) BETWEEN 1 AND 300;
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  IF jsonb_typeof(f->'buy') = 'array' AND jsonb_array_length(f->'buy') > 0 THEN
    SELECT string_agg(format('%L', 'b:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'buy') x WHERE x IN ('early', 'launch', 'last_minute', 'door');
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  v := f->>'grp';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v IN ('group', 'solo', 'brought')
      THEN format('%L = ANY (%s.an_tags)', 'grp:' || v, a) ELSE 'false' END);
  END IF;
  IF jsonb_typeof(f->'arr') = 'array' AND jsonb_array_length(f->'arr') > 0 THEN
    SELECT string_agg(format('%L', 'ch:' || x), ',') INTO lst
      FROM jsonb_array_elements_text(f->'arr') x
     WHERE x IN ('ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of', 'gl');
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.an_tags && ARRAY[%s]::text[]', a, lst) END);
  END IF;
  v := f->>'dist_min';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,5}$' THEN format('%s.an_dist_km >= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'dist_max';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE WHEN v ~ '^[0-9]{1,5}$' THEN format('%s.an_dist_km <= %s', a, v) ELSE 'false' END);
  END IF;
  v := f->>'pass';
  IF v IS NOT NULL AND v <> '' THEN
    parts := array_append(parts, CASE v
      WHEN 'yes' THEN format('''pass'' = ANY (%s.an_tags)', a)
      WHEN 'no' THEN format('''loc'' = ANY (%s.an_tags)', a)
      ELSE 'false' END);
  END IF;

  -- Liste fixe (une sélection enregistrée en segment) : 5 000 adresses au plus.
  IF jsonb_typeof(f->'emails') = 'array' AND jsonb_array_length(f->'emails') > 0 THEN
    SELECT string_agg(format('%L', lower(btrim(x))), ',') INTO lst
      FROM (SELECT x FROM jsonb_array_elements_text(f->'emails') x LIMIT 5000) z WHERE x ~ '@';
    parts := array_append(parts, CASE WHEN lst IS NULL THEN 'false' ELSE format('%s.email = ANY (ARRAY[%s]::text[])', a, lst) END);
  END IF;

  q := btrim(COALESCE(d->>'q', ''));
  IF q <> '' THEN
    dig := regexp_replace(q, '\D', '', 'g');
    parts := array_append(parts, format(
      '(lower(public.unaccent_safe(COALESCE(%s.first_name, '''') || '' '' || COALESCE(%s.last_name, '''') || '' '' || %s.email)) LIKE %L%s)',
      a, a, a, '%' || replace(replace(lower(public.unaccent_safe(q)), '%', ''), '_', '') || '%',
      CASE WHEN length(dig) >= 3 THEN format(' OR regexp_replace(COALESCE(%s.phone, ''''), ''\D'', '''', ''g'') LIKE %L', a, '%' || dig || '%') ELSE '' END));
  END IF;

  IF array_length(parts, 1) IS NULL THEN RETURN 'true'; END IF;
  RETURN '(' || array_to_string(parts, ' AND ') || ')';
END;
$function$;


-- ── 16. Mémoire des annonces : l'existant ───────────────────────────────────
-- Mémoire des annonces : les soirées DÉJÀ en base ont une date d'annonce
-- inconnue ; leur publication sert de borne.
INSERT INTO public.crm_artist_seen (connection_id, external_event_id, artist_key, first_seen_at, announce_known)
SELECT e.connection_id, e.external_id, public._crm_artist_key(a), COALESCE(e.published_at, e.first_seen_at), false
  FROM public.external_events e
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.artists) = 'array' THEN e.artists ELSE '[]'::jsonb END) a
 WHERE public._crm_artist_key(a) IS NOT NULL
ON CONFLICT DO NOTHING;
