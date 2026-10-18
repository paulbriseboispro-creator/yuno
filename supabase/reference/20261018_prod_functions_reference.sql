-- Référence : fonctions de la prod dont le texte diffère du dépôt (OPS-04).
-- Lu en LECTURE SEULE sur fulawxvdlwtdlpkycixe le 2026-10-18T12:18Z (pg_get_functiondef + proacl),
-- dernière migration appliquée : 20261020200000. 50 fonctions.
--
-- Ce fichier N'EST PAS dans supabase/migrations : `supabase db push` ne le joue pas.
-- Usage : reconstruction de secours. Après avoir rejoué les migrations du dépôt
-- jusqu'à 20261020200000 inclus, le jouer pour retrouver le texte exact des
-- fonctions de la prod à cette date. Le jouer sur la prod aujourd'hui serait sans
-- effet ; le jouer APRÈS de nouvelles migrations les annulerait : ne jamais le
-- déplacer tel quel dans supabase/migrations.
--
-- Statuts (rapport : docs/audit/2026-10-18-crm-readiness/ops04-functions.md) :
--   rewritten  aucun fichier du dépôt ne porte ce texte (bloc DO, migration hors dépôt, SQL à la main)
--   older      la prod porte une définition antérieure à la dernière du dépôt
--   absent     le dépôt ne crée cette fonction nulle part
-- Les droits (EXECUTE) reproduisent proacl à l'identique.

BEGIN;

-- rewritten · private.get_cron_secret() · dépôt : 20260430181933_e97dbd86-9f94-4c91-b691-7fa1ce395821.sql
CREATE OR REPLACE FUNCTION private.get_cron_secret()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'vault', 'public'
AS $function$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name IN ('cron_secret', 'CRON_SECRET')
  ORDER BY CASE WHEN name = 'cron_secret' THEN 0 ELSE 1 END
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION private.get_cron_secret() FROM PUBLIC, anon, authenticated, service_role;

-- rewritten · public._crm_an_load(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone, p_cfg jsonb) · dépôt : 20261013100000_crm_analysis_speed.sql
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
   WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     AND t.buyer_email IS NOT NULL
     AND t.status = 'valid'
     AND (public._crm_ticket_is_sale(t.status, t.deal_channel) OR public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) = 'inv')
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
$function$;
REVOKE ALL ON FUNCTION public._crm_an_load(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone, p_cfg jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_an_load(p_venue_id text, p_organizer_user_id uuid, p_at timestamp with time zone, p_cfg jsonb) TO "service_role";

-- rewritten · public._crm_cond_leaf_check(p_k text, p_v jsonb, p_ctx text) · dépôt : 20261016100000_crm_scenario_conditions.sql
CREATE OR REPLACE FUNCTION public._crm_cond_leaf_check(p_k text, p_v jsonb, p_ctx text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  t text := COALESCE(jsonb_typeof(p_v), 'null');
  s text := CASE WHEN jsonb_typeof(p_v) = 'string' THEN p_v #>> '{}' END;
  n text := CASE WHEN jsonb_typeof(p_v) = 'number' THEN p_v::text END;
  ok boolean;
  fam text[] := ARRAY['artist', 'genre', 'format', 'slot', 'weekday', 'place', 'series',
                      'early', 'launch', 'last_minute', 'door', 'group', 'table',
                      'discovery', 'passing', 'invited', 'group_first', 'brought', 'channel'];
  uuid_re text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  lists text[] := ARRAY['src', 'rc', 'buy', 'arr', 'hyp', 'sc_chance', 'area', 'tags', 'genre', 'fmt',
                        'series', 'country', 'artist', 'ev', 'glev'];
  scalars text[] := ARRAY['gender', 'pass', 'seg', 'last', 'nb', 'sp', 'up', 'grp', 'msg', 'gl', 'ch',
                          'sc_family', 'country_not', 'age_min', 'age_max', 'dist_min', 'dist_max',
                          'last_gt_days', 'last_lt_days', 'nb_min', 'nb_max', 'paid_min', 'click_lt_days',
                          'sp_min', 'basket_min', 'sc_bought', 'sc_entered', 'segment', 'sc_opened',
                          'sc_clicked', 'sc_sms_delivered', 'ntgt'];
BEGIN
  IF p_k IS NULL THEN RETURN 'unknown_key'; END IF;
  -- Le lien court d'un SMS est partagé par soirée : aucun clic par personne.
  IF p_k = 'sc_sms_clicked' THEN RETURN 'soon'; END IF;
  IF NOT (p_k = ANY (lists) OR p_k = ANY (scalars)) THEN RETURN 'unknown_key'; END IF;
  -- Le filtre d'ENTRÉE ne connaît pas encore l'inscription.
  IF p_ctx = 'entry' AND p_k IN ('sc_bought', 'sc_entered', 'sc_opened', 'sc_clicked', 'sc_sms_delivered') THEN
    RETURN 'not_in_entry';
  END IF;

  IF p_k = ANY (lists) THEN
    -- Listes : non vides, et CHAQUE élément lisible (plus strict que le
    -- filtre, qui ignore un élément illisible).
    IF t <> 'array' THEN RETURN 'bad_value'; END IF;
    IF jsonb_array_length(p_v) = 0 THEN RETURN 'bad_value'; END IF;
    ok := NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_v) x
       WHERE NOT COALESCE(CASE WHEN jsonb_typeof(x) <> 'string' THEN false ELSE CASE p_k
         WHEN 'src' THEN x #>> '{}' IN ('shotgun', 'utm', 'import', 'page', 'other')
         WHEN 'rc' THEN x #>> '{}' IN ('mail', 'sms', 'none')
         WHEN 'buy' THEN x #>> '{}' IN ('early', 'launch', 'last_minute', 'door')
         WHEN 'arr' THEN x #>> '{}' IN ('ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of', 'gl')
         WHEN 'hyp' THEN x #>> '{}' = ANY (fam)
         WHEN 'sc_chance' THEN x #>> '{}' IN ('high', 'medium', 'low')
         WHEN 'area' THEN length(btrim(x #>> '{}')) BETWEEN 1 AND 80
         WHEN 'tags' THEN length(btrim(x #>> '{}')) BETWEEN 1 AND 60
         WHEN 'genre' THEN length(btrim(x #>> '{}')) BETWEEN 1 AND 60
         WHEN 'fmt' THEN length(btrim(x #>> '{}')) BETWEEN 1 AND 40
         WHEN 'series' THEN length(btrim(x #>> '{}')) BETWEEN 1 AND 300
         WHEN 'country' THEN btrim(x #>> '{}') ~* '^[a-z]{2}$'
         -- Comme _crm_filter_sql : l'artiste n'est pas « nettoyé ».
         WHEN 'artist' THEN (x #>> '{}') ~ '^(id|slug|name):.{1,160}$'
         -- Soirées : id en minuscules (comme _crm_filter_sql), « T » (ce soir), « $event ».
         WHEN 'ev' THEN (x #>> '{}') ~ uuid_re OR x #>> '{}' IN ('T', '$event')
         WHEN 'glev' THEN (x #>> '{}') ~ uuid_re OR x #>> '{}' IN ('T', '$event')
       END END, false));
    RETURN CASE WHEN ok THEN NULL ELSE 'bad_value' END;
  END IF;

  ok := COALESCE(CASE p_k
    WHEN 'gender' THEN s IN ('female', 'male', 'other')
    WHEN 'pass' THEN s IN ('yes', 'no')
    WHEN 'seg' THEN s IN ('hab', 'occ', 'nou', 'end', 'none')
    WHEN 'last' THEN s IN ('0-30', '30-90', '90-180', '180+')
    WHEN 'nb' THEN s IN ('0', '1', '2', '3-5', '6+')
    WHEN 'sp' THEN s IN ('<50', '50-200', '200+')
    WHEN 'up' THEN s IN ('yes', 'no')
    WHEN 'grp' THEN s IN ('group', 'solo', 'brought')
    WHEN 'msg' THEN s IN ('never_clicked', 'clicked_no_buy', 'never_sent')
    WHEN 'gl' THEN s IN ('any', 'only', 'loyal', 'conv', 'noshow')
    WHEN 'ch' THEN s IN ('both', 'email_only', 'sms_only')
    WHEN 'sc_family' THEN s = ANY (fam)
    WHEN 'country_not' THEN btrim(s) ~* '^[a-z]{2}$'
    -- Entiers positifs, lus dans le texte JSON comme _crm_filter_sql les lira.
    WHEN 'age_min' THEN n ~ '^[0-9]{1,3}$'
    WHEN 'age_max' THEN n ~ '^[0-9]{1,3}$'
    WHEN 'dist_min' THEN n ~ '^[0-9]{1,5}$'
    WHEN 'dist_max' THEN n ~ '^[0-9]{1,5}$'
    WHEN 'last_gt_days' THEN n ~ '^[0-9]{1,4}$'
    WHEN 'last_lt_days' THEN n ~ '^[0-9]{1,4}$'
    WHEN 'nb_min' THEN n ~ '^[0-9]{1,4}$'
    WHEN 'nb_max' THEN n ~ '^[0-9]{1,4}$'
    WHEN 'paid_min' THEN n ~ '^[0-9]{1,4}$'
    WHEN 'click_lt_days' THEN n ~ '^[0-9]{1,4}$'
    WHEN 'sp_min' THEN n ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$'
    WHEN 'basket_min' THEN n ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$'
    WHEN 'sc_bought' THEN t = 'boolean'
    WHEN 'sc_entered' THEN t = 'boolean'
    WHEN 'segment' THEN s ~* uuid_re
    WHEN 'sc_opened' THEN s ~* '^[a-z0-9_-]{1,32}$'
    WHEN 'sc_clicked' THEN s ~* '^[a-z0-9_-]{1,32}$'
    WHEN 'sc_sms_delivered' THEN s ~* '^[a-z0-9_-]{1,32}$'
    WHEN 'ntgt' THEN CASE WHEN t <> 'object' THEN false ELSE
          (SELECT count(*) FROM jsonb_object_keys(p_v)) = 2
          AND COALESCE(jsonb_typeof(p_v->'e'), '') = 'string' AND COALESCE(jsonb_typeof(p_v->'a'), '') = 'string'
          AND ((p_v->>'e') ~* uuid_re OR p_v->>'e' = '$event')
          AND p_v->>'a' IN ('concept', 'lineup', 'genre', 'early', 'last_minute', 'once_local', 'likely') END
  END, false);
  RETURN CASE WHEN ok THEN NULL ELSE 'bad_value' END;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_cond_leaf_check(p_k text, p_v jsonb, p_ctx text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_cond_leaf_check(p_k text, p_v jsonb, p_ctx text) TO "service_role";

-- rewritten · public._crm_cond_leaf_sql(p_k text, p_v jsonb, p_p text, p_r text) · dépôt : 20261016100000_crm_scenario_conditions.sql
CREATE OR REPLACE FUNCTION public._crm_cond_leaf_sql(p_k text, p_v jsonb, p_p text, p_r text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  p text := quote_ident(p_p);
  r text := quote_ident(p_r);
  q text;
  lst text;
BEGIN
  -- Une définition de segment, déjà résolue depuis la base.
  IF p_k = '_def' THEN
    IF p_v IS NULL OR jsonb_typeof(p_v) <> 'object' THEN RETURN NULL; END IF;
    RETURN public._crm_filter_sql(p_v, p_p);
  END IF;
  CASE p_k
    WHEN 'sc_bought' THEN
      q := format('EXISTS (SELECT 1 FROM public.external_tickets t WHERE t.event_id = %s.event_id'
                  ' AND lower(t.buyer_email) = %s.email AND public._crm_ticket_is_sale(t.status, t.deal_channel)'
                  ' AND COALESCE(t.purchased_at, t.first_seen_at) >= %s.entered_at)', r, r, r);
      RETURN CASE WHEN p_v = 'true'::jsonb THEN q ELSE 'NOT ' || q END;
    WHEN 'sc_entered' THEN
      q := format('EXISTS (SELECT 1 FROM public.external_tickets t WHERE t.event_id = %s.event_id'
                  ' AND lower(t.buyer_email) = %s.email AND t.scanned_at IS NOT NULL)', r, r);
      RETURN CASE WHEN p_v = 'true'::jsonb THEN q ELSE 'NOT ' || q END;
    -- Le message de CETTE inscription (registre des étapes), pas celui d'un autre passage.
    WHEN 'sc_opened', 'sc_clicked' THEN
      RETURN format('EXISTS (SELECT 1 FROM public.crm_scenario_steps st'
                    ' JOIN public.email_campaign_events ev ON ev.campaign_id = st.campaign_id'
                    ' WHERE st.run_id = %s.id AND st.node_id = %L AND st.status = ''sent'' AND ev.event_type IN (%s)'
                    ' AND lower(ev.recipient_email) = %s.email)',
                    r, p_v #>> '{}', CASE p_k WHEN 'sc_opened' THEN '''opened'', ''clicked''' ELSE '''clicked''' END, r);
    WHEN 'sc_sms_delivered' THEN
      RETURN format('EXISTS (SELECT 1 FROM public.crm_scenario_steps st'
                    ' JOIN public.sms_campaign_recipients sr ON sr.campaign_id = st.sms_campaign_id'
                    ' WHERE st.run_id = %s.id AND st.node_id = %L AND st.status = ''sent'' AND sr.status = ''delivered'''
                    ' AND lower(sr.email) = %s.email)', r, p_v #>> '{}', r);
    WHEN 'sc_chance' THEN
      SELECT string_agg(format('%L', x), ',') INTO lst FROM jsonb_array_elements_text(p_v) x;
      RETURN format('EXISTS (SELECT 1 FROM public.crm_person_night_score s WHERE s.scope_key = %s.scope_key'
                    ' AND s.event_id = %s.event_id AND s.email = %s.email AND s.label IN (%s))', r, r, r, lst);
    WHEN 'sc_family' THEN
      RETURN format('(public._crm_family_confirmed(%s.scope_key, %L) AND %L = ANY (%s.an_tags))',
                    r, p_v #>> '{}', 'h:' || (p_v #>> '{}'), p);
    WHEN 'segment' THEN
      RETURN NULL;   -- non résolue (segment perdu) : l'arbre entier est faux
    WHEN 'seg' THEN
      q := public._crm_filter_sql(jsonb_build_object('seg', p_v), p_p);
    ELSE
      -- « $event » non résolu : l'arbre entier est faux.
      IF p_k IN ('ev', 'glev') AND p_v ? '$event' THEN RETURN NULL; END IF;
      IF p_k = 'ntgt' AND p_v->>'e' = '$event' THEN RETURN NULL; END IF;
      q := public._crm_filter_sql(jsonb_build_object('f', jsonb_build_object(p_k, p_v)), p_p);
  END CASE;
  -- _crm_filter_sql rend « (false) » pour une valeur illisible.
  IF q IS NULL OR q IN ('false', '(false)', 'true') THEN RETURN NULL; END IF;
  RETURN q;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_cond_leaf_sql(p_k text, p_v jsonb, p_p text, p_r text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_cond_leaf_sql(p_k text, p_v jsonb, p_p text, p_r text) TO "service_role";

-- rewritten · public._crm_erase_contacts(p_venue_id text, p_organizer_user_id uuid, p_emails text[]) · dépôt : 20261016130000_crm_scenario_engine.sql
CREATE OR REPLACE FUNCTION public._crm_erase_contacts(p_venue_id text, p_organizer_user_id uuid, p_emails text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- « Chances de venir » (20261012100000, 20261013110000) : ses chances et
  -- leur journal partent avec lui.
  DELETE FROM public.crm_person_night_score WHERE scope_key = v_key AND email = ANY (v_emails);
  DELETE FROM public.crm_prediction_people WHERE scope_key = v_key AND email = ANY (v_emails);

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
         buyer_ref = NULL, holder_email = NULL, holder_first_name = NULL, holder_last_name = NULL, provider_contact_id = NULL, provider_user_id = NULL,
         raw = '{}'::jsonb
   WHERE ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
     AND lower(t.buyer_email) = ANY (v_emails);

  DELETE FROM public.contact_engagement ce
   WHERE ((p_venue_id IS NOT NULL AND ce.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ce.organizer_user_id = p_organizer_user_id))
     AND lower(ce.email) = ANY (v_emails);

  -- Scénarios (20261016130000) : les inscriptions passées restent comptées
  -- (chiffres du scénario, témoin), sous une adresse qui ne désigne plus
  -- personne ; une inscription en route sort (« contact effacé ») ; ses
  -- entrées en attente et la base d'un déclencheur « segment » partent.
  UPDATE public.crm_scenario_runs r
     SET email = 'erased-' || md5(r.email) || '@erased.invalid',
         status = CASE WHEN r.status = 'active' THEN 'exited' ELSE r.status END,
         exit_reason = CASE WHEN r.status = 'active' THEN 'erased' ELSE r.exit_reason END,
         updated_at = now()
   WHERE r.scope_key = v_key AND r.email = ANY (v_emails);
  DELETE FROM public.crm_scenario_pending pd USING public.crm_scenarios s
   WHERE s.id = pd.scenario_id AND s.scope_key = v_key AND pd.email = ANY (v_emails);
  DELETE FROM public.crm_scenario_seen sn USING public.crm_scenarios s
   WHERE s.id = sn.scenario_id AND s.scope_key = v_key AND sn.email = ANY (v_emails);

  -- L'adresse portée par un destinataire SMS (20261013120000) part aussi.
  UPDATE public.sms_campaign_recipients r
     SET email = NULL
    FROM public.sms_campaigns c
   WHERE c.id = r.campaign_id
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND c.organizer_id IS NOT DISTINCT FROM CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END
     AND lower(r.email) = ANY (v_emails);

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
$function$;
REVOKE ALL ON FUNCTION public._crm_erase_contacts(p_venue_id text, p_organizer_user_id uuid, p_emails text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_erase_contacts(p_venue_id text, p_organizer_user_id uuid, p_emails text[]) TO "service_role";

-- rewritten · public._crm_filter_sql(p_def jsonb, p_alias text) · dépôt : 20261012110000_crm_prediction_reads.sql
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
     WHERE x IN ('ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of', 'gl');
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

  -- « Qui cibler » (20261011110000) : une audience d'une soirée à venir, lue par
  -- la même porte que la RPC crm_night_targets. La portée vient de
  -- _crm_people_build ; une soirée hors de la portée rend personne.
  IF jsonb_typeof(f->'ntgt') = 'object' THEN
    parts := array_append(parts, CASE
      WHEN f->'ntgt'->>'e' ~* '^[0-9a-f-]{36}$'
       AND f->'ntgt'->>'a' IN ('concept', 'lineup', 'genre', 'early', 'last_minute', 'once_local', 'likely')
      THEN format('%s.email IN (SELECT tg.email FROM public._crm_night_target_set(current_setting(''yuno.crm_scope'', true), %L::uuid, %L) tg)',
                  a, f->'ntgt'->>'e', f->'ntgt'->>'a')
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
REVOKE ALL ON FUNCTION public._crm_filter_sql(p_def jsonb, p_alias text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_filter_sql(p_def jsonb, p_alias text) TO "service_role";

-- rewritten · public._crm_night_tiers(p_event_id uuid, p_deals jsonb) · dépôt : 20261006210000_crm_sales_truth.sql
CREATE OR REPLACE FUNCTION public._crm_night_tiers(p_event_id uuid, p_deals jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH d AS (
    SELECT ord, NULLIF(btrim(x->>'name'), '') AS name, NULLIF(x->>'id', '') AS did,
           CASE WHEN x->>'price' ~ '^[0-9]+(\.[0-9]+)?$' THEN (x->>'price')::numeric END AS price,
           CASE WHEN x->>'quantity' ~ '^[0-9]+$' THEN (x->>'quantity')::integer END AS q
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_deals) = 'array' THEN p_deals ELSE '[]'::jsonb END)
           WITH ORDINALITY AS t(x, ord)
  ), tk AS (
    SELECT t.deal_id, lower(btrim(t.deal_name)) AS dn, max(t.price) AS price, sum(GREATEST(t.quantity, 1)) AS sold
      FROM public.external_tickets t
     WHERE t.event_id = p_event_id AND public._crm_ticket_is_sale(t.status, t.deal_channel)
     GROUP BY 1, 2
  ), matched AS (
    SELECT d.ord, d.name, d.price, d.q,
           COALESCE((SELECT sum(tk.sold) FROM tk
                      WHERE (d.did IS NOT NULL AND tk.deal_id = d.did)
                         OR (tk.dn = lower(d.name) AND (d.did IS NULL OR tk.deal_id IS DISTINCT FROM d.did))), 0) AS sold
      FROM d WHERE d.name IS NOT NULL
  ), orphans AS (
    SELECT 1000 + row_number() OVER (ORDER BY tk.price) AS ord, initcap(tk.dn) AS name, tk.price, NULL::integer AS q, tk.sold
      FROM tk
     WHERE tk.dn IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM d WHERE (d.did IS NOT NULL AND d.did = tk.deal_id) OR lower(d.name) = tk.dn)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', u.name, 'price', u.price, 'cap', u.q, 'sold', u.sold) ORDER BY u.ord), '[]'::jsonb)
    FROM (SELECT * FROM matched UNION ALL SELECT * FROM orphans) u;
$function$;
REVOKE ALL ON FUNCTION public._crm_night_tiers(p_event_id uuid, p_deals jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_night_tiers(p_event_id uuid, p_deals jsonb) TO "service_role";

-- absent · public._crm_practical_audience(p_campaign_id uuid)
CREATE OR REPLACE FUNCTION public._crm_practical_audience(p_campaign_id uuid)
 RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (lower(xt.buyer_email))
         lower(btrim(xt.buyer_email))::text,
         NULLIF(btrim(xt.buyer_first_name), '')::text,
         NULLIF(btrim(xt.buyer_last_name), '')::text,
         NULL::uuid,
         -- Pas de jeton : un e-mail pratique n'a ni lien ni en-tête de
         -- désinscription (rien à quitter, c'est l'information d'un achat).
         NULL::uuid
    FROM public.email_campaigns c
    JOIN public.events ev
      ON ev.id = c.event_id AND ev.external_source IS NOT NULL
     AND public.marketing_scope_match(ev.venue_id, ev.organizer_user_id, c.venue_id, c.organizer_user_id)
    JOIN public.external_tickets xt
      ON xt.event_id = c.event_id
     AND xt.status = 'valid'
     AND public.marketing_scope_match(xt.venue_id, xt.organizer_user_id, c.venue_id, c.organizer_user_id)
   WHERE c.id = p_campaign_id AND c.practical
     AND xt.buyer_email IS NOT NULL
     AND btrim(xt.buyer_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
   ORDER BY lower(xt.buyer_email), xt.purchased_at DESC NULLS LAST;
$function$;
REVOKE ALL ON FUNCTION public._crm_practical_audience(p_campaign_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_practical_audience(p_campaign_id uuid) TO "service_role";

-- absent · public._crm_practical_content_issues(p_blocks jsonb, p_subject text, p_preheader text, p_event_id uuid, p_event_url text)
CREATE OR REPLACE FUNCTION public._crm_practical_content_issues(p_blocks jsonb, p_subject text, p_preheader text, p_event_id uuid, p_event_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb := '[]'::jsonb;
  b jsonb;
  v_type text;
  v_id text;
  v_issue text;
  v_txt text;
  v_url text;
BEGIN
  v_issue := public._crm_practical_text_issue(p_subject);
  IF v_issue IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('code', 'promo_words', 'field', 'subject', 'term', v_issue);
  END IF;
  v_issue := public._crm_practical_text_issue(p_preheader);
  IF v_issue IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('code', 'promo_words', 'field', 'preheader', 'term', v_issue);
  END IF;

  IF jsonb_typeof(p_blocks) <> 'array' THEN RETURN v_out; END IF;

  FOR b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
    v_type := b->>'type';
    v_id := b->>'id';

    IF v_type IS NULL OR v_type NOT IN ('header', 'text', 'image', 'cta', 'columns', 'event', 'countdown',
                                        'lineup', 'social', 'divider', 'spacer') THEN
      v_out := v_out || jsonb_build_object('code', 'block_not_allowed', 'block', v_id, 'type', v_type);
      CONTINUE;
    END IF;

    -- Bloc Yuno : la soirée de l'e-mail, jamais une autre.
    IF v_type IN ('event', 'countdown', 'lineup')
       AND NULLIF(b->>'eventId', '') IS NOT NULL
       AND (p_event_id IS NULL OR b->>'eventId' <> p_event_id::text) THEN
      v_out := v_out || jsonb_build_object('code', 'other_event', 'block', v_id, 'type', v_type);
    END IF;
    IF v_type = 'countdown' AND NULLIF(b->>'eventId', '') IS NULL AND NULLIF(b->>'targetAt', '') IS NOT NULL THEN
      -- Un compte à rebours vers une autre date annonce autre chose que la soirée.
      v_out := v_out || jsonb_build_object('code', 'other_event', 'block', v_id, 'type', v_type);
    END IF;
    IF v_type = 'event' AND COALESCE((b->>'price')::boolean, false) THEN
      v_out := v_out || jsonb_build_object('code', 'price_shown', 'block', v_id, 'type', v_type);
    END IF;

    -- Les liens du bloc.
    FOR v_url IN
      SELECT u FROM (
        SELECT b->>'url' AS u WHERE v_type = 'cta'
        UNION ALL SELECT b->>'linkUrl' WHERE v_type = 'image'
        UNION ALL SELECT m[1] FROM regexp_matches(COALESCE(b->>'body', ''), '\[url=([^\]]+)\]', 'gi') m WHERE v_type = 'text'
        UNION ALL SELECT m[1] FROM regexp_matches(COALESCE(b->>'body', ''), 'href\s*=\s*["'']([^"'']+)["'']', 'gi') m WHERE v_type = 'text'
        UNION ALL SELECT m[1] FROM regexp_matches(COALESCE(b#>>'{left,body}', '') || ' ' || COALESCE(b#>>'{right,body}', ''), '\[url=([^\]]+)\]', 'gi') m WHERE v_type = 'columns'
      ) x WHERE NULLIF(btrim(u), '') IS NOT NULL
    LOOP
      v_issue := public._crm_practical_link_issue(v_url, p_event_url);
      IF v_issue IS NOT NULL THEN
        v_out := v_out || jsonb_build_object('code', v_issue, 'block', v_id, 'type', v_type, 'url', left(v_url, 200));
      END IF;
    END LOOP;

    -- Les mots du bloc.
    v_txt := concat_ws(' ',
      b->>'body', b->>'label', b->>'title', b->>'kicker', b->>'sub', b->>'note',
      b#>>'{left,title}', b#>>'{left,body}', b#>>'{right,title}', b#>>'{right,body}',
      CASE WHEN jsonb_typeof(b->'perks') = 'array'
           THEN (SELECT string_agg(value, ' ') FROM jsonb_array_elements_text(b->'perks')) END);
    v_issue := public._crm_practical_text_issue(v_txt);
    IF v_issue IS NOT NULL THEN
      v_out := v_out || jsonb_build_object('code', 'promo_words', 'block', v_id, 'type', v_type, 'term', v_issue);
    END IF;
  END LOOP;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_practical_content_issues(p_blocks jsonb, p_subject text, p_preheader text, p_event_id uuid, p_event_url text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_practical_content_issues(p_blocks jsonb, p_subject text, p_preheader text, p_event_id uuid, p_event_url text) TO "service_role";

-- absent · public._crm_practical_link_issue(p_url text, p_event_url text)
CREATE OR REPLACE FUNCTION public._crm_practical_link_issue(p_url text, p_event_url text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url text := lower(btrim(COALESCE(p_url, '')));
  v_host text;
  v_path text;
  v_ev text := lower(btrim(COALESCE(p_event_url, '')));
BEGIN
  IF v_url = '' OR v_url LIKE 'mailto:%' OR v_url LIKE 'tel:%' OR v_url LIKE '#%' THEN
    RETURN NULL;
  END IF;
  -- Variables du Studio ({{…}}) : seule {{event.tickets_url}} mènerait à la
  -- vente, et elle n'existe que dans le HTML libre, refusé à part.
  IF v_url LIKE '%{{%' THEN RETURN 'link_variable'; END IF;
  IF v_url !~ '^https?://' THEN v_url := 'https://' || v_url; END IF;
  v_host := regexp_replace(substring(v_url FROM '^https?://([^/?#]+)'), '^www\.', '');
  v_path := COALESCE(substring(v_url FROM '^https?://[^/?#]+(/[^?#]*)'), '/');

  IF v_url ~ '[?&](promo|coupon|discount|code|codigo|voucher)[a-z_]*=' THEN
    RETURN 'link_promo';
  END IF;

  IF v_host IN ('yunoapp.eu', 'crm.yunoapp.eu', 'landing.yunoapp.eu') THEN
    RETURN 'link_sales';
  END IF;

  IF v_host LIKE '%shotgun.live' THEN
    IF v_ev <> '' AND split_part(split_part(regexp_replace(v_url, '^https?://(www\.)?', ''), '?', 1), '#', 1)
                     = split_part(split_part(regexp_replace(v_ev, '^https?://(www\.)?', ''), '?', 1), '#', 1) THEN
      RETURN NULL;
    END IF;
    RETURN 'link_other_event';
  END IF;

  IF v_host ~ '(^|\.)(dice\.fm|fourvenues\.com|whan\.es|eventbrite\.[a-z.]+|weezevent\.com|billetweb\.fr|ticketmaster\.[a-z.]+|fnacspectacles\.com|ra\.co|residentadvisor\.net|xceed\.me|seetickets\.com|helloasso\.com|yurplan\.com|tickettailor\.com|festicket\.com|universe\.com|fever\.?up\.com|feverup\.com|digitick\.com|eventim\.[a-z.]+)$' THEN
    RETURN 'link_ticketing';
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_practical_link_issue(p_url text, p_event_url text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_practical_link_issue(p_url text, p_event_url text) TO "service_role";

-- absent · public._crm_practical_night_state(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid, p_campaign_id uuid)
CREATE OR REPLACE FUNCTION public._crm_practical_night_state(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rules jsonb := public.crm_practical_email_rules();
  e record;
  v_role text;
  v_sent integer;
  v_window timestamptz;
  v_reason text;
BEGIN
  SELECT ev.id, ev.title, ev.start_at, ev.end_at, ev.external_source, ev.external_ticket_url
    INTO e
    FROM public.events ev
   WHERE ev.id = p_event_id
     AND ev.external_source IS NOT NULL
     AND public.marketing_scope_match(ev.venue_id, ev.organizer_user_id, p_venue_id, p_organizer_user_id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'not_mirror');
  END IF;

  SELECT xe.external_role INTO v_role
    FROM public.external_events xe
   WHERE xe.event_id = p_event_id
   ORDER BY (xe.external_role = 'organizer') DESC, (xe.external_role = 'editor') DESC
   LIMIT 1;

  SELECT count(*) INTO v_sent
    FROM public.email_campaigns c
   WHERE c.practical AND c.event_id = p_event_id
     AND public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
     AND c.status IN ('scheduled', 'sending', 'paused', 'sent')
     AND (p_campaign_id IS NULL OR c.id <> p_campaign_id);

  v_window := COALESCE(e.end_at, e.start_at + interval '8 hours')
              + make_interval(hours => (v_rules->>'hours_after_end')::integer);

  v_reason := CASE
    WHEN v_role IS NULL OR NOT (v_rules->'roles') ? v_role THEN 'role'
    WHEN now() > v_window THEN 'window'
    WHEN v_sent >= (v_rules->>'max_per_night')::integer THEN 'limit'
  END;

  RETURN jsonb_build_object(
    'eligible', v_reason IS NULL,
    'reason', v_reason,
    'role', v_role,
    'title', e.title,
    'start_at', e.start_at,
    'end_at', e.end_at,
    'ticket_url', e.external_ticket_url,
    'window_end', v_window,
    'sent', v_sent,
    'max', (v_rules->>'max_per_night')::integer
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_practical_night_state(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid, p_campaign_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_practical_night_state(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid, p_campaign_id uuid) TO "service_role";

-- absent · public._crm_practical_text_issue(p_text text)
CREATE OR REPLACE FUNCTION public._crm_practical_text_issue(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT (regexp_match(
    ' ' || lower(extensions.unaccent(COALESCE(p_text, ''))) || ' ',
    '(code promo|promo code|codigo promocional|code de reduction|code reduc|'
    || 'reduction|remise|discount|descuento|rebaja|'
    || '[-−–][[:space:]]?[0-9]{1,2}[[:space:]]?%|[0-9]{1,2}[[:space:]]?% (off|de reduction|de descuento)|'
    || 'prevente|pre-vente|presale|pre-sale|preventa|early bird|'
    || 'billets? en vente|tickets? on sale|entradas a la venta|'
    || 'derniers? billets|dernieres places|last tickets|ultimas entradas|'
    || 'prends ta place|prenez vos places|get your tickets?|consigue tu entrada|compra tu entrada|'
    || 'reserve ta table|reservez votre table|book (a|your) table|reserva tu mesa|'
    || 'prochaine soiree|prochaines soirees|next party|next event|proxima fiesta|proximo evento)'
  ))[1];
$function$;
REVOKE ALL ON FUNCTION public._crm_practical_text_issue(p_text text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_practical_text_issue(p_text text) TO "service_role";

-- rewritten · public._crm_scenario_advance(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_started timestamp with time zone, p_demo boolean, p_hold text) · dépôt : 20261016130000_crm_scenario_engine.sql
CREATE OR REPLACE FUNCTION public._crm_scenario_advance(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_started timestamp with time zone, p_demo boolean, p_hold text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_round  integer;
  v_pair   record;
  s        public.crm_scenarios%ROWTYPE;
  v        public.crm_scenario_versions%ROWTYPE;
  n        jsonb;
  v_t      text;
  v_sql    text;
  v_ev     record;
  v_moved  integer := 0;
  v_exits  integer := 0;
  v_sent   integer := 0;
  v_k      integer;
  v_res    jsonb;
BEGIN
  FOR v_round IN 1..32 LOOP
    EXIT WHEN clock_timestamp() - p_started > interval '4 seconds';
    TRUNCATE _scn_due;
    INSERT INTO _scn_due (id)
    SELECT r.id FROM public.crm_scenario_runs r
      JOIN public.crm_scenarios sc ON sc.id = r.scenario_id AND sc.status = 'active'
     WHERE r.scope_key = p_scope AND r.status = 'active' AND r.due_at <= now()
     ORDER BY r.due_at LIMIT 2000
     FOR UPDATE OF r SKIP LOCKED;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM _scn_due);

    -- Sorties forcées (non réglables).
    WITH x AS (
      SELECT r.id, CASE
               WHEN EXISTS (SELECT 1 FROM public.crm_profile_optouts o WHERE o.scope_key = p_scope AND o.email = r.email) THEN 'optout'
               WHEN public.is_email_suppressed(r.email) THEN 'suppressed'
               WHEN EXISTS (SELECT 1 FROM public.newsletter_subscriptions ns
                             WHERE lower(ns.email) = r.email AND ns.opted_out_at IS NOT NULL AND NOT COALESCE(ns.opted_in, false)
                               AND ns.venue_id IS NOT DISTINCT FROM p_venue_id AND ns.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN 'unsubscribed'
               WHEN EXISTS (SELECT 1 FROM public.venue_sms_contacts vc JOIN public.sms_stop_list st ON st.phone_e164 = vc.phone_e164
                             WHERE lower(vc.email) = r.email AND (st.scope_key IS NULL OR st.scope_key = p_scope)
                               AND vc.venue_id IS NOT DISTINCT FROM p_venue_id
                               AND (p_venue_id IS NOT NULL OR vc.organizer_user_id = p_organizer_user_id)) THEN 'stop'
               WHEN r.event_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = r.event_id AND e.cancelled_at IS NOT NULL) THEN 'event_cancelled'
             END AS why
        FROM public.crm_scenario_runs r JOIN _scn_due d ON d.id = r.id
    ), done AS (
      UPDATE public.crm_scenario_runs r SET status = 'exited', exit_reason = x.why, updated_at = now()
        FROM x WHERE r.id = x.id AND x.why IS NOT NULL
      RETURNING r.id
    )
    DELETE FROM _scn_due d USING done WHERE d.id = done.id;
    GET DIAGNOSTICS v_k = ROW_COUNT;
    v_exits := v_exits + v_k;

    -- Objectif atteint : sortie, comptée (l'heure de l'achat ou du scan fait foi).
    -- En ensembles : une jointure, jamais une sous-requête par personne.
    WITH rr AS (
      SELECT r.id, r.email, r.event_id, r.entered_at, vv.graph->'goal'->>'type' AS gt
        FROM public.crm_scenario_runs r
        JOIN _scn_due d ON d.id = r.id
        JOIN public.crm_scenario_versions vv ON vv.id = r.version_id
       WHERE jsonb_typeof(vv.graph->'goal') = 'object'
    ), gl AS (
      SELECT rr.id,
             min(CASE WHEN rr.gt IN ('bought_event', 'bought_any') AND public._crm_ticket_is_sale(t.status, t.deal_channel)
                           AND COALESCE(t.purchased_at, t.first_seen_at) >= rr.entered_at
                           AND (rr.gt = 'bought_any' OR t.event_id = rr.event_id)
                      THEN COALESCE(t.purchased_at, t.first_seen_at)
                      WHEN rr.gt = 'entered' AND t.event_id = rr.event_id AND t.scanned_at IS NOT NULL
                      THEN t.scanned_at END) AS at
        FROM rr
        JOIN public.external_tickets t ON lower(t.buyer_email) = rr.email
         AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id) OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
       GROUP BY rr.id
    ), done AS (
      UPDATE public.crm_scenario_runs r SET status = 'exited', exit_reason = 'goal', goal_at = gl.at, updated_at = now()
        FROM gl WHERE r.id = gl.id AND gl.at IS NOT NULL
      RETURNING r.id
    )
    DELETE FROM _scn_due d USING done WHERE d.id = done.id;
    GET DIAGNOSTICS v_k = ROW_COUNT;
    v_exits := v_exits + v_k;

    -- Les nœuds, par paquet (version, nœud).
    FOR v_pair IN
      SELECT r.version_id, r.node_id, count(*) AS k
        FROM public.crm_scenario_runs r JOIN _scn_due d ON d.id = r.id
       GROUP BY r.version_id, r.node_id
    LOOP
      EXIT WHEN clock_timestamp() - p_started > interval '4 seconds';
      SELECT * INTO v FROM public.crm_scenario_versions WHERE id = v_pair.version_id;
      SELECT * INTO s FROM public.crm_scenarios WHERE id = v.scenario_id;
      n := v.graph->'nodes'->v_pair.node_id;
      v_t := n->>'type';
      TRUNCATE _scn_grp;
      INSERT INTO _scn_grp (id, email, event_id, entered_at, node_since, holdout, last_message_at, version_id, scope_key)
      SELECT r.id, r.email, r.event_id, r.entered_at, r.node_since, r.holdout, r.last_message_at, r.version_id, r.scope_key
        FROM public.crm_scenario_runs r JOIN _scn_due d ON d.id = r.id
       WHERE r.version_id = v_pair.version_id AND r.node_id = v_pair.node_id;

      IF n IS NULL OR v_t = 'end' THEN
        UPDATE _scn_grp SET next_id = NULL, go_next = true;
      ELSIF v_t = 'wait' AND n->>'mode' = 'duration' THEN
        UPDATE _scn_grp g SET go_next = true, next_id = n->>'next'
         WHERE g.node_since + make_interval(hours => (n->>'hours')::integer) <= now();
        UPDATE public.crm_scenario_runs r SET due_at = g.node_since + make_interval(hours => (n->>'hours')::integer)
          FROM _scn_grp g WHERE r.id = g.id AND NOT g.go_next;
      ELSIF v_t = 'wait' AND n->>'mode' = 'until_event' THEN
        -- Une heure par soirée (pas par personne).
        UPDATE _scn_grp g SET retry_at = et.at
          FROM (SELECT x.event_id, public._crm_scenario_event_time(x.event_id, n) AS at
                  FROM (SELECT DISTINCT y.event_id FROM _scn_grp y) x) et
         WHERE et.event_id IS NOT DISTINCT FROM g.event_id;
        UPDATE _scn_grp g SET go_next = true, next_id = n->>'next' WHERE g.retry_at IS NULL OR g.retry_at <= now();
        UPDATE public.crm_scenario_runs r SET due_at = g.retry_at FROM _scn_grp g WHERE r.id = g.id AND NOT g.go_next;
      ELSIF v_t IN ('branch', 'wait') THEN
        -- Une condition : la même compilation que le filtre (le chiffre = l'envoi).
        PERFORM public._crm_scenario_need_cp(p_venue_id, p_organizer_user_id);
        FOR v_ev IN SELECT DISTINCT g.event_id FROM _scn_grp g LOOP
          v_sql := public._crm_cond_sql(public._crm_cond_resolve(p_scope, n->'cond', v_ev.event_id), 'p', 'r');
          EXECUTE format('UPDATE _scn_grp g SET cond_ok = true FROM _cp p, public.crm_scenario_runs r
                           WHERE p.email = g.email AND r.id = g.id AND g.event_id IS NOT DISTINCT FROM %L::uuid AND (%s)',
                         v_ev.event_id, v_sql);
        END LOOP;
        IF v_t = 'branch' THEN
          UPDATE _scn_grp g SET go_next = true, next_id = CASE WHEN g.cond_ok THEN n->>'yes' ELSE n->>'no' END;
        ELSE
          UPDATE _scn_grp g SET go_next = true, next_id = n->>'next' WHERE g.cond_ok;
          UPDATE _scn_grp g SET go_next = true, next_id = n->>'timeout'
           WHERE NOT g.go_next AND g.node_since + make_interval(hours => (n->>'max_hours')::integer) <= now();
          UPDATE public.crm_scenario_runs r
             SET due_at = LEAST(g.node_since + make_interval(hours => (n->>'max_hours')::integer), now() + interval '1 hour')
            FROM _scn_grp g WHERE r.id = g.id AND NOT g.go_next;
        END IF;
      ELSIF v_t = 'split' THEN
        -- Test A/B déterministe : la même personne prend toujours le même chemin.
        UPDATE _scn_grp g SET go_next = true, next_id = pth.nxt
          FROM (SELECT y.id, (SELECT pa.value->>'next'
                                FROM (SELECT z.value, sum((z.value->>'pct')::integer) OVER (ORDER BY z.o) AS cum
                                        FROM jsonb_array_elements(n->'paths') WITH ORDINALITY AS z(value, o)) pa
                               WHERE (abs(hashtext(y.id::text || ':' || v_pair.node_id)) % 100) < pa.cum
                               ORDER BY pa.cum LIMIT 1) AS nxt
                  FROM _scn_grp y) pth
         WHERE pth.id = g.id;
      ELSIF v_t IN ('email', 'sms') THEN
        v_res := public._crm_scenario_message(s, v, v_pair.node_id, n, p_demo, p_hold);
        v_sent := v_sent + COALESCE((v_res->>'sent')::integer, 0);
        UPDATE _scn_grp g SET next_id = n->>'next' WHERE g.go_next;
      ELSIF v_t = 'tag' THEN
        IF NOT p_demo THEN
          INSERT INTO public.crm_contact_notes (scope_key, email, venue_id, organizer_user_id, tags, updated_at)
          SELECT p_scope, g.email, p_venue_id, p_organizer_user_id,
                 CASE WHEN n->>'op' = 'add' THEN ARRAY[btrim(n->>'tag')] ELSE '{}'::text[] END, now()
            FROM _scn_grp g WHERE NOT g.holdout
          ON CONFLICT (scope_key, email) DO UPDATE
            SET tags = CASE WHEN n->>'op' = 'add'
                            THEN (SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(crm_contact_notes.tags, '{}') || ARRAY[btrim(n->>'tag')]) x)
                            ELSE array_remove(COALESCE(crm_contact_notes.tags, '{}'), btrim(n->>'tag')) END,
                updated_at = now();
        END IF;
        UPDATE _scn_grp g SET go_next = true, next_id = n->>'next';
      ELSIF v_t = 'notify' THEN
        INSERT INTO public.crm_scenario_notify_daily (scenario_id, node_id, day, n)
        SELECT s.id, v_pair.node_id, current_date, count(*) FROM _scn_grp
        ON CONFLICT (scenario_id, node_id, day) DO UPDATE SET n = crm_scenario_notify_daily.n + EXCLUDED.n;
        UPDATE _scn_grp g SET go_next = true, next_id = n->>'next';
      ELSE
        -- Nœud inconnu (version ancienne) : la personne sort proprement.
        UPDATE _scn_grp g SET go_next = true, next_id = NULL;
      END IF;

      -- Registre (nœuds non-messages) et passage au suivant.
      IF v_t IS NULL OR v_t NOT IN ('email', 'sms') THEN
        INSERT INTO public.crm_scenario_steps (run_id, node_id, scenario_id, version_id, status, done_at)
        SELECT g.id, v_pair.node_id, s.id, v.id, 'passed', now() FROM _scn_grp g WHERE g.go_next
        ON CONFLICT (run_id, node_id, pass) DO NOTHING;
      END IF;
      UPDATE public.crm_scenario_runs r
         SET node_id = g.next_id, node_since = now(), due_at = now(), updated_at = now(),
             status = CASE WHEN g.next_id IS NULL OR v_t = 'end' THEN 'done' ELSE r.status END,
             exit_reason = CASE WHEN g.next_id IS NULL OR v_t = 'end' THEN 'end' ELSE r.exit_reason END
        FROM _scn_grp g WHERE r.id = g.id AND g.go_next;
      GET DIAGNOSTICS v_k = ROW_COUNT;
      v_moved := v_moved + v_k;
      -- Ce paquet est traité pour ce tour.
      DELETE FROM _scn_due d USING _scn_grp g WHERE d.id = g.id;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('moved', v_moved, 'exits', v_exits, 'sent', v_sent);
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_scenario_advance(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_started timestamp with time zone, p_demo boolean, p_hold text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_scenario_advance(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_started timestamp with time zone, p_demo boolean, p_hold text) TO "service_role";

-- rewritten · public._crm_scenario_candidates(p_s crm_scenarios, p_graph jsonb, p_published timestamp with time zone, p_ticket_mark timestamp with time zone, p_signup_mark timestamp with time zone, p_dry boolean) · dépôt : 20261016130000_crm_scenario_engine.sql
CREATE OR REPLACE FUNCTION public._crm_scenario_candidates(p_s crm_scenarios, p_graph jsonb, p_published timestamp with time zone, p_ticket_mark timestamp with time zone, p_signup_mark timestamp with time zone, p_dry boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t       jsonb := p_graph->'trigger';
  tt      text := p_graph->'trigger'->>'type';
  v_venue text := p_s.venue_id;
  v_org   uuid := p_s.organizer_user_id;
  v_key   text := p_s.scope_key;
  v_n     integer := 0;
  v_def   jsonb;
  v_evs   uuid[];
BEGIN
  TRUNCATE _scn_cand;

  IF tt IN ('event_published', 'before_event') THEN
    -- Les soirées dues aujourd'hui ; la base entière en est l'audience.
    SELECT array_agg(e.id) INTO v_evs
      FROM public.events e
      LEFT JOIN LATERAL (SELECT x.published_at FROM public.external_events x WHERE x.event_id = e.id ORDER BY x.synced_at DESC LIMIT 1) x ON true
     WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL AND e.status = 'active'
       AND ((v_venue IS NOT NULL AND e.venue_id = v_venue) OR (v_org IS NOT NULL AND e.organizer_user_id = v_org))
       AND e.start_at > now()
       -- Une soirée dont la base a déjà été lue en entier n'est pas relue.
       AND NOT (COALESCE(p_s.trigger_state->'done', '[]'::jsonb) ? e.id::text)
       AND CASE tt
             -- Publiée depuis la mise en ligne du scénario, il y a moins de 48 h.
             WHEN 'event_published' THEN COALESCE(x.published_at, e.created_at) >= p_published
                                     AND COALESCE(x.published_at, e.created_at) > now() - interval '48 hours'
                                     AND e.start_at > now() + interval '24 hours'
             -- Le jour J-N, heure de la soirée.
             ELSE ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date - (t->>'days')::integer)
                  = (now() AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
                  AND (t->>'series' IS NULL OR lower(public._crm_night_series(e.title)) = lower(t->>'series'))
                  AND (t->>'genre' IS NULL OR lower(t->>'genre') = ANY (
                        SELECT lower(btrim(g)) FROM unnest(COALESCE(e.music_genres, '{}'::text[]) || ARRAY[e.music_genre]) g WHERE g IS NOT NULL))
           END;
    IF v_evs IS NOT NULL THEN
      PERFORM public._crm_scenario_need_cp(v_venue, v_org);
      INSERT INTO _scn_cand (email, event_id, window_end)
      SELECT p.email, e.id,
             CASE WHEN tt = 'event_published' THEN LEAST(e.start_at, now() + interval '48 hours') ELSE e.start_at END
        FROM _cp p CROSS JOIN public.events e WHERE e.id = ANY (v_evs)
      ON CONFLICT DO NOTHING;
    END IF;

  ELSIF tt = 'after_event' THEN
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT DISTINCT lower(tk.buyer_email), e.id,
           COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(hours => (t->>'hours')::integer) + interval '24 hours'
      FROM public.events e
      JOIN public.external_tickets tk ON tk.event_id = e.id AND tk.buyer_email IS NOT NULL
     WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL
       AND ((v_venue IS NOT NULL AND e.venue_id = v_venue) OR (v_org IS NOT NULL AND e.organizer_user_id = v_org))
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(hours => (t->>'hours')::integer) <= now()
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') + make_interval(hours => (t->>'hours')::integer) > now() - interval '24 hours'
       AND COALESCE(e.end_at, e.start_at + interval '6 hours') >= p_published - interval '24 hours'
       AND NOT (COALESCE(p_s.trigger_state->'done', '[]'::jsonb) ? e.id::text)
       AND CASE t->>'who'
             WHEN 'entered' THEN tk.scanned_at IS NOT NULL
             -- Absents : seulement si la porte a scanné (sinon « pas scanné » ne veut pas dire « pas venu »).
             WHEN 'absent_buyers' THEN tk.scanned_at IS NULL AND public._crm_ticket_is_sale(tk.status, tk.deal_channel)
                                       AND public._crm_event_scan_known(e.id)
                                       AND NOT EXISTS (SELECT 1 FROM public.external_tickets t2
                                                        WHERE t2.event_id = e.id AND lower(t2.buyer_email) = lower(tk.buyer_email)
                                                          AND t2.scanned_at IS NOT NULL)
             ELSE tk.status IN ('valid', 'transferred')
           END
    ON CONFLICT DO NOTHING;

  ELSIF tt = 'ticket_bought' THEN
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT DISTINCT ON (lower(tk.buyer_email), tk.event_id) lower(tk.buyer_email), tk.event_id,
           COALESCE(tk.purchased_at, tk.first_seen_at) + interval '48 hours'
      FROM public.external_tickets tk
      JOIN public.events e ON e.id = tk.event_id
     WHERE ((v_venue IS NOT NULL AND tk.venue_id = v_venue) OR (v_org IS NOT NULL AND tk.organizer_user_id = v_org))
       AND tk.buyer_email IS NOT NULL AND public._crm_ticket_is_sale(tk.status, tk.deal_channel)
       -- Vu par la synchro depuis le dernier passage (l'heure d'achat peut précéder la synchro).
       AND tk.first_seen_at > GREATEST(COALESCE(p_ticket_mark, p_published), p_published)
       AND COALESCE(tk.purchased_at, tk.first_seen_at) > now() - interval '48 hours'
       AND (t->>'series' IS NULL OR lower(public._crm_night_series(e.title)) = lower(t->>'series'))
       AND (NOT COALESCE((t->>'first')::boolean, false) OR NOT EXISTS (
              SELECT 1 FROM public.external_tickets t0
               WHERE ((v_venue IS NOT NULL AND t0.venue_id = v_venue) OR (v_org IS NOT NULL AND t0.organizer_user_id = v_org))
                 AND lower(t0.buyer_email) = lower(tk.buyer_email) AND public._crm_ticket_is_sale(t0.status, t0.deal_channel)
                 AND COALESCE(t0.purchased_at, t0.first_seen_at) < COALESCE(tk.purchased_at, tk.first_seen_at)
                 AND t0.event_id IS DISTINCT FROM tk.event_id))
     ORDER BY lower(tk.buyer_email), tk.event_id, COALESCE(tk.purchased_at, tk.first_seen_at)
    ON CONFLICT DO NOTHING;

  ELSIF tt = 'signup_confirmed' THEN
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT DISTINCT lower(en.email), pg.event_id, en.confirmed_at + interval '48 hours'
      FROM public.crm_signup_entries en
      JOIN public.crm_signup_pages pg ON pg.id = en.page_id
     WHERE pg.id = (t->>'page_id')::uuid
       AND pg.venue_id IS NOT DISTINCT FROM v_venue AND pg.organizer_user_id IS NOT DISTINCT FROM v_org
       AND en.email IS NOT NULL AND en.confirmed_at IS NOT NULL
       AND en.confirmed_at > GREATEST(COALESCE(p_signup_mark, p_published), p_published)
       AND en.confirmed_at > now() - interval '48 hours'
    ON CONFLICT DO NOTHING;

  ELSIF tt = 'chance_high' THEN
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT sc.email, sc.event_id, e.start_at - interval '2 hours'
      FROM public.crm_person_night_score sc
      JOIN public.events e ON e.id = sc.event_id
     WHERE sc.scope_key = v_key AND sc.label = 'high'
       AND e.start_at > now() + interval '24 hours' AND e.cancelled_at IS NULL
       -- Les chances changent la nuit : une lecture par soirée et par jour.
       AND NOT (COALESCE(p_s.trigger_state->'done', '[]'::jsonb)
                ? (e.id::text || ':' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')))
       AND NOT public._email_event_holder(e.id, sc.email)
    ON CONFLICT DO NOTHING;

  ELSIF tt = 'click_no_buy' THEN
    -- Un clic NOMINATIF dans un e-mail de la portée vers la billetterie d'une
    -- soirée à venir, il y a N heures (fenêtre de 24 h), puis aucune place.
    INSERT INTO _scn_cand (email, event_id, window_end)
    SELECT k.em, k.event_id, LEAST(k.last_click + make_interval(hours => (t->>'hours')::integer) + interval '24 hours',
                                   e.start_at - interval '2 hours')
      FROM (
        SELECT lower(ev.recipient_email) AS em, c.event_id, max(ev.created_at) AS last_click
          FROM public.email_campaign_events ev
          JOIN public.email_campaigns c ON c.id = ev.campaign_id
          JOIN public.events e2 ON e2.id = c.event_id
         WHERE ev.event_type = 'clicked' AND ev.recipient_email IS NOT NULL
           AND c.venue_id IS NOT DISTINCT FROM v_venue AND c.organizer_user_id IS NOT DISTINCT FROM v_org
           AND e2.external_ticket_url IS NOT NULL
           AND public._link_base(ev.metadata->'click'->>'link') = public._link_base(e2.external_ticket_url)
           AND ev.created_at > now() - make_interval(hours => (t->>'hours')::integer) - interval '24 hours'
         GROUP BY 1, 2
      ) k
      JOIN public.events e ON e.id = k.event_id
     WHERE k.last_click <= now() - make_interval(hours => (t->>'hours')::integer)
       AND k.last_click >= p_published
       AND e.start_at > now() + interval '2 hours' AND e.cancelled_at IS NULL
       AND NOT public._email_event_holder(e.id, k.em)
    ON CONFLICT DO NOTHING;

  ELSIF tt IN ('segment_joined', 'manual_segment', 'absence') THEN
    IF tt = 'manual_segment' AND COALESCE((p_s.trigger_state->>'manual_done')::boolean, false) THEN RETURN 0; END IF;
    IF tt = 'absence' AND COALESCE(p_s.trigger_state->'done', '[]'::jsonb)
                          ? ('day:' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')) THEN RETURN 0; END IF;
    IF tt = 'segment_joined' AND COALESCE(p_s.trigger_state->>'day', '') = to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')
       AND COALESCE((p_s.trigger_state->>'baseline')::boolean, false) THEN RETURN 0; END IF;
    PERFORM public._crm_scenario_need_cp(v_venue, v_org);
    IF tt = 'absence' THEN
      INSERT INTO _scn_cand (email, event_id, window_end)
      SELECT p.email, NULL, now() + interval '24 hours'
        FROM _cp p
       WHERE p.last_night < now() - make_interval(days => (t->>'days')::integer)
         AND p.last_night >= now() - make_interval(days => (t->>'days')::integer) - interval '1 day'
         AND NOT p.upcoming
      ON CONFLICT DO NOTHING;
    ELSE
      SELECT s.definition INTO v_def FROM public.crm_segments s
       WHERE s.id = (t->>'segment_id')::uuid AND s.scope_key = v_key;
      IF v_def IS NULL THEN RETURN 0; END IF;
      EXECUTE format('INSERT INTO _scn_cand (email, event_id, window_end) SELECT p.email, NULL, now() + interval ''7 days'' FROM _cp p WHERE %s ON CONFLICT DO NOTHING',
                     public._crm_filter_sql(v_def, 'p'));
      IF tt = 'segment_joined' THEN
        IF NOT COALESCE((p_s.trigger_state->>'baseline')::boolean, false) THEN
          -- Première lecture : la base est posée, personne n'entre.
          IF p_dry THEN TRUNCATE _scn_cand; RETURN 0; END IF;
          INSERT INTO public.crm_scenario_seen (scenario_id, email) SELECT p_s.id, c.email FROM _scn_cand c ON CONFLICT DO NOTHING;
          TRUNCATE _scn_cand;
          UPDATE public.crm_scenarios SET trigger_state = trigger_state || jsonb_build_object('baseline', true, 'day',
                   to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')) WHERE id = p_s.id;
          RETURN 0;
        END IF;
        -- Les nouveaux membres seulement ; ils rejoignent la base.
        DELETE FROM _scn_cand c USING public.crm_scenario_seen sn WHERE sn.scenario_id = p_s.id AND sn.email = c.email;
        IF p_dry THEN SELECT count(*) INTO v_n FROM _scn_cand; RETURN v_n; END IF;
        INSERT INTO public.crm_scenario_seen (scenario_id, email) SELECT p_s.id, c.email FROM _scn_cand c ON CONFLICT DO NOTHING;
        UPDATE public.crm_scenarios SET trigger_state = trigger_state || jsonb_build_object('day',
                 to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')) WHERE id = p_s.id;
      ELSIF NOT p_dry THEN
        UPDATE public.crm_scenarios SET trigger_state = trigger_state || '{"manual_done": true}'::jsonb WHERE id = p_s.id;
      END IF;
    END IF;
  END IF;

  SELECT count(*) INTO v_n FROM _scn_cand;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_scenario_candidates(p_s crm_scenarios, p_graph jsonb, p_published timestamp with time zone, p_ticket_mark timestamp with time zone, p_signup_mark timestamp with time zone, p_dry boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_scenario_candidates(p_s crm_scenarios, p_graph jsonb, p_published timestamp with time zone, p_ticket_mark timestamp with time zone, p_signup_mark timestamp with time zone, p_dry boolean) TO "service_role";

-- rewritten · public._crm_score_journal(p_scope text, p_venue_id text, p_organizer_user_id uuid) · dépôt : 20261013110000_crm_prediction_journal.sql
CREATE OR REPLACE FUNCTION public._crm_score_journal(p_scope text, p_venue_id text, p_organizer_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  -- Les soirées notées cette nuit, et leur nombre de jours restants
  -- (calendrier du fuseau de la soirée).
  DROP TABLE IF EXISTS _jev;
  CREATE TEMP TABLE _jev ON COMMIT DROP AS
  SELECT e.id AS event_id,
         ((e.start_at AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date
           - (now() AT TIME ZONE COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'))::date) AS days_left
    FROM public.events e
   WHERE e.id IN (SELECT DISTINCT s.event_id FROM public.crm_person_night_score s WHERE s.scope_key = p_scope);

  -- Les audiences « Qui cibler » de chaque soirée : la même porte que l'écran.
  DROP TABLE IF EXISTS _jaud;
  CREATE TEMP TABLE _jaud ON COMMIT DROP AS
  SELECT j.event_id, t.email, a.aud
    FROM _jev j
   CROSS JOIN unnest(ARRAY['likely', 'concept', 'lineup', 'genre', 'early', 'last_minute', 'once_local']) a(aud)
   CROSS JOIN LATERAL public._crm_night_target_set(p_scope, j.event_id, a.aud) t;
  CREATE INDEX ON _jaud (event_id, email);

  INSERT INTO public.crm_prediction_nights AS n (scope_key, venue_id, organizer_user_id, event_id, snapshot_on, snapshot_at,
    days_left, sold, buyers, scored, expected_known, band, remaining_share, newcomers_est, audiences)
  SELECT p_scope, p_venue_id, p_organizer_user_id, j.event_id, current_date, now(), j.days_left,
         (SELECT count(*) FROM public.external_tickets t WHERE t.event_id = j.event_id AND public._crm_ticket_is_sale(t.status, t.deal_channel)),
         (SELECT count(DISTINCT lower(t.buyer_email)) FROM public.external_tickets t
           WHERE t.event_id = j.event_id AND public._crm_ticket_is_sale(t.status, t.deal_channel) AND t.buyer_email IS NOT NULL),
         sc.n, sc.p, 2 * sqrt(sc.v), sn.remaining_share,
         -- Même règle que la projection de l'Admin CRM : la moyenne des
         -- nouveaux des 8 dernières soirées × la part des achats encore à venir.
         (SELECT avg(np.new_people) * COALESCE(sn.remaining_share, 1) FROM (
            SELECT x.new_people FROM public.crm_night_profile x
             WHERE x.scope_key = p_scope AND x.starts_at < now() ORDER BY x.starts_at DESC LIMIT 8) np),
         COALESCE((SELECT jsonb_object_agg(z.aud, jsonb_build_object('n', z.n, 'expected', round(z.p::numeric, 2)))
                     FROM (SELECT g.aud, count(*) AS n, COALESCE(sum(s.p), 0) AS p
                             FROM _jaud g
                             LEFT JOIN public.crm_person_night_score s ON s.scope_key = p_scope AND s.event_id = g.event_id AND s.email = g.email
                            WHERE g.event_id = j.event_id GROUP BY g.aud) z), '{}'::jsonb)
    FROM _jev j
    CROSS JOIN LATERAL (SELECT count(*) AS n, COALESCE(sum(s.p), 0) AS p, COALESCE(sum(s.p * (1 - s.p)), 0) AS v
                          FROM public.crm_person_night_score s WHERE s.scope_key = p_scope AND s.event_id = j.event_id) sc
    LEFT JOIN public.crm_score_night sn ON sn.scope_key = p_scope AND sn.event_id = j.event_id
  ON CONFLICT (scope_key, event_id, snapshot_on) DO UPDATE SET
    snapshot_at = EXCLUDED.snapshot_at, days_left = EXCLUDED.days_left, sold = EXCLUDED.sold, buyers = EXCLUDED.buyers,
    scored = EXCLUDED.scored, expected_known = EXCLUDED.expected_known, band = EXCLUDED.band,
    remaining_share = EXCLUDED.remaining_share, newcomers_est = EXCLUDED.newcomers_est, audiences = EXCLUDED.audiences;

  -- Par personne : sa première chance, puis celle de J-7 ; une seule fois
  -- chacune (une ligne déjà là n'est jamais réécrite).
  INSERT INTO public.crm_prediction_people (scope_key, event_id, horizon, email, snapshot_at, p, label, auds)
  SELECT p_scope, s.event_id, h.h, s.email, now(), s.p, s.label,
         COALESCE((SELECT array_agg(g.aud ORDER BY g.aud) FROM _jaud g WHERE g.event_id = s.event_id AND g.email = s.email), '{}')
    FROM public.crm_person_night_score s
    JOIN _jev j ON j.event_id = s.event_id
   CROSS JOIN (VALUES ('first'), ('d7')) h(h)
   WHERE s.scope_key = p_scope AND (h.h = 'first' OR j.days_left <= 7)
  ON CONFLICT (scope_key, event_id, horizon, email) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_journal(p_scope text, p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_score_journal(p_scope text, p_venue_id text, p_organizer_user_id uuid) TO "service_role";

-- rewritten · public._crm_score_settle(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_now timestamp with time zone) · dépôt : 20261013110000_crm_prediction_journal.sql
CREATE OR REPLACE FUNCTION public._crm_score_settle(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg    jsonb := COALESCE(public.crm_analysis_config()->'score', '{}'::jsonb);
  ev       record;
  h        text;
  v_m      jsonb;
  v_night  record;
  v_done   integer := 0;
  v_pool   record;
BEGIN
  FOR ev IN
    SELECT e.id, e.start_at, e.title
      FROM public.events e
     WHERE e.id IN (SELECT DISTINCT pp.event_id FROM public.crm_prediction_people pp WHERE pp.scope_key = p_scope)
       AND COALESCE(e.end_at, e.start_at + interval '6 hours')
           < p_now - make_interval(hours => COALESCE((v_cfg->>'settle_hours')::int, 48))
  LOOP
    -- Qui a acheté, et quand (ventes seulement, au sens de _crm_ticket_is_sale).
    DROP TABLE IF EXISTS _sbuy;
    CREATE TEMP TABLE _sbuy ON COMMIT DROP AS
    SELECT lower(t.buyer_email) AS em, min(COALESCE(t.purchased_at, t.first_seen_at)) AS first_buy
      FROM public.external_tickets t
     WHERE t.event_id = ev.id AND t.buyer_email IS NOT NULL AND public._crm_ticket_is_sale(t.status, t.deal_channel)
     GROUP BY 1;
    CREATE INDEX ON _sbuy (em);

    FOREACH h IN ARRAY ARRAY['first', 'd7'] LOOP
      DROP TABLE IF EXISTS _sy;
      CREATE TEMP TABLE _sy ON COMMIT DROP AS
      SELECT pp.email, LEAST(GREATEST(pp.p::float8, 1e-6), 1 - 1e-6) AS p, pp.label, pp.auds, pp.snapshot_at,
             CASE WHEN b.first_buy > pp.snapshot_at THEN 1 ELSE 0 END AS y
        FROM public.crm_prediction_people pp
        LEFT JOIN _sbuy b ON b.em = pp.email
       WHERE pp.scope_key = p_scope AND pp.event_id = ev.id AND pp.horizon = h;
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM _sy);

      -- La projection de ce moment-là : premier relevé (`first`) ou premier
      -- relevé à J-7 ou moins (`d7`).
      SELECT n.* INTO v_night FROM public.crm_prediction_nights n
       WHERE n.scope_key = p_scope AND n.event_id = ev.id AND (h = 'first' OR n.days_left <= 7)
       ORDER BY n.snapshot_on LIMIT 1;

      WITH r AS (
        SELECT p, y, rank() OVER (ORDER BY p) + (count(*) OVER (PARTITION BY p) - 1) / 2.0 AS rk FROM _sy
      ), s AS (
        SELECT count(*) AS n, sum(y) AS pos, sum(p) AS sp,
               -avg(y * ln(p) + (1 - y) * ln(1 - p)) AS logloss, avg((p - y) ^ 2) AS brier,
               count(*) FILTER (WHERE y = 1) AS n1, count(*) FILTER (WHERE y = 0) AS n0,
               sum(rk) FILTER (WHERE y = 1) AS r1
          FROM r
      ), b AS (
        SELECT width_bucket(p, 0, 1.0000001, 10) AS k, count(*) AS n, sum(p) AS sp, sum(y) AS sy FROM _sy GROUP BY 1
      )
      SELECT jsonb_build_object(
        'n', s.n, 'buyers', s.pos, 'expected', round(s.sp::numeric, 2),
        'logloss', round(s.logloss::numeric, 5), 'brier', round(s.brier::numeric, 5),
        'auc', CASE WHEN s.n1 > 0 AND s.n0 > 0 THEN round(((s.r1 - s.n1 * (s.n1 + 1) / 2.0) / (s.n1 * s.n0))::numeric, 4) END,
        'ece', (SELECT round((sum(abs(b.sp - b.sy)) / NULLIF(sum(b.n), 0))::numeric, 4) FROM b),
        'buckets', (SELECT jsonb_agg(jsonb_build_object('k', b.k, 'n', b.n, 'p', round(b.sp::numeric, 2), 'y', b.sy) ORDER BY b.k) FROM b),
        'labels', (SELECT jsonb_object_agg(l.label, jsonb_build_object('n', l.n, 'p', round(l.sp::numeric, 2), 'y', l.sy))
                     FROM (SELECT label, count(*) AS n, sum(p) AS sp, sum(y) AS sy FROM _sy GROUP BY 1) l),
        'audiences', (SELECT jsonb_object_agg(a.aud, jsonb_build_object('n', a.n, 'p', round(a.sp::numeric, 2), 'y', a.sy))
                        FROM (SELECT x.aud, count(*) AS n, sum(y.p) AS sp, sum(y.y) AS sy
                                FROM _sy y CROSS JOIN LATERAL unnest(y.auds) x(aud) GROUP BY 1) a),
        'projection', CASE WHEN v_night.event_id IS NOT NULL THEN (
          SELECT jsonb_build_object(
            'snapshot_on', v_night.snapshot_on, 'days_left', v_night.days_left,
            'buyers_at', v_night.buyers, 'expected_known', round(v_night.expected_known::numeric, 1),
            'newcomers_est', round(COALESCE(v_night.newcomers_est, 0)::numeric, 1),
            'predicted', round((v_night.buyers + v_night.expected_known + COALESCE(v_night.newcomers_est, 0))::numeric, 1),
            'actual', t.total, 'actual_known', s.pos,
            -- Nouveaux réels : acheteurs après le relevé qui n'étaient ni notés ni déjà acheteurs.
            'actual_new', (SELECT count(*) FROM _sbuy b2 WHERE b2.first_buy > v_night.snapshot_at
                             AND NOT EXISTS (SELECT 1 FROM public.crm_prediction_people q
                                              WHERE q.scope_key = p_scope AND q.event_id = ev.id AND q.horizon = h AND q.email = b2.em)),
            'err', CASE WHEN t.total > 0 THEN round((abs(v_night.buyers + v_night.expected_known + COALESCE(v_night.newcomers_est, 0) - t.total)
                                                     / t.total)::numeric, 4) END)
            FROM (SELECT count(*) AS total FROM _sbuy) t) END)
        INTO v_m FROM s;

      INSERT INTO public.crm_prediction_results AS x (scope_key, venue_id, organizer_user_id, event_id, horizon, start_at, title, settled_at, metrics)
      VALUES (p_scope, p_venue_id, p_organizer_user_id, ev.id, h, ev.start_at, ev.title, p_now, jsonb_strip_nulls(v_m))
      ON CONFLICT (scope_key, event_id, horizon) DO UPDATE SET metrics = EXCLUDED.metrics, settled_at = EXCLUDED.settled_at;
    END LOOP;

    -- Les chances par personne ne vivent que jusqu'à la comparaison.
    DELETE FROM public.crm_prediction_people WHERE scope_key = p_scope AND event_id = ev.id;
    v_done := v_done + 1;
  END LOOP;

  -- Dérive : calibration des 8 dernières soirées réglées, à J-7, tranches
  -- mises en commun ; au-delà du seuil, une alerte par compte et par semaine.
  IF v_done > 0 THEN
    SELECT sum((b->>'n')::int) AS n, sum(abs((b->>'p')::numeric - (b->>'y')::numeric)) AS gap
      INTO v_pool
      FROM (SELECT r.metrics FROM public.crm_prediction_results r
             WHERE r.scope_key = p_scope AND r.horizon = 'd7' ORDER BY r.start_at DESC LIMIT 8) z
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(z.metrics->'buckets', '[]'::jsonb)) b;
    IF COALESCE(v_pool.n, 0) >= COALESCE((v_cfg->>'drift_min_n')::int, 200)
       AND v_pool.gap / v_pool.n > COALESCE((v_cfg->>'drift_ece')::numeric, 0.08) THEN
      BEGIN
        PERFORM public.emit_admin_notification(
          'admin_crm_score_drift', 'Yuno CRM : « Chances de venir » se décale',
          format('Calibration des 8 dernières soirées à J-7 : %s points d''écart (seuil %s).',
                 round(100 * v_pool.gap / v_pool.n, 1), round(100 * COALESCE((v_cfg->>'drift_ece')::numeric, 0.08), 1)),
          'normal', 'crm_scope', p_scope,
          jsonb_build_object('ece', round(v_pool.gap / v_pool.n, 4), 'n', v_pool.n),
          'crm_score_drift:' || p_scope || ':' || to_char(p_now, 'IYYY-IW'), NULL);
      EXCEPTION WHEN others THEN NULL;  -- une alerte ne fait jamais échouer le calcul
      END;
    END IF;
  END IF;
  RETURN v_done;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_settle(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_now timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_score_settle(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_now timestamp with time zone) TO "service_role";

-- rewritten · public._crm_score_targets(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_cfg jsonb, p_upcoming boolean) · dépôt : 20261014100000_crm_score_timing.sql
CREATE OR REPLACE FUNCTION public._crm_score_targets(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_cfg jsonb, p_upcoming boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res numeric := COALESCE((p_cfg->'rarity'->>'resident_share')::numeric, 0.2);
  v_minb integer := COALESCE((p_cfg->'rarity'->>'min_nights')::integer, 5);
  v_n integer;
BEGIN
  DROP TABLE IF EXISTS _scx;
  IF NOT p_upcoming THEN
    -- Soirées passées : celles chargées par _crm_an_load ; la rareté à leur date.
    CREATE TEMP TABLE _scx ON COMMIT DROP AS
    SELECT n.nid AS xid, n.event_id, n.start_at, n.sale_at AS cutoff, n.series, n.genres, n.fmt, n.slot, n.wd,
           ARRAY(SELECT a.ak FROM _annart a JOIN _anrar r ON r.nid = n.nid AND r.ak = a.ak
                  WHERE a.nid = n.nid AND NOT (r.base >= v_minb AND r.share > v_res)) AS arts
      FROM _ann n
     WHERE n.start_at < now() - interval '12 hours';
  ELSE
    -- Soirées à venir en vente : le line-up, résidents (statistiques du compte)
    -- exclus. Les facteurs se prennent à l'ouverture de la vente (même règle
    -- que _crm_an_load), comme à l'apprentissage ; aujourd'hui au plus tard.
    CREATE TEMP TABLE _scx ON COMMIT DROP AS
    SELECT e.id AS xid, e.event_id, e.start_at,
           LEAST(now(), e.start_at,
                 COALESCE(e.launched_at,
                          (SELECT min(COALESCE(t.purchased_at, t.first_seen_at)) FROM public.external_tickets t
                            WHERE t.connection_id = e.connection_id AND t.external_event_id = e.external_id
                              AND public._crm_ticket_is_sale(t.status, t.deal_channel)),
                          e.published_at, e.start_at - interval '30 days')) AS cutoff,
           public._crm_night_series(e.name) AS series,
           ARRAY(SELECT DISTINCT lower(btrim(g)) FROM unnest(COALESCE(e.genres, '{}')) g WHERE btrim(g) <> '' ORDER BY 1) AS genres,
           lower(NULLIF(btrim(e.type_of_place), '')) AS fmt,
           public._crm_an_slot(e.start_at, COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'), p_cfg) AS slot,
           extract(isodow FROM public._crm_night_date(e.start_at, COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris'), 6))::smallint AS wd,
           ARRAY(SELECT DISTINCT public._crm_artist_key(a)
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.artists) = 'array' THEN e.artists ELSE '[]'::jsonb END) a
                  WHERE public._crm_artist_key(a) IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM public.crm_artist_stats st
                                     WHERE st.scope_key = p_scope AND st.artist_key = public._crm_artist_key(a) AND st.share > v_res)) AS arts
      FROM public.external_events e
      JOIN public.events ev ON ev.id = e.event_id AND ev.cancelled_at IS NULL
     WHERE ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))
       AND e.cancelled_at IS NULL AND e.start_at > now()
       AND e.start_at <= now() + interval '120 days';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_score_targets(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_cfg jsonb, p_upcoming boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_score_targets(p_scope text, p_venue_id text, p_organizer_user_id uuid, p_cfg jsonb, p_upcoming boolean) TO "service_role";

-- rewritten · public._crm_signal_coverage(p_venue_id text, p_organizer_user_id uuid) · dépôt : 20261010100000_crm_analysis_coverage.sql
CREATE OR REPLACE FUNCTION public._crm_signal_coverage(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_cfg jsonb := public.crm_analysis_config();
  v_ok numeric := COALESCE((v_cfg->'coverage'->>'ok')::numeric, 0.5);
  v_min numeric := COALESCE((v_cfg->'coverage'->>'min')::numeric, 0.1);
  v_full numeric := COALESCE((v_cfg->'coverage'->>'multi_holder_full')::numeric, 0.2);
  v_conns jsonb;
  v_tot record;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'scope_required' USING ERRCODE = '22023';
  END IF;

  WITH conn AS (
    SELECT c.id, c.provider, c.status, c.initial_import_done_at
      FROM public.ticketing_connections c
     WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id)
  ), tk AS (
    SELECT t.connection_id, t.external_order_id, lower(t.buyer_email) AS em, t.status, t.deal_channel, t.deal_visibilities, t.seating_type, t.utm,
           t.scanned_at, t.zip_code, t.country_code, t.event_id,
           public._crm_ticket_is_sale(t.status, t.deal_channel) AS sale
      FROM public.external_tickets t JOIN conn ON conn.id = t.connection_id
  ), ord AS (
    SELECT o.connection_id, count(*) AS orders,
           count(*) FILTER (WHERE o.n > 1) AS multi,
           count(*) FILTER (WHERE o.n > 1 AND o.holders > 1) AS multi_holders
      FROM (SELECT connection_id, external_order_id, count(*) AS n, count(DISTINCT em) AS holders
              FROM tk WHERE sale AND external_order_id IS NOT NULL GROUP BY 1, 2) o
     GROUP BY 1
  ), tks AS (
    SELECT connection_id,
           count(*) FILTER (WHERE sale) AS sales,
           count(*) FILTER (WHERE sale AND 'promoters' = ANY (deal_visibilities)) AS promoter_sales,
           count(*) FILTER (WHERE sale AND seating_type IN ('Table', 'Booth')) AS table_sales,
           count(*) FILTER (WHERE sale AND zip_code IS NOT NULL AND btrim(zip_code) <> '') AS with_zip,
           count(*) FILTER (WHERE sale AND country_code IS NOT NULL) AS with_country,
           count(*) FILTER (WHERE status = 'valid') AS valid,
           count(*) FILTER (WHERE status = 'valid' AND scanned_at IS NOT NULL) AS scanned
      FROM tk GROUP BY 1
  ), chan AS (
    SELECT connection_id, jsonb_object_agg(k, n) AS channels
      FROM (SELECT connection_id, COALESCE(NULLIF(deal_channel, ''), 'unknown') AS k, count(*) AS n
              FROM tk GROUP BY 1, 2) z GROUP BY 1
  ), med AS (
    SELECT connection_id, jsonb_object_agg(k, n) AS mediums
      FROM (SELECT connection_id, COALESCE(NULLIF(lower(utm->>'utm_medium'), ''), 'none') AS k, count(*) AS n
              FROM tk WHERE sale GROUP BY 1, 2) z GROUP BY 1
  ), ev AS (
    SELECT e.connection_id,
           count(*) AS nights,
           count(*) FILTER (WHERE jsonb_typeof(e.artists) = 'array' AND jsonb_array_length(e.artists) > 0) AS with_artists,
           count(*) FILTER (WHERE cardinality(e.genres) > 0) AS with_genres,
           count(*) FILTER (WHERE NULLIF(btrim(e.type_of_place), '') IS NOT NULL) AS with_place_type,
           count(*) FILTER (WHERE e.latitude IS NOT NULL AND e.longitude IS NOT NULL) AS with_coords,
           count(*) FILTER (WHERE e.launched_at IS NOT NULL) AS with_launch,
           COALESCE(array_agg(DISTINCT lower(btrim(e.type_of_place))) FILTER (WHERE NULLIF(btrim(e.type_of_place), '') IS NOT NULL), '{}') AS place_values
      FROM public.external_events e JOIN conn ON conn.id = e.connection_id
     WHERE e.cancelled_at IS NULL
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', conn.id, 'provider', conn.provider, 'status', conn.status,
           'imported', conn.initial_import_done_at IS NOT NULL,
           'sales', COALESCE(tks.sales, 0),
           'orders', COALESCE(ord.orders, 0),
           'multi_orders', COALESCE(ord.multi, 0),
           'multi_holder_orders', COALESCE(ord.multi_holders, 0),
           'promoter_sales', COALESCE(tks.promoter_sales, 0),
           'table_sales', COALESCE(tks.table_sales, 0),
           'with_zip', COALESCE(tks.with_zip, 0),
           'with_country', COALESCE(tks.with_country, 0),
           'valid', COALESCE(tks.valid, 0),
           'scanned', COALESCE(tks.scanned, 0),
           'channels', COALESCE(chan.channels, '{}'::jsonb),
           'mediums', COALESCE(med.mediums, '{}'::jsonb),
           'nights', COALESCE(ev.nights, 0),
           'nights_with_artists', COALESCE(ev.with_artists, 0),
           'nights_with_genres', COALESCE(ev.with_genres, 0),
           'nights_with_place_type', COALESCE(ev.with_place_type, 0),
           'nights_with_coords', COALESCE(ev.with_coords, 0),
           'nights_with_launch', COALESCE(ev.with_launch, 0),
           'place_values', to_jsonb(COALESCE(ev.place_values, '{}'::text[]))
         ) ORDER BY conn.id), '[]'::jsonb)
    INTO v_conns
    FROM conn
    LEFT JOIN ord ON ord.connection_id = conn.id
    LEFT JOIN tks ON tks.connection_id = conn.id
    LEFT JOIN chan ON chan.connection_id = conn.id
    LEFT JOIN med ON med.connection_id = conn.id
    LEFT JOIN ev ON ev.connection_id = conn.id;

  -- Totaux de la portée (toutes connexions).
  SELECT COALESCE(sum((c->>'sales')::int), 0) AS sales,
         COALESCE(sum((c->>'orders')::int), 0) AS orders,
         COALESCE(sum((c->>'multi_orders')::int), 0) AS multi,
         COALESCE(sum((c->>'multi_holder_orders')::int), 0) AS multi_holders,
         COALESCE(sum((c->>'promoter_sales')::int), 0) AS promoter_sales,
         COALESCE(sum((c->>'table_sales')::int), 0) AS table_sales,
         COALESCE(sum((c->>'with_zip')::int), 0) AS with_zip,
         COALESCE(sum((c->>'with_country')::int), 0) AS with_country,
         COALESCE(sum((c->>'valid')::int), 0) AS valid,
         COALESCE(sum((c->>'scanned')::int), 0) AS scanned,
         COALESCE(sum((c->>'nights')::int), 0) AS nights,
         COALESCE(sum((c->>'nights_with_artists')::int), 0) AS n_art,
         COALESCE(sum((c->>'nights_with_genres')::int), 0) AS n_gen,
         COALESCE(sum((c->>'nights_with_place_type')::int), 0) AS n_fmt,
         COALESCE(sum((c->>'nights_with_coords')::int), 0) AS n_geo,
         COALESCE(sum((c->>'nights_with_launch')::int), 0) AS n_launch,
         COALESCE(sum(COALESCE((c->'channels'->>'onsite')::int, 0) + COALESCE((c->'channels'->>'venue')::int, 0)), 0) AS door,
         COALESCE(sum(COALESCE((c->'channels'->>'invitation')::int, 0)), 0) AS inv,
         COALESCE(sum(COALESCE((c->'mediums'->>'app')::int, 0) + COALESCE((c->'mediums'->>'website')::int, 0)
                      + COALESCE((c->'mediums'->>'widget')::int, 0)), 0) AS online
    INTO v_tot
    FROM jsonb_array_elements(v_conns) c;

  RETURN jsonb_build_object(
    'rules_version', (v_cfg->>'rules_version')::int,
    'connections', v_conns,
    'totals', jsonb_build_object(
      'sales', v_tot.sales, 'orders', v_tot.orders, 'multi_orders', v_tot.multi,
      'multi_holder_orders', v_tot.multi_holders, 'nights', v_tot.nights,
      'nights_with_artists', v_tot.n_art, 'nights_with_genres', v_tot.n_gen,
      'nights_with_place_type', v_tot.n_fmt, 'nights_with_coords', v_tot.n_geo,
      'nights_with_launch', v_tot.n_launch, 'promoter_sales', v_tot.promoter_sales,
      'table_sales', v_tot.table_sales, 'with_zip', v_tot.with_zip, 'with_country', v_tot.with_country,
      'valid', v_tot.valid, 'scanned', v_tot.scanned, 'door_tickets', v_tot.door,
      'invitations', v_tot.inv, 'online_sales', v_tot.online),
    -- Disponibilité de chaque famille : 'ok' | 'reduced' | 'unavailable'.
    -- Une famille « uniforme » (toutes les soirées pareilles) est décidée par
    -- le moteur, qui voit les valeurs (lot C).
    'families', jsonb_build_object(
      'artist', public._crm_cov_level(v_tot.n_art, v_tot.nights, v_ok, v_min),
      'genre', public._crm_cov_level(v_tot.n_gen, v_tot.nights, v_ok, v_min),
      'format', public._crm_cov_level(v_tot.n_fmt, v_tot.nights, v_ok, v_min),
      'slot', CASE WHEN v_tot.nights > 0 THEN 'ok' ELSE 'unavailable' END,
      'weekday', CASE WHEN v_tot.nights > 0 THEN 'ok' ELSE 'unavailable' END,
      'series', CASE WHEN v_tot.nights > 0 THEN 'ok' ELSE 'unavailable' END,
      'place', public._crm_cov_level(v_tot.n_geo, v_tot.nights, v_ok, v_min),
      'early', CASE WHEN v_tot.sales > 0 THEN 'ok' ELSE 'unavailable' END,
      'launch', public._crm_cov_level(v_tot.n_launch, v_tot.nights, v_ok, v_min),
      'last_minute', CASE WHEN v_tot.sales > 0 THEN 'ok' ELSE 'unavailable' END,
      'door', CASE WHEN v_tot.door > 0 THEN 'ok' ELSE 'unavailable' END,
      -- « Venu avec » exige des détenteurs différents dans une commande ;
      -- sinon la famille se réduit à « achète pour N ».
      'group', CASE WHEN v_tot.multi = 0 THEN 'unavailable'
                    WHEN v_tot.multi_holders::numeric >= v_full * v_tot.multi THEN 'ok'
                    ELSE 'reduced' END,
      'brought', CASE WHEN v_tot.multi_holders > 0 THEN 'ok' ELSE 'unavailable' END,
      'table', CASE WHEN v_tot.table_sales > 0 THEN 'ok' ELSE 'unavailable' END,
      'discovery', CASE WHEN v_tot.online > 0 THEN 'ok' ELSE 'unavailable' END,
      -- Sans code postal : seulement les étrangers (réduit).
      'passing', CASE WHEN v_tot.sales = 0 THEN 'unavailable'
                      WHEN v_tot.with_zip::numeric >= v_ok * v_tot.sales AND v_tot.n_geo > 0 THEN 'ok'
                      WHEN v_tot.with_country > 0 THEN 'reduced'
                      ELSE 'unavailable' END,
      'invited', CASE WHEN v_tot.inv > 0 THEN 'ok' ELSE 'unavailable' END,
      'channel', CASE WHEN v_tot.sales > 0 THEN 'ok' ELSE 'unavailable' END),
    'scan_share', CASE WHEN v_tot.valid > 0 THEN round(v_tot.scanned::numeric / v_tot.valid, 3) END,
    'zip_share', CASE WHEN v_tot.sales > 0 THEN round(v_tot.with_zip::numeric / v_tot.sales, 3) END,
    'launch_share', CASE WHEN v_tot.nights > 0 THEN round(v_tot.n_launch::numeric / v_tot.nights, 3) END,
    'multi_share', CASE WHEN v_tot.orders > 0 THEN round(v_tot.multi::numeric / v_tot.orders, 3) END,
    'multi_holder_share', CASE WHEN v_tot.multi > 0 THEN round(v_tot.multi_holders::numeric / v_tot.multi, 3) END,
    'promoter_share', CASE WHEN v_tot.sales > 0 THEN round(v_tot.promoter_sales::numeric / v_tot.sales, 3) END
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_signal_coverage(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_signal_coverage(p_venue_id text, p_organizer_user_id uuid) TO "service_role";

-- rewritten · public._crm_signup_buyer_ids(p_page_id uuid) · dépôt : 20261007193500_crm_signup_pages_v2.sql
CREATE OR REPLACE FUNCTION public._crm_signup_buyer_ids(p_page_id uuid)
 RETURNS TABLE(entry_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT e.id
    FROM public.crm_signup_pages p
    JOIN public.crm_signup_entries e ON e.page_id = p.id AND e.email IS NOT NULL
    JOIN public.external_tickets t
      ON t.buyer_email = lower(e.email)
     AND ((p.venue_id IS NOT NULL AND t.venue_id = p.venue_id) OR (p.organizer_user_id IS NOT NULL AND t.organizer_user_id = p.organizer_user_id))
     AND public._crm_ticket_is_sale(t.status, t.deal_channel)
     AND COALESCE(t.purchased_at, t.first_seen_at) >= e.created_at
     AND (p.event_id IS NULL OR t.event_id = p.event_id)
   WHERE p.id = p_page_id;
$function$;
REVOKE ALL ON FUNCTION public._crm_signup_buyer_ids(p_page_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_signup_buyer_ids(p_page_id uuid) TO "service_role";

-- rewritten · public._crm_signup_known(p crm_signup_pages, p_email text, p_phone text) · dépôt : 20261007193500_crm_signup_pages_v2.sql
CREATE OR REPLACE FUNCTION public._crm_signup_known(p crm_signup_pages, p_email text, p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (p_email IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.external_tickets t
                     WHERE t.buyer_email = p_email AND public._crm_ticket_is_sale(t.status, t.deal_channel)
                       AND ((p.venue_id IS NOT NULL AND t.venue_id = p.venue_id) OR (p.organizer_user_id IS NOT NULL AND t.organizer_user_id = p.organizer_user_id)))
         OR EXISTS (SELECT 1 FROM public.imported_contacts c
                     WHERE c.email = p_email AND c.venue_id IS NOT DISTINCT FROM p.venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id)
         OR EXISTS (SELECT 1 FROM public.newsletter_subscriptions n
                     WHERE lower(n.email) = p_email AND n.venue_id IS NOT DISTINCT FROM p.venue_id AND n.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id)
         OR EXISTS (SELECT 1 FROM public.crm_signup_entries x JOIN public.crm_signup_pages pp ON pp.id = x.page_id
                     WHERE lower(x.email) = p_email AND pp.id <> p.id
                       AND pp.venue_id IS NOT DISTINCT FROM p.venue_id AND pp.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id)))
      OR (p_phone IS NOT NULL AND (
            EXISTS (SELECT 1 FROM public.imported_contacts c
                     WHERE c.phone_e164 = p_phone AND c.venue_id IS NOT DISTINCT FROM p.venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id)
         OR EXISTS (SELECT 1 FROM public.crm_signup_entries x JOIN public.crm_signup_pages pp ON pp.id = x.page_id
                     WHERE x.phone = p_phone AND pp.id <> p.id
                       AND pp.venue_id IS NOT DISTINCT FROM p.venue_id AND pp.organizer_user_id IS NOT DISTINCT FROM p.organizer_user_id)));
$function$;
REVOKE ALL ON FUNCTION public._crm_signup_known(p crm_signup_pages, p_email text, p_phone text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._crm_signup_known(p crm_signup_pages, p_email text, p_phone text) TO "service_role";

-- absent · public.affiliate_clicks_require_target()
CREATE OR REPLACE FUNCTION public.affiliate_clicks_require_target()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.affiliate_event_id IS NULL AND NEW.affiliate_venue_id IS NULL THEN
    RAISE EXCEPTION 'affiliate click needs an event or a venue' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.affiliate_clicks_require_target() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_clicks_require_target() TO "service_role";

-- rewritten · public.auto_dispute_stale_promoter_payouts() · dépôt : 20260721090000_promoter_payout_reference_dispute.sql
CREATE OR REPLACE FUNCTION public.auto_dispute_stale_promoter_payouts()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  PERFORM set_config('yuno.payout_rpc', 'on', true);

  WITH stale AS (
    UPDATE promoter_payouts
    SET status = 'disputed', disputed_at = now(),
        dispute_reason = 'auto:no_acknowledgement'
    WHERE status = 'approved'
      AND confirm_due_at IS NOT NULL
      AND confirm_due_at < now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM stale;

  RETURN jsonb_build_object('disputed', v_count);
END;
$function$;
REVOKE ALL ON FUNCTION public.auto_dispute_stale_promoter_payouts() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auto_dispute_stale_promoter_payouts() TO "service_role";

-- absent · public.contact_base_cache_fresh(p_built_at timestamp with time zone, p_dirty_at timestamp with time zone)
CREATE OR REPLACE FUNCTION public.contact_base_cache_fresh(p_built_at timestamp with time zone, p_dirty_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT p_built_at > now() - interval '3 minutes'
     AND (p_dirty_at IS NULL OR p_dirty_at < p_built_at);
$function$;
REVOKE ALL ON FUNCTION public.contact_base_cache_fresh(p_built_at timestamp with time zone, p_dirty_at timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contact_base_cache_fresh(p_built_at timestamp with time zone, p_dirty_at timestamp with time zone) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.contact_base_cache_fresh(p_built_at timestamp with time zone, p_dirty_at timestamp with time zone) TO "anon";
GRANT EXECUTE ON FUNCTION public.contact_base_cache_fresh(p_built_at timestamp with time zone, p_dirty_at timestamp with time zone) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.contact_base_cache_fresh(p_built_at timestamp with time zone, p_dirty_at timestamp with time zone) TO "service_role";

-- absent · public.contact_base_cache_invalidate()
CREATE OR REPLACE FUNCTION public.contact_base_cache_invalidate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      UPDATE public.contact_base_cache_state s SET dirty_at = clock_timestamp()
       WHERE s.scope_key IN (SELECT DISTINCT public.contact_base_scope_key(n.venue_id, n.organizer_user_id) FROM new_rows n);
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      UPDATE public.contact_base_cache_state s SET dirty_at = clock_timestamp()
       WHERE s.scope_key IN (SELECT DISTINCT public.contact_base_scope_key(o.venue_id, o.organizer_user_id) FROM old_rows o);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.contact_base_cache_invalidate() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contact_base_cache_invalidate() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.contact_base_cache_invalidate() TO "anon";
GRANT EXECUTE ON FUNCTION public.contact_base_cache_invalidate() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.contact_base_cache_invalidate() TO "service_role";

-- absent · public.contact_base_scope_key(p_venue_id text, p_organizer_user_id uuid)
CREATE OR REPLACE FUNCTION public.contact_base_scope_key(p_venue_id text, p_organizer_user_id uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT COALESCE('v:' || p_venue_id, 'o:' || p_organizer_user_id::text, 'p');
$function$;
REVOKE ALL ON FUNCTION public.contact_base_scope_key(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contact_base_scope_key(p_venue_id text, p_organizer_user_id uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.contact_base_scope_key(p_venue_id text, p_organizer_user_id uuid) TO "anon";
GRANT EXECUTE ON FUNCTION public.contact_base_scope_key(p_venue_id text, p_organizer_user_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.contact_base_scope_key(p_venue_id text, p_organizer_user_id uuid) TO "service_role";

-- rewritten · public.contact_build_rows(p_venue_id text, p_organizer_user_id uuid) · dépôt : 20260915180000_contact_base_engagement.sql
CREATE OR REPLACE FUNCTION public.contact_build_rows(p_venue_id text, p_organizer_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_n integer;
  v_key text := public.contact_base_scope_key(p_venue_id, p_organizer_user_id);
  v_state public.contact_base_cache_state%ROWTYPE;
  v_have boolean;
  v_use_cache boolean;
  v_read_only boolean := COALESCE(current_setting('transaction_read_only', true), 'off') = 'on';
BEGIN
  DROP TABLE IF EXISTS _cr;

  SELECT * INTO v_state FROM public.contact_base_cache_state s WHERE s.scope_key = v_key;
  v_have := FOUND;

  IF NOT v_read_only
     AND NOT (v_have AND public.contact_base_cache_fresh(v_state.built_at, v_state.dirty_at))
     AND (NOT v_have OR COALESCE(v_state.row_count, 0) <= 3000) THEN
    -- Première lecture, ou petite portée : on reconstruit tout de suite (un
    -- import de 200 contacts se voit à l'écran suivant). Un seul reconstructeur
    -- par portée : l'appel parallèle attend ici puis trouve le cache frais.
    PERFORM pg_advisory_xact_lock(hashtext('contact_base_cache:' || v_key));
    SELECT * INTO v_state FROM public.contact_base_cache_state s WHERE s.scope_key = v_key;
    IF NOT (FOUND AND public.contact_base_cache_fresh(v_state.built_at, v_state.dirty_at)) THEN
      PERFORM public._contact_base_cache_build(v_key, p_venue_id, p_organizer_user_id, true);
    END IF;
    v_have := true;
  ELSIF v_have AND NOT v_read_only
        AND (v_state.last_read_at IS NULL OR v_state.last_read_at < now() - interval '1 minute') THEN
    -- Grande portée périmée : on sert le cache tel quel, et on signale la
    -- lecture — le cron la reconstruit dans la minute. SKIP LOCKED : une
    -- reconstruction en cours ne fait jamais attendre la page.
    UPDATE public.contact_base_cache_state s SET last_read_at = now()
     WHERE s.scope_key IN (SELECT s2.scope_key FROM public.contact_base_cache_state s2
                            WHERE s2.scope_key = v_key FOR UPDATE SKIP LOCKED);
  END IF;
  -- Aperçu démo (transaction en lecture seule) : le cache s'il existe, sinon
  -- le calcul en direct comme avant.
  v_use_cache := v_have;

  CREATE TEMP TABLE _cr ON COMMIT DROP AS
  WITH base AS (
    SELECT c.id,
           c.list_import_id,
           c.venue_id,
           c.organizer_user_id,
           c.email,
           c.phone_e164,
           c.first_name,
           c.last_name,
           c.country_code,
           c.country,
           c.region,
           c.city,
           c.postal_code,
           c.zone,
           c.age,
           c.gender,
           c.newsletter_opt_in,
           c.added_at,
           c.last_purchase_at,
           c.total_spent,
           c.event_count,
           c.extra,
           c.created_at,
           c.origin,
           c.user_id,
           c.imported_spent,
           c.imported_events,
           c.yuno_spent,
           c.yuno_events,
           c.yuno_first_at,
           c.yuno_last_at,
           c.ticket_count,
           c.table_count,
           c.order_count,
           c.guest_list_count,
           c.last_seen_at,
           c.eng_status,
           c.emails_sent,
           c.opens,
           c.clicks,
           c.last_opened_at,
           c.last_clicked_at,
           c.unsubscribed_at,
           c.bounced,
           c.subscribed,
           c.has_account
      FROM public.contact_base_cache c
     WHERE v_use_cache AND c.scope_key = v_key
    UNION ALL
    SELECT r.* FROM public.contact_rows(p_venue_id, p_organizer_user_id) r
     WHERE NOT v_use_cache
  ), ok_e AS (
    SELECT DISTINCT lower(ns.email) AS e
      FROM public.newsletter_subscriptions ns
     WHERE ns.opted_in
       AND (public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id))
  ), sup AS (
    SELECT DISTINCT lower(s.email) AS e FROM public.email_suppressions s
  ), ok_p AS (
    SELECT DISTINCT vc.phone_e164 AS p
      FROM public.venue_sms_contacts vc
     WHERE NOT vc.unsubscribed
       AND vc.sms_consent_at > now() - interval '36 months'
       AND (public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, p_venue_id, p_organizer_user_id))
  )
  SELECT b.*,
         (b.email IS NOT NULL AND oe.e IS NOT NULL AND s.e IS NULL) AS email_ok,
         (b.phone_e164 IS NOT NULL AND op.p IS NOT NULL) AS phone_ok
    FROM base b
    LEFT JOIN ok_e oe ON oe.e = b.email
    LEFT JOIN sup s ON s.e = b.email
    LEFT JOIN ok_p op ON op.p = b.phone_e164;
  SELECT count(*) INTO v_n FROM _cr;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.contact_build_rows(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contact_build_rows(p_venue_id text, p_organizer_user_id uuid) TO "service_role";

-- rewritten · public.crm_admin_analysis(p_scope_key text) · dépôt : 20261013110000_crm_prediction_journal.sql
CREATE OR REPLACE FUNCTION public.crm_admin_analysis(p_scope_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg jsonb := public.crm_analysis_config();
  v_venue text;
  v_org uuid;
BEGIN
  IF NOT COALESCE(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_scope_key LIKE 'venue:%' THEN v_venue := substr(p_scope_key, 7);
  ELSIF p_scope_key ~ '^org:[0-9a-f-]{36}$' THEN v_org := substr(p_scope_key, 5)::uuid;
  ELSE RAISE EXCEPTION 'invalid_scope' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'state', (SELECT jsonb_build_object('computed_at', s.computed_at, 'full_at', s.full_at, 'rules_version', s.rules_version,
                                        'people', s.people, 'duration_ms', s.duration_ms, 'last_error', s.last_error,
                                        'last_error_at', s.last_error_at, 'stats', s.stats,
                                        'dirty', (SELECT count(*) FROM public.crm_analysis_dirty d WHERE d.scope_key = s.scope_key))
                FROM public.crm_analysis_state s WHERE s.scope_key = p_scope_key),
    'coverage', public._crm_signal_coverage(v_venue, v_org),
    'families', public._crm_an_families_json(p_scope_key, v_cfg),
    'learning', jsonb_build_object(
      'global_enabled', COALESCE((SELECT enabled FROM public.crm_learning_settings WHERE id), false),
      'account_contributes', COALESCE((SELECT learning_contrib FROM public.crm_settings WHERE scope_key = p_scope_key), true),
      'demo', COALESCE(public.is_demo_marketing_scope(v_venue, v_org), false),
      'cells', (SELECT count(*) FROM public.crm_learning_contrib c JOIN public.crm_learning_keys k ON k.contributor = c.contributor
                 WHERE k.scope_key = p_scope_key)),
    -- Score de prédiction : santé du modèle, et la projection de remplissage
    -- (super admin seulement au début, décision de Paul du 07/10).
    'score', (SELECT jsonb_build_object('status', m.status, 'trained_at', m.trained_at, 'features', m.features,
                                        'beta', m.beta, 'metrics', m.metrics)
                FROM public.crm_score_model m WHERE m.scope_key = p_scope_key),
    'projection', (SELECT COALESCE(jsonb_agg(z.j ORDER BY z.start_at), '[]'::jsonb) FROM (
      SELECT e.start_at, jsonb_build_object(
               'event_id', e.id, 'title', e.title, 'start_at', e.start_at,
               'sold', (SELECT count(*) FROM public.external_tickets t
                         WHERE t.event_id = e.id AND public._crm_ticket_is_sale(t.status, t.deal_channel)),
               'expected_known', round(COALESCE(sum(s.p), 0)),
               'band', round(2 * sqrt(COALESCE(sum(s.p * (1 - s.p)), 0))),
               'remaining_share', (SELECT round(sn.remaining_share::numeric, 2) FROM public.crm_score_night sn
                                    WHERE sn.scope_key = p_scope_key AND sn.event_id = e.id),
               -- Nouveaux à venir : la moyenne des 8 dernières soirées × la part restante.
               'newcomers_est', (SELECT round(avg(np.new_people) * COALESCE((SELECT sn.remaining_share FROM public.crm_score_night sn
                                                                              WHERE sn.scope_key = p_scope_key AND sn.event_id = e.id), 1)) FROM (
                                   SELECT n.new_people FROM public.crm_night_profile n
                                    WHERE n.scope_key = p_scope_key AND n.starts_at < now()
                                    ORDER BY n.starts_at DESC LIMIT 8) np)) AS j
        FROM public.events e
        LEFT JOIN public.crm_person_night_score s ON s.scope_key = p_scope_key AND s.event_id = e.id
       WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL AND e.start_at > now()
         AND ((v_venue IS NOT NULL AND e.venue_id = v_venue) OR (v_org IS NOT NULL AND e.organizer_user_id = v_org))
         AND EXISTS (SELECT 1 FROM public.crm_score_model m WHERE m.scope_key = p_scope_key AND m.status = 'ok')
       GROUP BY e.id
       ORDER BY e.start_at LIMIT 6) z),
    -- Journal prévu / réel (20261013110000) : les 12 dernières soirées réglées,
    -- la règle d'ouverture de la projection au pro.
    'journal', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'event_id', r.event_id, 'title', r.title, 'start_at', r.start_at, 'horizon', r.horizon,
                   'n', r.metrics->'n', 'buyers', r.metrics->'buyers', 'expected', r.metrics->'expected',
                   'auc', r.metrics->'auc', 'ece', r.metrics->'ece', 'logloss', r.metrics->'logloss',
                   'labels', r.metrics->'labels', 'audiences', r.metrics->'audiences',
                   'projection', r.metrics->'projection') ORDER BY r.start_at, r.horizon), '[]'::jsonb)
                  FROM (SELECT * FROM public.crm_prediction_results x
                         WHERE x.scope_key = p_scope_key ORDER BY x.start_at DESC LIMIT 24) r),
    'projection_gate', public._crm_projection_gate(p_scope_key));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_analysis(p_scope_key text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_admin_analysis(p_scope_key text) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.crm_admin_analysis(p_scope_key text) TO "service_role";

-- rewritten · public.crm_ana_traffic__core(p_venue_id text, p_organizer_user_id uuid, p_period text, p_event uuid) · dépôt : 20261016210000_crm_screens_at_scale.sql
CREATE OR REPLACE FUNCTION public.crm_ana_traffic__core(p_venue_id text, p_organizer_user_id uuid, p_period text DEFAULT '30d'::text, p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  m jsonb;
  v_n int;
  v_series jsonb; v_sources jsonb; v_clicks jsonb; v_new jsonb; v_events jsonb; v_first jsonb; v_gained jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  m := public._crm_ana_setup(p_venue_id, p_organizer_user_id, p_period, p_event, 'all');
  v_n := (m->>'n')::int;

  -- Premier achat de chaque client dans l'espace (toutes époques).
  DROP TABLE IF EXISTS _afirst;
  CREATE TEMP TABLE _afirst ON COMMIT DROP AS
  SELECT DISTINCT ON (a.email) a.email, a.id, a.bought_at, a.src, a.ci, a.pi
    FROM _atk_all a WHERE a.ok AND a.email IS NOT NULL
   ORDER BY a.email, a.bought_at, a.id;

  -- Clics sur les messages Yuno (un clic = une personne et une campagne).
  DROP TABLE IF EXISTS _aclk;
  CREATE TEMP TABLE _aclk ON COMMIT DROP AS
  SELECT k.campaign_id, k.email, k.at, k.event_id,
         public._crm_ana_bucket(m, k.at) AS ci,
         CASE m->>'mode'
           WHEN 'hour' THEN CASE WHEN k.at >= (m->>'start')::timestamptz - make_interval(hours => v_n) AND k.at < (m->>'start')::timestamptz THEN 0 END
           WHEN 'day' THEN CASE WHEN public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int)
                                     BETWEEN (m->>'start')::date - v_n AND (m->>'start')::date - 1 THEN 0 END
           WHEN 'month' THEN CASE WHEN public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int)
                                       >= ((m->>'start')::date - interval '12 months')::date
                                   AND public._crm_night_date(k.at, m->>'tz', (m->>'night_end_hour')::int) < (m->>'start')::date THEN 0 END
           ELSE NULL END AS pi
    FROM (
      SELECT ev.campaign_id, lower(ev.recipient_email) AS email, min(ev.created_at) AS at, c.event_id
        FROM public.email_campaign_events ev
        JOIN public.email_campaigns c ON c.id = ev.campaign_id
       WHERE ev.event_type = 'clicked'
         AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
         AND ev.created_at > now() - interval '25 months'
       GROUP BY ev.campaign_id, lower(ev.recipient_email), c.event_id
    ) k;

  -- Agrégé UNE fois par (case, source), puis lu par case : avant, chaque
  -- case × source relisait tous les billets (20261016210000).
  DROP TABLE IF EXISTS _aser;
  CREATE TEMP TABLE _aser ON COMMIT DROP AS
  SELECT a.ci, a.src, round(sum(a.amount), 2) AS rev, sum(a.qty) AS tk
    FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.ci, a.src;
  SELECT jsonb_agg(jsonb_build_object(
           'revenue', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT x.rev FROM _aser x WHERE x.ci = g AND x.src = s.k), 0))
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of']) s(k)),
           'tickets', (SELECT jsonb_object_agg(s.k, COALESCE((SELECT x.tk FROM _aser x WHERE x.ci = g AND x.src = s.k), 0))
                         FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of']) s(k)),
           'clicks', COALESCE(ck.n, 0),
           'new_buyers', COALESCE(nb.n, 0)
         ) ORDER BY g)
    INTO v_series
    FROM generate_series(0, v_n - 1) g
    LEFT JOIN (SELECT c.ci, count(*) AS n FROM _aclk c WHERE c.ci IS NOT NULL GROUP BY c.ci) ck ON ck.ci = g
    LEFT JOIN (SELECT f.ci, count(*) AS n FROM _afirst f WHERE f.ci IS NOT NULL GROUP BY f.ci) nb ON nb.ci = g;

  -- Par source : achats, acheteurs, nouveaux clients (premier achat ici), ventes.
  WITH cur AS (
    SELECT a.src, count(DISTINCT a.ord) AS orders, sum(a.qty) AS tk, count(DISTINCT a.email) AS buyers,
           round(sum(a.amount), 2) AS rev
      FROM _atk_all a WHERE a.ok AND a.ci IS NOT NULL GROUP BY a.src
  ), prv AS (
    SELECT a.src, sum(a.qty) AS tk FROM _atk_all a WHERE a.ok AND a.pi IS NOT NULL GROUP BY a.src
  ), nf AS (
    SELECT f.src, count(*) AS n FROM _afirst f WHERE f.ci IS NOT NULL GROUP BY f.src
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'k', s.k,
           'orders', COALESCE(cur.orders, 0),
           'tickets', COALESCE(cur.tk, 0),
           'buyers', COALESCE(cur.buyers, 0),
           'new_buyers', COALESCE(nf.n, 0),
           'revenue', COALESCE(cur.rev, 0),
           'prev_tickets', COALESCE(prv.tk, 0)
         ) ORDER BY s.o), '[]'::jsonb)
    INTO v_sources
    FROM unnest(ARRAY['ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'ex', 'se', 'au', 'di', 'of']) WITH ORDINALITY s(k, o)
    LEFT JOIN cur ON cur.src = s.k
    LEFT JOIN prv ON prv.src = s.k
    LEFT JOIN nf ON nf.src = s.k;

  SELECT jsonb_build_object(
           'total', count(*) FILTER (WHERE ci IS NOT NULL),
           'prev', count(*) FILTER (WHERE pi IS NOT NULL))
    INTO v_clicks FROM _aclk;

  SELECT jsonb_build_object(
           'buyers', (SELECT count(DISTINCT email) FROM _atk_all WHERE ok AND ci IS NOT NULL),
           'new', (SELECT count(*) FROM _afirst WHERE ci IS NOT NULL),
           'prev_buyers', (SELECT count(DISTINCT email) FROM _atk_all WHERE ok AND pi IS NOT NULL),
           'prev_new', (SELECT count(*) FROM _afirst WHERE pi IS NOT NULL))
    INTO v_new;

  -- Contacts gagnés : entrés dans la base pendant la fenêtre (premier achat,
  -- import, inscription), quelle que soit la porte.
  -- La case de chaque contact se calcule UNE fois (avant : une fois par case
  -- de la série, soit 31 × la base).
  WITH j AS (
    SELECT public._crm_ana_bucket(m, LEAST(f.bought_at, COALESCE(c.added_at, c.created_at))) AS b
      FROM _cr c LEFT JOIN _afirst f ON f.email = lower(c.email)
     WHERE c.email IS NOT NULL
  ), jb AS (
    SELECT j.b, count(*) AS n FROM j WHERE j.b IS NOT NULL GROUP BY j.b
  )
  SELECT jsonb_build_object(
           'total', COALESCE((SELECT sum(jb.n) FROM jb), 0),
           'series', (SELECT jsonb_agg(COALESCE(jb.n, 0) ORDER BY g)
                        FROM generate_series(0, v_n - 1) g LEFT JOIN jb ON jb.b = g))
    INTO v_gained;

  -- Soirées : acheteurs, part de nouveaux, clics de vos messages vers elles.
  WITH per AS (
    SELECT a.event_id, count(DISTINCT a.email) AS buyers,
           count(DISTINCT a.email) FILTER (WHERE EXISTS (SELECT 1 FROM _afirst f WHERE f.id = a.id)) AS new_buyers
      FROM _atk_all a WHERE a.ok AND a.event_id IS NOT NULL
       AND (m->>'mode' = 'event' AND a.event_id = (m->'event'->>'id')::uuid OR m->>'mode' <> 'event' AND a.ci IS NOT NULL)
     GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'title', e.title, 'start_at', e.start_at, 'night', e.night, 'upcoming', e.upcoming,
           'state', CASE WHEN e.night = (m->>'today')::date THEN 'tonight' WHEN e.upcoming THEN 'presale' ELSE 'past' END,
           'buyers', p.buyers, 'new_buyers', p.new_buyers,
           'clicks', (SELECT count(*) FROM _aclk c WHERE c.event_id = e.id)
         ) ORDER BY p.buyers DESC), '[]'::jsonb)
    INTO v_events
    FROM (SELECT * FROM per ORDER BY buyers DESC LIMIT 7) p JOIN _aev e ON e.id = p.event_id;

  RETURN jsonb_build_object(
    'meta', m,
    'series', COALESCE(v_series, '[]'::jsonb),
    'sources', v_sources,
    'clicks', v_clicks,
    'buyers', v_new,
    'gained', v_gained,
    'events', v_events,
    'sends', public._crm_ana_sends(p_venue_id, p_organizer_user_id, m),
    'has_any', EXISTS (SELECT 1 FROM _atk_all)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_ana_traffic__core(p_venue_id text, p_organizer_user_id uuid, p_period text, p_event uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_ana_traffic__core(p_venue_id text, p_organizer_user_id uuid, p_period text, p_event uuid) TO "service_role";

-- rewritten · public.crm_client__core(p_venue_id text, p_organizer_user_id uuid, p_email text) · dépôt : 20261008210000_crm_file_history.sql
CREATE OR REPLACE FUNCTION public.crm_client__core(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_em text := lower(btrim(COALESCE(p_email, '')));
  v_p record;
  v_buys jsonb;
  v_guests jsonb;
  v_msgs jsonb;
  v_months jsonb;
  v_rules record;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rules FROM public.crm_scope_rules(p_venue_id, p_organizer_user_id);
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id, NULL);
  SELECT * INTO v_p FROM _cp p WHERE p.email = v_em;
  IF v_p.email IS NULL THEN RETURN NULL; END IF;

  -- Achats : une ligne par soirée (montant de la soirée, billets).
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_buys FROM (
    SELECT jsonb_build_object('kind', 'buy', 'at', min(t.bought_at), 'event_id', t.event_id, 'title', e.title,
                              'event_start', min(t.event_start), 'amount', round(sum(t.amount), 2), 'tickets', sum(t.qty),
                              'scanned', bool_or(t.scanned_at IS NOT NULL), 'first', min(t.event_start) = v_p.first_night,
                              'upcoming', min(t.event_start) > now(),
                              -- Par où est arrivé l'achat : la source que Shotgun rend sur le
                              -- premier billet de la personne pour cette soirée.
                              'source', public._crm_source_label(p_venue_id, p_organizer_user_id, (
                                SELECT lower(et.utm->>'utm_source') FROM public.external_tickets et
                                 WHERE et.event_id = t.event_id AND lower(et.buyer_email) = v_em
                                   AND public._crm_ticket_is_sale(et.status, et.deal_channel)
                                 ORDER BY COALESCE(et.purchased_at, et.first_seen_at) LIMIT 1))) AS x
      FROM _cpt t LEFT JOIN public.events e ON e.id = t.event_id
     WHERE t.email = v_em
     GROUP BY t.event_id, e.title
  ) q;

  -- Guest list : une ligne par soirée où la personne était invitée ou
  -- inscrite gratuitement (20261008100000). `came` n'est faux qu'une fois la
  -- porte vraiment scannée (`scan_known`) : sinon on ne sait pas.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'event_start' DESC), '[]'::jsonb) INTO v_guests FROM (
    SELECT jsonb_build_object('kind', 'guest', 'event_id', g.event_id, 'title', e.title,
             'event_start', min(g.event_start), 'at', min(g.at),
             'gl', CASE WHEN bool_and(g.kind = 'inv') THEN 'inv' WHEN bool_and(g.kind = 'free') THEN 'free' ELSE 'mix' END,
             'list', string_agg(DISTINCT g.deal, ', '),
             'came', bool_or(g.scanned_at IS NOT NULL), 'scanned_at', min(g.scanned_at),
             'scan_known', public._crm_event_scan_known(g.event_id),
             'upcoming', min(g.event_end) > now()) AS x
      FROM _cpg g LEFT JOIN public.events e ON e.id = g.event_id
     WHERE g.email = v_em AND g.event_id IS NOT NULL
     GROUP BY g.event_id, e.title
  ) q;

  -- Messages : e-mails reçus (et clics), SMS reçus.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_msgs FROM (
    SELECT jsonb_build_object('kind', 'email', 'at', r.sent_at, 'name', c.name, 'campaign_id', c.id,
             'opened', EXISTS (SELECT 1 FROM public.email_campaign_events ev WHERE ev.campaign_id = c.id AND lower(ev.recipient_email) = v_em AND ev.event_type = 'opened'),
             'clicked', k.at IS NOT NULL,
             -- La soirée dont parlait l'e-mail, le premier clic, et si la personne a
             -- acheté cette soirée dans les 7 jours qui suivent (ou par la source de
             -- CETTE campagne, que Shotgun rend sur le billet).
             'event_id', c.event_id, 'event_title', ce.title, 'clicked_at', k.at,
             'bought_after', CASE WHEN c.event_id IS NULL OR k.at IS NULL THEN NULL ELSE EXISTS (
               SELECT 1 FROM public.external_tickets et
                WHERE et.event_id = c.event_id AND lower(et.buyer_email) = v_em
                  AND public._crm_ticket_is_sale(et.status, et.deal_channel)
                  AND (lower(et.utm->>'utm_source') = 'yuno-m-' || left(replace(c.id::text, '-', ''), 8)
                       OR COALESCE(et.purchased_at, et.first_seen_at) BETWEEN k.at AND k.at + interval '7 days')) END) AS x
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c ON c.id = r.campaign_id
      LEFT JOIN public.events ce ON ce.id = c.event_id
      LEFT JOIN LATERAL (SELECT min(ev.created_at) AS at FROM public.email_campaign_events ev
                          WHERE ev.campaign_id = c.id AND lower(ev.recipient_email) = v_em AND ev.event_type = 'clicked') k ON true
     WHERE lower(r.email) = v_em AND r.status = 'sent' AND r.sent_at IS NOT NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
     ORDER BY r.sent_at DESC LIMIT 40
  ) q;

  SELECT jsonb_agg(jsonb_build_object('m', to_char(m, 'YYYY-MM'),
           'n', (SELECT count(DISTINCT z.event_id) FROM (
                   SELECT t.event_id, t.event_start FROM _cpt t WHERE t.email = v_em
                   UNION ALL
                   SELECT g.event_id, g.event_start FROM _cpg g
                    WHERE g.email = v_em AND g.kind = 'inv' AND g.scanned_at IS NOT NULL) z
                  WHERE date_trunc('month', z.event_start AT TIME ZONE 'Europe/Paris') = m)) ORDER BY m)
    INTO v_months
    FROM generate_series(date_trunc('month', now() AT TIME ZONE 'Europe/Paris') - interval '11 months',
                         date_trunc('month', now() AT TIME ZONE 'Europe/Paris'), interval '1 month') m;

  RETURN jsonb_build_object(
    'email', v_p.email, 'first_name', v_p.first_name, 'last_name', v_p.last_name, 'phone', v_p.phone,
    'email_ok', v_p.email_ok, 'phone_ok', v_p.phone_ok, 'bounced', v_p.bounced, 'eng_status', v_p.eng_status,
    'lifecycle', v_p.lifecycle, 'nights', v_p.nights, 'nights_win', v_p.nights_win, 'spent', v_p.spent,
    'first_night', v_p.first_night, 'last_night', v_p.last_night, 'added_at', v_p.added_at,
    'tonight', v_p.tonight, 'source', v_p.source, 'utm_source', v_p.utm_source, 'origin', v_p.origin,
    'first_source', public._crm_source_label(p_venue_id, p_organizer_user_id, v_p.utm_source),
    'tags', COALESCE(to_jsonb(v_p.tags), '[]'::jsonb), 'note', v_p.note,
    'buys', v_buys, 'messages', v_msgs, 'months', v_months,
    'guests', v_guests,
    -- Historique d'un fichier importé : ce qu'il dit et comment il compte (20261008210000).
    'history', CASE WHEN v_p.hist_mode IS NULL THEN NULL ELSE jsonb_build_object(
        'nights', v_p.hist_nights, 'spent', v_p.hist_spent, 'last', v_p.hist_last, 'mode', v_p.hist_mode,
        'list', (SELECT COALESCE(NULLIF(btrim(ci.title), ''), NULLIF(btrim(li.list_name), ''), li.filename)
                   FROM public.contact_list_imports li
                   LEFT JOIN public.crm_imports ci ON ci.list_import_id = li.id
                  WHERE li.id = v_p.hist_list)) END,
    'gl', jsonb_build_object('n', v_p.gl_n, 'came', v_p.gl_came, 'first', v_p.gl_first, 'conv', v_p.gl_conv,
                             'paid_n', v_p.paid_n, 'noshow', v_p.gl_noshow),
    'rules', jsonb_build_object('min_nights', v_rules.regular_min_nights, 'window_months', v_rules.regular_window_months,
                                'lapse_months', v_rules.lapse_months));
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_client__core(p_venue_id text, p_organizer_user_id uuid, p_email text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_client__core(p_venue_id text, p_organizer_user_id uuid, p_email text) TO "service_role";

-- rewritten · public.crm_holdout_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer) · dépôt : 20261013120000_crm_holdout.sql
CREATE OR REPLACE FUNCTION public.crm_holdout_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer DEFAULT 180)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key   text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_from  timestamptz := now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 180), 1), 730));
  v_sends jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH grp AS (
    -- E-mails « Qui cibler »
    SELECT 'email'::text AS channel, c.id::text AS id, c.name AS label, c.event_id,
           min(r.created_at) AS t0, r.email,
           (r.status = 'skipped' AND r.error_message = 'holdout') AS ctl
      FROM public.email_campaigns c
      JOIN public.email_campaign_recipients r ON r.campaign_id = c.id
     WHERE c.holdout_count > 0 AND c.event_id IS NOT NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id AND c.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND c.created_at >= v_from
       AND (r.status NOT IN ('skipped', 'suppressed') OR r.error_message = 'holdout')
     GROUP BY c.id, c.name, c.event_id, r.email, r.status, r.error_message
    UNION ALL
    -- SMS « Qui cibler »
    SELECT 'sms', c.id::text, c.name, c.event_id, min(r.created_at), r.email,
           (r.status = 'skipped' AND r.error_code = 'holdout')
      FROM public.sms_campaigns c
      JOIN public.sms_campaign_recipients r ON r.campaign_id = c.id
     WHERE c.holdout_count > 0 AND c.event_id IS NOT NULL AND r.email IS NOT NULL
       AND c.venue_id IS NOT DISTINCT FROM p_venue_id
       AND c.organizer_id IS NOT DISTINCT FROM CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END
       AND c.created_at >= v_from
       AND (r.status <> 'skipped' OR r.error_code = 'holdout')
     GROUP BY c.id, c.name, c.event_id, r.email, r.status, r.error_code
    UNION ALL
    -- Recettes
    SELECT 'recipe', a.kind, NULL, COALESCE(l.trigger_event_id, l.bind_event_id), l.created_at, lower(l.email),
           (l.status = 'skipped' AND l.skip_reason = 'holdout')
      FROM public.email_automation_sends l
      JOIN public.email_automations a ON a.id = l.automation_id
     WHERE l.venue_id IS NOT DISTINCT FROM p_venue_id AND l.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id
       AND l.created_at >= v_from AND COALESCE(l.trigger_event_id, l.bind_event_id) IS NOT NULL
       AND (l.status = 'queued' OR l.skip_reason = 'holdout')
       AND EXISTS (SELECT 1 FROM public.email_automation_sends h
                    WHERE h.automation_id = l.automation_id AND h.skip_reason = 'holdout')
  ), y AS (
    SELECT g.*, EXISTS (
             SELECT 1 FROM public.external_tickets t
              WHERE t.event_id = g.event_id AND lower(t.buyer_email) = lower(g.email)
                AND public._crm_ticket_is_sale(t.status, t.deal_channel)
                AND COALESCE(t.purchased_at, t.first_seen_at) > g.t0) AS bought
      FROM grp g
  ), s AS (
    SELECT y.channel, y.id, max(y.label) AS label,
           CASE WHEN count(DISTINCT y.event_id) = 1 THEN (array_agg(y.event_id))[1] END AS event_id,
           count(*) FILTER (WHERE NOT y.ctl) AS n_c, count(*) FILTER (WHERE NOT y.ctl AND y.bought) AS b_c,
           count(*) FILTER (WHERE y.ctl) AS n_h, count(*) FILTER (WHERE y.ctl AND y.bought) AS b_h,
           min(y.t0) AS sent_at,
           bool_and(EXISTS (SELECT 1 FROM public.events e WHERE e.id = y.event_id AND e.start_at < now())) AS done,
           count(DISTINCT y.event_id) AS nights
      FROM y GROUP BY y.channel, y.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'channel', s.channel, 'id', s.id, 'label', s.label, 'event_id', s.event_id,
           'sent_at', s.sent_at, 'done', s.done, 'nights', s.nights,
           'contacted', jsonb_build_object('n', s.n_c, 'buyers', s.b_c),
           'control', jsonb_build_object('n', s.n_h, 'buyers', s.b_h),
           -- Acheteurs en plus = contactés × (taux contacté − taux témoin) ;
           -- z du test de deux proportions (≥ 2 : différence nette).
           'extra', CASE WHEN s.n_c >= 10 AND s.n_h >= 10
                         THEN round(s.n_c * (s.b_c::numeric / s.n_c - s.b_h::numeric / s.n_h), 1) END,
           'z', CASE WHEN s.n_c >= 10 AND s.n_h >= 10 AND (s.b_c + s.b_h) > 0 AND (s.b_c + s.b_h) < (s.n_c + s.n_h) THEN round((
                  (s.b_c::numeric / s.n_c - s.b_h::numeric / s.n_h)
                  / sqrt(((s.b_c + s.b_h)::numeric / (s.n_c + s.n_h)) * (1 - (s.b_c + s.b_h)::numeric / (s.n_c + s.n_h))
                         * (1.0 / s.n_c + 1.0 / s.n_h)))::numeric, 2) END)
         ORDER BY s.sent_at DESC), '[]'::jsonb)
    INTO v_sends FROM s;

  RETURN jsonb_build_object('pct', public.crm_holdout_pct(v_key), 'sends', v_sends);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_holdout_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_holdout_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.crm_holdout_overview(p_venue_id text, p_organizer_user_id uuid, p_days integer) TO "service_role";

-- rewritten · public.crm_night_guestlist__core(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) · dépôt : 20261008111000_crm_guest_list_min_sample.sql
CREATE OR REPLACE FUNCTION public.crm_night_guestlist__core(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e record;
  p record;
  v_tz text;
  v_day date;
  v_today date;
  v_phase text;
  v_series text;
  v_d_end integer;
  v_d_start integer;
  v_known boolean;
  v_out jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT ev.* INTO e FROM public.events ev
   WHERE ev.id = p_event_id AND ev.external_source IS NOT NULL
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id));
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  v_tz := COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris');
  v_day := (e.start_at AT TIME ZONE v_tz)::date;
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_phase := CASE WHEN e.start_at > now() THEN 'upcoming'
                  WHEN COALESCE(e.end_at, e.start_at + interval '6 hours') > now() THEN 'live'
                  ELSE 'past' END;
  v_series := lower(COALESCE(public._crm_night_series(e.title), e.title));
  v_d_end := CASE WHEN v_phase = 'upcoming' THEN GREATEST(0, v_day - v_today) ELSE 0 END;
  v_known := v_phase = 'past' AND public._crm_event_scan_known(p_event_id);

  -- La fois d'avant : même série, sinon la soirée passée précédente — avec une guest list.
  SELECT ev.id, ev.title, ev.start_at, COALESCE(NULLIF(ev.timezone, ''), 'Europe/Paris') AS tz,
         lower(COALESCE(public._crm_night_series(ev.title), ev.title)) = v_series AS same_series
    INTO p
    FROM public.events ev
   WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.id <> p_event_id
     AND ev.start_at < e.start_at
     AND COALESCE(ev.end_at, ev.start_at + interval '6 hours') <= now()
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
     AND EXISTS (SELECT 1 FROM public.external_tickets t
                  WHERE t.event_id = ev.id AND public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) IS NOT NULL)
   ORDER BY (lower(COALESCE(public._crm_night_series(ev.title), ev.title)) = v_series) DESC, ev.start_at DESC
   LIMIT 1;

  -- Début de la courbe des inscriptions : la plus ancienne (60 jours au plus).
  SELECT LEAST(60, GREATEST(v_d_end, COALESCE(max(GREATEST(0, v_day - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE v_tz)::date)), v_d_end)))
    INTO v_d_start
    FROM public.external_tickets t
   WHERE t.event_id = p_event_id AND public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) IS NOT NULL;

  WITH night AS MATERIALIZED (
    SELECT lower(t.buyer_email) AS email, t.status, t.raw_status,
           public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) AS gl,
           (public._crm_ticket_is_sale(t.status, t.deal_channel) AND COALESCE(t.price, 0) > 0) AS paid,
           COALESCE(t.purchased_at, t.first_seen_at) AS at, t.scanned_at,
           NULLIF(btrim(t.deal_name), '') AS deal, t.gender, t.age,
           NULLIF(btrim(t.buyer_first_name), '') AS fn, NULLIF(btrim(t.buyer_last_name), '') AS ln,
           GREATEST(0, v_day - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE v_tz)::date) AS d
      FROM public.external_tickets t
     WHERE t.event_id = p_event_id
       AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
  ), gl AS (
    SELECT * FROM night WHERE gl IS NOT NULL
  ), pv AS (
    SELECT t.scanned_at,
           GREATEST(0, (p.start_at AT TIME ZONE p.tz)::date - (COALESCE(t.purchased_at, t.first_seen_at) AT TIME ZONE p.tz)::date) AS d
      FROM public.external_tickets t
     WHERE p.id IS NOT NULL AND t.event_id = p.id
       AND public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) IS NOT NULL
  ), ppl AS (
    SELECT g.email, min(g.at) AS at, min(g.scanned_at) AS scanned_at,
           (array_agg(g.deal ORDER BY g.at))[1] AS deal, (array_agg(g.gl ORDER BY g.at))[1] AS kind,
           max(g.fn) AS fn, max(g.ln) AS ln, count(*) AS n
      FROM gl g WHERE g.email IS NOT NULL
     GROUP BY g.email
  ), pa AS (
    -- Ce que chaque invité a fait chez vous avant et après cette soirée.
    SELECT pp.email,
           COALESCE(bool_or(public._crm_ticket_is_sale(t.status, t.deal_channel) AND COALESCE(t.price, 0) > 0
                   AND COALESCE(t.purchased_at, t.first_seen_at) < e.start_at
                   AND t.event_id IS DISTINCT FROM p_event_id), false) AS paid_before,
           -- Déjà vu = une place (achat ou guest list) pour une soirée d'avant, OU un
           -- billet payant acheté avant celle-ci, même pour une soirée plus tardive :
           -- « Première fois », « Déjà venus en guest list » et « Clients payants »
           -- forment ainsi une partition exacte des invités.
           COALESCE(bool_or(t.event_id IS DISTINCT FROM p_event_id
                   AND ((ev.start_at < e.start_at
                         AND (public._crm_ticket_is_sale(t.status, t.deal_channel)
                              OR public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) IS NOT NULL))
                     OR (public._crm_ticket_is_sale(t.status, t.deal_channel) AND COALESCE(t.price, 0) > 0
                         AND COALESCE(t.purchased_at, t.first_seen_at) < e.start_at))), false) AS seen_before,
           min(COALESCE(t.purchased_at, t.first_seen_at)) FILTER (
             WHERE public._crm_ticket_is_sale(t.status, t.deal_channel) AND COALESCE(t.price, 0) > 0
               AND COALESCE(t.purchased_at, t.first_seen_at) > e.start_at
               AND t.event_id IS DISTINCT FROM p_event_id) AS paid_after_at,
           COALESCE(sum(COALESCE(t.price, 0) * GREATEST(t.quantity, 1)) FILTER (
             WHERE public._crm_ticket_is_sale(t.status, t.deal_channel) AND COALESCE(t.price, 0) > 0
               AND COALESCE(t.purchased_at, t.first_seen_at) > e.start_at
               AND t.event_id IS DISTINCT FROM p_event_id), 0) AS paid_after,
           COALESCE(bool_or(ev.start_at > e.start_at
                   AND (public._crm_ticket_is_sale(t.status, t.deal_channel)
                        OR public._crm_ticket_gl_kind(t.status, t.price, t.deal_channel) IS NOT NULL)), false) AS later
      FROM ppl pp
      JOIN public.external_tickets t
        ON t.buyer_email IS NOT NULL AND lower(t.buyer_email) = pp.email
       AND ((p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id))
      LEFT JOIN public.events ev ON ev.id = t.event_id
     GROUP BY pp.email
  ), lists AS (
    SELECT COALESCE(g.deal, '') AS name,
           CASE WHEN bool_and(g.gl = 'inv') THEN 'inv' WHEN bool_and(g.gl = 'free') THEN 'free' ELSE 'mix' END AS kind,
           count(*) AS entries,
           count(*) FILTER (WHERE g.scanned_at IS NOT NULL) AS came,
           count(DISTINCT g.email) FILTER (WHERE NOT a.seen_before) AS first,
           count(DISTINCT g.email) FILTER (WHERE NOT a.paid_before AND a.paid_after_at IS NOT NULL) AS conv
      FROM gl g LEFT JOIN pa a ON a.email = g.email
     GROUP BY COALESCE(g.deal, '')
  ), arr AS (
    SELECT extract(hour FROM n.scanned_at AT TIME ZONE v_tz)::int AS h,
           count(*) FILTER (WHERE n.gl IS NOT NULL) AS gl,
           count(*) FILTER (WHERE n.paid) AS paid
      FROM night n WHERE n.scanned_at IS NOT NULL AND n.status = 'valid'
     GROUP BY 1
  ), med AS (
    SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY m) FILTER (WHERE k = 'gl') AS gl,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY m) FILTER (WHERE k = 'paid') AS paid
      FROM (SELECT CASE WHEN n.gl IS NOT NULL THEN 'gl' WHEN n.paid THEN 'paid' END AS k,
                   ((extract(hour FROM n.scanned_at AT TIME ZONE v_tz)::int * 60
                     + extract(minute FROM n.scanned_at AT TIME ZONE v_tz)::int) + 720) % 1440 AS m
              FROM night n WHERE n.scanned_at IS NOT NULL AND n.status = 'valid') z
  ), prof AS (
    SELECT k,
           count(*) FILTER (WHERE gender IN ('female', 'male', 'other')) AS g_known,
           count(*) FILTER (WHERE gender = 'female') AS f,
           count(*) FILTER (WHERE age BETWEEN 14 AND 99) AS a_known,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY age::float8) FILTER (WHERE age BETWEEN 14 AND 99) AS age_med
      FROM (SELECT CASE WHEN n.gl IS NOT NULL THEN 'gl' WHEN n.paid THEN 'paid' END AS k, n.gender, n.age
              FROM night n) z
     WHERE k IS NOT NULL
     GROUP BY k
  ), tot AS (
    SELECT count(*) FILTER (WHERE gl IS NOT NULL) AS entries,
           count(*) FILTER (WHERE gl = 'inv') AS inv,
           count(*) FILTER (WHERE gl = 'free') AS free,
           count(*) FILTER (WHERE gl IS NOT NULL AND scanned_at IS NOT NULL) AS came,
           count(*) FILTER (WHERE paid) AS paid,
           count(*) FILTER (WHERE paid AND scanned_at IS NOT NULL) AS paid_came,
           count(*) FILTER (WHERE gl IS NOT NULL AND (at AT TIME ZONE v_tz)::date = v_today) AS today,
           count(*) FILTER (WHERE status = 'other' AND lower(COALESCE(raw_status, '')) = 'pending_approval') AS pending,
           count(*) FILTER (WHERE lower(COALESCE(raw_status, '')) = 'rejected') AS rejected,
           count(*) FILTER (WHERE status = 'valid' AND scanned_at IS NOT NULL) AS scanned
      FROM night
  )
  SELECT jsonb_build_object(
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at,
               'end_at', COALESCE(e.end_at, e.start_at + interval '6 hours'), 'tz', v_tz,
               'phase', v_phase, 'url', e.external_ticket_url),
    'scan_known', v_known,
    'totals', (SELECT jsonb_build_object(
        'entries', t.entries, 'inv', t.inv, 'free', t.free,
        'people', (SELECT count(*) FROM ppl),
        'came', t.came, 'paid', t.paid, 'paid_came', t.paid_came, 'today', t.today,
        'pending', t.pending, 'rejected', t.rejected,
        'showup', CASE WHEN v_known AND t.entries >= 10 THEN round(100.0 * t.came / t.entries, 1) END,
        'paid_showup', CASE WHEN v_known AND t.paid >= 10 THEN round(100.0 * t.paid_came / t.paid, 1) END,
        'free_share', CASE WHEN (v_known OR (v_phase = 'live' AND t.scanned > 0)) AND t.came + t.paid_came >= 10
                           THEN round(100.0 * t.came / (t.came + t.paid_came), 1) END)
        FROM tot t),
    'prev', CASE WHEN p.id IS NOT NULL THEN (
        SELECT jsonb_build_object('id', p.id, 'title', p.title, 'start_at', p.start_at, 'same_series', p.same_series,
                 'entries', count(*), 'came', count(*) FILTER (WHERE pv.scanned_at IS NOT NULL),
                 'same_day', count(*) FILTER (WHERE pv.d >= v_d_end),
                 'showup', CASE WHEN public._crm_event_scan_known(p.id) AND count(*) >= 10
                                THEN round(100.0 * count(*) FILTER (WHERE pv.scanned_at IS NOT NULL) / count(*), 1) END)
          FROM pv) END,
    'curve', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'd', s.d,
                'v', (SELECT count(*) FROM gl WHERE gl.d >= s.d),
                'pv', CASE WHEN p.id IS NOT NULL THEN (SELECT count(*) FROM pv WHERE pv.d >= s.d) END) ORDER BY s.d DESC), '[]'::jsonb)
                FROM generate_series(v_d_end, GREATEST(v_d_end, v_d_start)) AS s(d)),
    'lists', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'name', NULLIF(l.name, ''), 'kind', l.kind, 'entries', l.entries, 'came', l.came,
                'showup', CASE WHEN v_known AND l.entries >= 10 THEN round(100.0 * l.came / l.entries, 1) END,
                'first', l.first, 'conv', CASE WHEN v_phase = 'past' THEN l.conv END)
                ORDER BY l.entries DESC, l.name), '[]'::jsonb) FROM lists l),
    'who', (SELECT jsonb_build_object(
              'first', count(*) FILTER (WHERE NOT a.seen_before),
              'gl', count(*) FILTER (WHERE a.seen_before AND NOT a.paid_before),
              'buyers', count(*) FILTER (WHERE a.seen_before AND a.paid_before))
              FROM ppl pp JOIN pa a ON a.email = pp.email),
    'after', CASE WHEN v_phase = 'past' THEN (SELECT jsonb_build_object(
              'eligible', count(*) FILTER (WHERE NOT a.paid_before),
              'converted', count(*) FILTER (WHERE NOT a.paid_before AND a.paid_after_at IS NOT NULL),
              'revenue', round(COALESCE(sum(a.paid_after) FILTER (WHERE NOT a.paid_before AND a.paid_after_at IS NOT NULL), 0), 2),
              'back', count(*) FILTER (WHERE a.later))
              FROM ppl pp JOIN pa a ON a.email = pp.email) END,
    'arrivals', (SELECT jsonb_build_object(
              'slots', COALESCE((SELECT jsonb_agg(jsonb_build_object('h', r.h, 'gl', r.gl, 'paid', r.paid)
                                   ORDER BY (r.h + 12) % 24) FROM arr r), '[]'::jsonb),
              'gl_med', CASE WHEN (SELECT count(*) FROM gl WHERE gl.scanned_at IS NOT NULL) >= 10 THEN m.gl END,
              'paid_med', CASE WHEN (SELECT count(*) FROM night n WHERE n.paid AND n.scanned_at IS NOT NULL) >= 10 THEN m.paid END)
              FROM med m),
    'profile', (SELECT COALESCE(jsonb_object_agg(pr.k, jsonb_build_object(
              'known', pr.g_known,
              'female_pct', CASE WHEN pr.g_known >= 10 THEN round(100.0 * pr.f / pr.g_known, 1) END,
              'age_known', pr.a_known,
              'age_med', CASE WHEN pr.a_known >= 10 THEN round(pr.age_med::numeric, 0) END)), '{}'::jsonb)
              FROM prof pr),
    'people', (SELECT COALESCE(jsonb_agg(z.x ORDER BY z.o1, z.o2 NULLS LAST, z.o3 DESC), '[]'::jsonb) FROM (
              SELECT jsonb_build_object(
                       'email', pp.email,
                       'name', NULLIF(btrim(COALESCE(pp.fn, '') || ' ' || COALESCE(left(pp.ln, 1) || '.', '')), ''),
                       'list', pp.deal, 'kind', pp.kind, 'n', pp.n,
                       'came', pp.scanned_at IS NOT NULL, 'scanned_at', pp.scanned_at, 'at', pp.at,
                       'tag', CASE WHEN NOT a.seen_before THEN 'first' WHEN a.paid_before THEN 'buyer' ELSE 'gl' END,
                       'conv', v_phase = 'past' AND NOT a.paid_before AND a.paid_after_at IS NOT NULL) AS x,
                     (v_phase <> 'upcoming' AND pp.scanned_at IS NULL) AS o1,
                     CASE WHEN v_phase <> 'upcoming' THEN pp.scanned_at END AS o2,
                     pp.at AS o3
                FROM ppl pp JOIN pa a ON a.email = pp.email
               ORDER BY 2, 3 NULLS LAST, 4 DESC
               LIMIT 80) z),
    'synced_at', (SELECT x.synced_at FROM public.external_events x WHERE x.event_id = p_event_id LIMIT 1)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_night_guestlist__core(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_night_guestlist__core(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) TO "service_role";

-- rewritten · public.crm_night_links(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) · dépôt : 20261007120000_crm_link_story_photo.sql
CREATE OR REPLACE FUNCTION public.crm_night_links(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_money boolean := public.crm_scope_sees_money(p_venue_id, p_organizer_user_id);
  v_ev record;
  v_tz text;
  v_today date;
  v_out jsonb;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public._crm_link_event_ok(p_venue_id, p_organizer_user_id, p_event_id) THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  SELECT e.id, e.title, e.start_at, e.end_at, e.external_ticket_url, COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris') AS tz
    INTO v_ev FROM public.events e WHERE e.id = p_event_id;
  v_tz := v_ev.tz;
  v_today := (now() AT TIME ZONE v_tz)::date;

  WITH links AS (
    SELECT tl.id, tl.code, tl.label, tl.utm_source AS platform, tl.utm_medium AS placement, tl.image_url,
           tl.created_at, tl.archived_at, public.crm_link_source(tl.code) AS src
      FROM public.tracked_links tl
     WHERE tl.event_id = p_event_id AND tl.target_kind = 'event'
       -- Liens de partage seulement : les liens techniques d'une campagne
       -- (SMS, e-mail) vivent dans le résultat de la campagne.
       AND public._crm_link_kind_ok(tl.utm_source, tl.utm_medium)
       AND ((p_venue_id IS NOT NULL AND tl.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND tl.organizer_user_id = p_organizer_user_id))
  ),
  clicks AS (
    SELECT c.tracked_link_id AS link_id, c.clicked_at, c.visitor_id, c.device_type, c.country
      FROM public.tracked_link_clicks c JOIN links l ON l.id = c.tracked_link_id
  ),
  -- Tous les billets de l'espace (pour « nouveau client » : aucun billet
  -- vendu avant celui-ci dans l'espace).
  scope_tk AS (
    SELECT t.id, t.event_id, lower(t.buyer_email) AS email, t.external_order_id,
           COALESCE(t.purchased_at, t.first_seen_at) AS bought_at, t.price, t.status, t.deal_channel,
           NULLIF(btrim(t.buyer_first_name), '') AS first_name, NULLIF(btrim(t.buyer_last_name), '') AS last_name,
           lower(t.utm->>'utm_source') AS src
      FROM public.external_tickets t
     WHERE (p_venue_id IS NOT NULL AND t.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND t.organizer_user_id = p_organizer_user_id)
  ),
  first_buy AS (
    SELECT email, min(bought_at) AS first_at FROM scope_tk
     WHERE email IS NOT NULL AND public._crm_ticket_is_sale(status, deal_channel)
     GROUP BY email
  ),
  ev_tk AS (
    SELECT s.*, public._crm_ticket_is_sale(s.status, s.deal_channel) AS sale,
           (s.email IS NOT NULL AND f.first_at = s.bought_at) AS is_new
      FROM scope_tk s LEFT JOIN first_buy f ON f.email = s.email
     WHERE s.event_id = p_event_id
  ),
  link_tk AS (
    SELECT l.id AS link_id, t.* FROM links l JOIN ev_tk t ON t.src = l.src AND t.sale
  ),
  per_link AS (
    SELECT l.id,
           jsonb_build_object(
             'id', l.id, 'code', l.code, 'label', l.label, 'platform', l.platform, 'placement', l.placement,
             'image_url', l.image_url,
             'source', l.src, 'created_at', l.created_at, 'archived', l.archived_at IS NOT NULL,
             'clicks', (SELECT count(*) FROM clicks c WHERE c.link_id = l.id),
             'visitors', (SELECT count(DISTINCT c.visitor_id) FROM clicks c WHERE c.link_id = l.id),
             'clicks_24h', (SELECT count(*) FROM clicks c WHERE c.link_id = l.id AND c.clicked_at > now() - interval '24 hours'),
             'last_click_at', (SELECT max(c.clicked_at) FROM clicks c WHERE c.link_id = l.id),
             'mobile_pct', (SELECT CASE WHEN count(*) >= 10 THEN round(100.0 * count(*) FILTER (WHERE c.device_type = 'mobile') / count(*)) END
                              FROM clicks c WHERE c.link_id = l.id),
             'spark', (SELECT jsonb_agg(COALESCE(x.n, 0) ORDER BY g.d)
                         FROM generate_series(v_today - 13, v_today, interval '1 day') g(d)
                         LEFT JOIN LATERAL (
                           SELECT count(*) AS n FROM clicks c
                            WHERE c.link_id = l.id AND (c.clicked_at AT TIME ZONE v_tz)::date = g.d::date) x ON true),
             'tickets', (SELECT count(*) FROM link_tk k WHERE k.link_id = l.id),
             'orders', (SELECT count(DISTINCT COALESCE(k.external_order_id, k.id::text)) FROM link_tk k WHERE k.link_id = l.id),
             'revenue', CASE WHEN v_money THEN (SELECT COALESCE(round(sum(k.price), 2), 0) FROM link_tk k WHERE k.link_id = l.id) END,
             'buyers', (SELECT count(DISTINCT k.email) FROM link_tk k WHERE k.link_id = l.id),
             'new_buyers', (SELECT count(DISTINCT k.email) FROM link_tk k WHERE k.link_id = l.id AND k.is_new),
             'first_sale_at', (SELECT min(k.bought_at) FROM link_tk k WHERE k.link_id = l.id),
             'people', COALESCE((
               SELECT jsonb_agg(p ORDER BY p->>'at' DESC) FROM (
                 SELECT jsonb_build_object(
                          'email', k.email,
                          'name', NULLIF(btrim(COALESCE(max(k.first_name), '') || ' ' ||
                                  COALESCE(left(max(k.last_name), 1) || '.', '')), ''),
                          'tickets', count(*),
                          'is_new', bool_or(k.is_new),
                          'at', max(k.bought_at)) AS p
                   FROM link_tk k WHERE k.link_id = l.id AND k.email IS NOT NULL
                  GROUP BY k.email ORDER BY max(k.bought_at) DESC LIMIT 30) z), '[]'::jsonb)
           ) AS j
      FROM links l
  ),
  -- Toutes les sources que Shotgun rapporte pour les billets vendus de la soirée.
  sources AS (
    SELECT COALESCE(t.src, '') AS src, count(*) AS tickets,
           count(DISTINCT COALESCE(t.external_order_id, t.id::text)) AS orders,
           round(sum(t.price), 2) AS revenue
      FROM ev_tk t WHERE t.sale GROUP BY 1
  ),
  days AS (
    SELECT g.d::date AS d,
           (SELECT count(*) FROM clicks c WHERE (c.clicked_at AT TIME ZONE v_tz)::date = g.d::date) AS clicks,
           (SELECT count(*) FROM link_tk k WHERE (k.bought_at AT TIME ZONE v_tz)::date = g.d::date) AS tickets
      FROM generate_series(v_today - 13, v_today, interval '1 day') g(d)
  )
  SELECT jsonb_build_object(
    'event', jsonb_build_object('id', v_ev.id, 'title', v_ev.title, 'start_at', v_ev.start_at,
                                'upcoming', COALESCE(v_ev.end_at, v_ev.start_at + interval '6 hours') > now(),
                                'url', v_ev.external_ticket_url, 'tz', v_tz),
    'can_write', public.crm_scope_writable(p_venue_id, p_organizer_user_id),
    'sees_money', v_money,
    'links', COALESCE((SELECT jsonb_agg(p.j ORDER BY (p.j->>'created_at') DESC) FROM per_link p), '[]'::jsonb),
    'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'source', NULLIF(s.src, ''), 'tickets', s.tickets, 'orders', s.orders,
                  'revenue', CASE WHEN v_money THEN s.revenue END) ORDER BY s.tickets DESC) FROM sources s), '[]'::jsonb),
    'totals', jsonb_build_object(
      'tickets', (SELECT count(*) FROM ev_tk WHERE sale),
      'with_source', (SELECT count(*) FROM ev_tk WHERE sale AND src IS NOT NULL),
      'link_tickets', (SELECT count(*) FROM link_tk),
      'link_revenue', CASE WHEN v_money THEN (SELECT COALESCE(round(sum(price), 2), 0) FROM link_tk) END,
      'clicks', (SELECT count(*) FROM clicks),
      'visitors', (SELECT count(DISTINCT visitor_id) FROM clicks)),
    'series', (SELECT jsonb_agg(jsonb_build_object('d', d, 'clicks', clicks, 'tickets', tickets) ORDER BY d) FROM days),
    -- Shotgun a-t-il déjà rendu un billet portant une source de lien Yuno,
    -- toutes soirées de l'espace confondues ? Tant que non, l'écran ne dit
    -- jamais « 0 vente » mais « en attente du premier retour de Shotgun ».
    'confirmed', EXISTS (SELECT 1 FROM scope_tk WHERE src LIKE 'yuno-%' AND src !~ '^yuno-[msd]-'),
    'synced_at', (SELECT max(c.last_ok_at) FROM public.ticketing_connections c
                   WHERE (p_venue_id IS NOT NULL AND c.venue_id = p_venue_id)
                      OR (p_organizer_user_id IS NOT NULL AND c.organizer_user_id = p_organizer_user_id))
  ) INTO v_out;

  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_night_links(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_night_links(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.crm_night_links(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) TO "service_role";

-- rewritten · public.crm_night_plan(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) · dépôt : 20261016155000_crm_night_plan.sql
CREATE OR REPLACE FUNCTION public.crm_night_plan(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key     text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_ev      uuid := p_event_id;
  v_t       jsonb;
  v_rates   jsonb := COALESCE(public.crm_pricing_config()->'rates', '{}'::jsonb);
  v_re      integer;
  v_rs      integer;
  v_sms_ok  boolean;
  v_steps   jsonb;
  v_tot     jsonb;
  v_bal     integer;
  e         record;
  v_prev    record;
  v_pace    jsonb;
  v_sold    integer;
  v_planned jsonb;
  v_fams    jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Sans soirée désignée : la prochaine du compte.
  IF v_ev IS NULL THEN
    SELECT ev.id INTO v_ev FROM public.events ev
     WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
       AND COALESCE(ev.end_at, ev.start_at + interval '6 hours') > now()
     ORDER BY ev.start_at LIMIT 1;
    IF v_ev IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_upcoming'); END IF;
  END IF;

  -- « Qui cibler » : même porte, mêmes audiences, mêmes moments.
  v_t := public.crm_night_targets(p_venue_id, p_organizer_user_id, v_ev);
  IF NOT COALESCE((v_t->>'ok')::boolean, false) THEN RETURN v_t; END IF;

  v_re := GREATEST(1, COALESCE((v_rates->>'email')::integer, 1));
  v_rs := GREATEST(1, COALESCE((v_rates->>'sms')::integer, 35));
  -- Un SMS ne part qu'avec l'identité légale de l'expéditeur : sinon, e-mail.
  v_sms_ok := COALESCE((public.get_sms_sender_readiness(p_venue_id, p_organizer_user_id)->>'identity_ok')::boolean, false);

  -- Les étapes : chaque personne compte UNE fois, dans la première audience
  -- (ordre conseillé) qui la contient ; groupées par moment.
  WITH r AS (
    SELECT a.aud, a.rk, a.moment, a.mord FROM _nta a WHERE a.rk IS NOT NULL
  ), f AS (
    SELECT DISTINCT ON (g.email) g.email, r.aud FROM _ntg g JOIN r ON r.aud = g.aud ORDER BY g.email, r.rk
  ), c AS (
    SELECT f.aud, count(*)::int AS n, count(*) FILTER (WHERE p.email_ok)::int AS ne, count(*) FILTER (WHERE p.phone_ok)::int AS ns
      FROM f LEFT JOIN _cp p ON p.email = f.email GROUP BY f.aud
  ), a AS (
    SELECT r.aud, r.rk, r.moment, r.mord, COALESCE(c.n, 0) AS n, COALESCE(c.ne, 0) AS ne, COALESCE(c.ns, 0) AS ns, x.j
      FROM r LEFT JOIN c ON c.aud = r.aud
      CROSS JOIN LATERAL (SELECT j FROM jsonb_array_elements(v_t->'audiences') j WHERE j->>'key' = r.aud LIMIT 1) x
  ), st AS (
    SELECT a.moment, min(a.mord) AS mord, min((a.j->>'send_at')::timestamptz) AS send_at,
           sum(a.n)::int AS people, sum(a.ne)::int AS email, sum(a.ns)::int AS sms,
           jsonb_agg(a.j || jsonb_build_object('first_n', a.n, 'first_email', a.ne, 'first_sms', a.ns,
                                               'audience_id', 'target:' || v_ev::text || ':' || a.aud) ORDER BY a.rk) AS auds
      FROM a GROUP BY a.moment
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'moment', st.moment, 'send_at', st.send_at, 'people', st.people, 'email', st.email, 'sms', st.sms,
           -- La veille : SMS si l'identité est prête et que l'étape a des numéros ; sinon e-mail.
           'channel', CASE WHEN st.moment = 'eve' AND v_sms_ok AND st.sms > 0 THEN 'sms' ELSE 'email' END,
           'cost_email', st.email * v_re, 'cost_sms', st.sms * v_rs,
           'audiences', st.auds) ORDER BY st.mord), '[]'::jsonb)
    INTO v_steps FROM st;

  v_bal := COALESCE(public.crm_yunits_balance(v_key), 0);
  SELECT jsonb_build_object(
           'people', COALESCE(sum((s->>'people')::int), 0),
           'email', COALESCE(sum((s->>'email')::int), 0),
           'sms', COALESCE(sum((s->>'sms')::int), 0),
           'cost', COALESCE(sum(CASE WHEN s->>'channel' = 'sms' THEN (s->>'cost_sms')::int ELSE (s->>'cost_email')::int END), 0),
           'balance', v_bal)
    INTO v_tot FROM jsonb_array_elements(v_steps) s;
  v_tot := v_tot || jsonb_build_object('enough', v_bal >= (v_tot->>'cost')::int);

  -- Le rythme : billets vendus maintenant contre l'édition précédente au même
  -- moment avant sa soirée (même série d'abord, sinon la soirée d'avant).
  SELECT ev.id, ev.title, ev.start_at INTO e FROM public.events ev WHERE ev.id = v_ev;
  SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int INTO v_sold
    FROM public.external_tickets t WHERE t.event_id = v_ev AND public._crm_ticket_is_sale(t.status, t.deal_channel);
  SELECT ev.id, ev.title, ev.start_at,
         lower(public._crm_night_series(ev.title)) = lower(public._crm_night_series(e.title)) AS same_series
    INTO v_prev
    FROM public.events ev
   WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.id <> v_ev
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
     AND ev.start_at < now()
   ORDER BY (lower(public._crm_night_series(ev.title)) = lower(public._crm_night_series(e.title))) DESC, ev.start_at DESC
   LIMIT 1;
  v_pace := jsonb_build_object('sold', v_sold);
  IF v_prev.id IS NOT NULL THEN
    v_pace := v_pace || jsonb_build_object('prev', jsonb_build_object(
      'id', v_prev.id, 'title', v_prev.title, 'start_at', v_prev.start_at, 'same_series', v_prev.same_series,
      'sold_same', (SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int FROM public.external_tickets t
                     WHERE t.event_id = v_prev.id AND public._crm_ticket_is_sale(t.status, t.deal_channel)
                       AND COALESCE(t.purchased_at, t.first_seen_at) <= v_prev.start_at - (e.start_at - now())),
      'total', (SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int FROM public.external_tickets t
                 WHERE t.event_id = v_prev.id AND public._crm_ticket_is_sale(t.status, t.deal_channel))));
  END IF;

  -- Ce qui est déjà prévu pour cette soirée (campagnes faites à la main ;
  -- les envois des automatisations et des scénarios ont leurs propres écrans).
  SELECT jsonb_build_object(
    'emails', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status,
                                 'at', COALESCE(c.sent_at, c.scheduled_at, c.updated_at),
                                 'recipients', COALESCE(c.total_recipients, c.recipients_count)) ORDER BY COALESCE(c.sent_at, c.scheduled_at, c.updated_at))
                          FROM public.email_campaigns c
                         WHERE c.event_id = v_ev AND c.automation_id IS NULL AND c.child_kind IS NULL AND c.parent_campaign_id IS NULL
                           AND c.status IN ('draft', 'scheduled', 'sending', 'paused', 'sent')
                           AND c.venue_id IS NOT DISTINCT FROM p_venue_id
                           AND (p_venue_id IS NOT NULL OR c.organizer_user_id = p_organizer_user_id)), '[]'::jsonb),
    'sms', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status,
                              'at', COALESCE(c.sent_at, c.scheduled_at, c.updated_at),
                              'recipients', COALESCE(c.total_recipients, c.estimated_recipients)) ORDER BY COALESCE(c.sent_at, c.scheduled_at, c.updated_at))
                       FROM public.sms_campaigns c
                      WHERE c.event_id = v_ev
                        AND c.status IN ('draft', 'scheduled', 'sending', 'paused', 'sent')
                        AND c.venue_id IS NOT DISTINCT FROM p_venue_id
                        AND (p_venue_id IS NOT NULL OR c.organizer_id = p_organizer_user_id)), '[]'::jsonb))
    INTO v_planned;

  -- Familles d'hypothèses CONFIRMÉES sur le compte (même règle que les scénarios).
  SELECT COALESCE(jsonb_agg(f.fam ORDER BY f.o), '[]'::jsonb) INTO v_fams
    FROM unnest(ARRAY['artist', 'genre', 'format', 'slot', 'weekday', 'place', 'series', 'early', 'launch', 'last_minute',
                      'door', 'group', 'table', 'discovery', 'passing', 'invited', 'group_first', 'brought', 'channel'])
         WITH ORDINALITY AS f(fam, o)
   WHERE public._crm_family_confirmed(v_key, f.fam);

  RETURN jsonb_build_object(
    'ok', true,
    'event', v_t->'event', 'days_left', v_t->'days_left', 'computed', v_t->'computed',
    'has_ticket', v_t->'has_ticket', 'score', v_t->'score', 'union', v_t->'union',
    'steps', v_steps, 'totals', v_tot, 'pace', v_pace, 'planned', v_planned,
    'holdout_pct', public.crm_holdout_pct(v_key),
    'families', v_fams,
    'rates', jsonb_build_object('email', v_re, 'sms', v_rs),
    'sms_ready', v_sms_ok);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_night_plan(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_night_plan(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.crm_night_plan(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) TO "service_role";

-- rewritten · public.crm_night_targets(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) · dépôt : 20261014130000_crm_night_targets_order.sql
CREATE OR REPLACE FUNCTION public.crm_night_targets(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scope  text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  e        record;
  v_tz     text;
  v_local  date;
  v_series text;
  v_res    numeric := COALESCE((public.crm_analysis_config()->'rarity'->>'resident_share')::numeric, 0.2);
  v_eve    timestamptz;
  v_week   timestamptz;
  v_out    jsonb;
  v_auds   jsonb;
  v_union  jsonb;
  v_score  boolean;
  v_scorej jsonb;
  v_gate   jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT ev.id, ev.title, ev.start_at, ev.end_at, ev.timezone, x.artists, x.genres INTO e
    FROM public.events ev
    LEFT JOIN public.external_events x ON x.event_id = ev.id
   WHERE ev.id = p_event_id AND ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
       OR (p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'event_not_found');
  END IF;
  IF COALESCE(e.end_at, e.start_at + interval '6 hours') <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_upcoming');
  END IF;

  v_tz := COALESCE(NULLIF(e.timezone, ''), 'Europe/Paris');
  v_local := (e.start_at AT TIME ZONE v_tz)::date;
  v_series := public._crm_night_series(e.title);
  -- Moments conseillés : la veille à 18 h (heure de la soirée), la semaine
  -- d'avant à 18 h ; jamais dans le passé.
  v_eve := GREATEST(now(), ((v_local - 1)::timestamp + time '18:00') AT TIME ZONE v_tz);
  v_week := GREATEST(now(), ((v_local - 7)::timestamp + time '18:00') AT TIME ZONE v_tz);

  -- Joignables : la même base que l'envoi (consentements e-mail et SMS).
  PERFORM public._crm_people_build(p_venue_id, p_organizer_user_id);

  DROP TABLE IF EXISTS _ntg;
  CREATE TEMP TABLE _ntg ON COMMIT DROP AS
  SELECT a.aud, t.email
    FROM unnest(ARRAY['likely', 'concept', 'lineup', 'genre', 'early', 'last_minute', 'once_local']) a(aud)
   CROSS JOIN LATERAL public._crm_night_target_set(v_scope, p_event_id, a.aud) t;

  -- Score de prédiction (20261012100000) : seulement un modèle validé.
  v_score := EXISTS (SELECT 1 FROM public.crm_score_model m WHERE m.scope_key = v_scope AND m.status = 'ok');

  -- Chaque audience, ses joignables, sa famille, son moment (une ligne).
  DROP TABLE IF EXISTS _nta;
  CREATE TEMP TABLE _nta ON COMMIT DROP AS
  WITH counts AS (
    SELECT g.aud, count(*)::int AS n,
           count(*) FILTER (WHERE c.email_ok)::int AS email,
           count(*) FILTER (WHERE c.phone_ok)::int AS sms,
           sum(s.p) AS expected
      FROM _ntg g LEFT JOIN _cp c ON c.email = g.email
      LEFT JOIN public.crm_person_night_score s ON v_score AND s.scope_key = v_scope AND s.event_id = p_event_id AND s.email = g.email
     GROUP BY g.aud
  ), fam AS (
    SELECT a.aud, a.family, a.moment, a.mord
      FROM (VALUES ('likely', NULL, 'now', 1), ('concept', 'series', 'now', 1), ('lineup', 'artist', 'now', 1), ('genre', 'genre', 'week', 2),
                   ('early', 'early', 'now', 1), ('last_minute', 'last_minute', 'eve', 3), ('once_local', NULL, 'week', 2)) a(aud, family, moment, mord)
  )
  SELECT f.aud, f.family, f.moment, f.mord, COALESCE(c.n, 0) AS n, COALESCE(c.email, 0) AS email, COALESCE(c.sms, 0) AS sms,
         c.expected, s.status, s.availability, s.gain, NULL::int AS rk, NULL::int AS new_n, NULL::jsonb AS overlap
    FROM fam f
    LEFT JOIN counts c ON c.aud = f.aud
    LEFT JOIN LATERAL (
      SELECT fs.status, fs.availability, fs.gain FROM public.crm_family_status fs
       WHERE fs.scope_key = v_scope AND fs.family = f.family AND COALESCE(fs.variant, '') = '' LIMIT 1) s ON true;

  -- Ordre d'envoi conseillé (20261014130000, décisions de Paul du 08/10) : le
  -- moment d'abord (maintenant, la semaine d'avant, la veille), puis la
  -- famille confirmée sur le compte, puis le plus d'acheteurs attendus par
  -- personne (sans score : l'effet de la famille).
  UPDATE _nta a SET rk = r.rk
    FROM (SELECT x.aud, row_number() OVER (ORDER BY x.mord,
                   CASE WHEN x.status = 'supported' AND x.availability IN ('ok', 'reduced') THEN 0 ELSE 1 END,
                   CASE WHEN v_score THEN -COALESCE(x.expected, 0) / x.n ELSE -COALESCE(x.gain, 0) END, x.n DESC, x.aud)::int AS rk
            FROM _nta x WHERE x.n > 0) r
   WHERE r.aud = a.aud;
  -- « dont N nouveaux » : absents des audiences d'avant dans l'ordre.
  UPDATE _nta a SET new_n = (
    SELECT count(*) FROM _ntg g
     WHERE g.aud = a.aud
       AND NOT EXISTS (SELECT 1 FROM _ntg g2 JOIN _nta b ON b.aud = g2.aud
                        WHERE g2.email = g.email AND b.rk < a.rk))
   WHERE a.rk IS NOT NULL;
  -- Le plus gros recouvrement avec une autre audience : 10 personnes en
  -- commun et 25 % de l'audience au moins, sinon rien.
  UPDATE _nta a SET overlap = o.j
    FROM (SELECT z.aud, jsonb_build_object('key', z.other, 'n', z.common, 'pct', round(100.0 * z.common / z.n)) AS j
            FROM (SELECT ga.aud, gb.aud AS other, count(*)::int AS common, x.n,
                         row_number() OVER (PARTITION BY ga.aud ORDER BY count(*) DESC, gb.aud) AS k
                    FROM _ntg ga JOIN _ntg gb ON gb.email = ga.email AND gb.aud <> ga.aud
                    JOIN _nta x ON x.aud = ga.aud
                   GROUP BY ga.aud, gb.aud, x.n) z
           WHERE z.k = 1 AND z.common >= 10 AND z.common >= 0.25 * z.n) o
   WHERE o.aud = a.aud;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'key', ta.aud,
           'n', ta.n, 'email', ta.email, 'sms', ta.sms,
           -- Acheteurs attendus : somme des chances (score validé seulement).
           'expected', CASE WHEN v_score THEN round(COALESCE(ta.expected, 0)) END,
           'order', ta.rk, 'new_n', ta.new_n, 'overlap', ta.overlap,
           'family', ta.family,
           'status', ta.status, 'availability', ta.availability, 'gain', ta.gain,
           'moment', ta.moment,
           'send_at', CASE ta.moment WHEN 'eve' THEN v_eve WHEN 'week' THEN v_week ELSE now() END,
           'params', CASE ta.aud
             WHEN 'concept' THEN jsonb_build_object('series', v_series,
               'editions', (SELECT count(*) FROM public.crm_night_profile np
                             WHERE np.scope_key = v_scope AND lower(np.series) = lower(v_series) AND np.starts_at < now()))
             WHEN 'lineup' THEN jsonb_build_object('artists', (
               SELECT COALESCE(jsonb_agg(jsonb_build_object('name', z.name, 'n', z.n) ORDER BY z.n DESC, z.name), '[]'::jsonb)
                 FROM (SELECT COALESCE(a->>'name', z0.k) AS name,
                              (SELECT count(*) FROM _ntg g JOIN public.crm_person_profile p ON p.scope_key = v_scope AND p.email = g.email
                                WHERE g.aud = 'lineup' AND ('a:' || z0.k) = ANY (p.tags))::int AS n
                         FROM jsonb_array_elements(COALESCE(e.artists, '[]'::jsonb)) a
                         CROSS JOIN LATERAL (SELECT public._crm_artist_key(a) AS k) z0
                        WHERE z0.k IS NOT NULL
                          AND NOT EXISTS (SELECT 1 FROM public.crm_artist_stats st
                                           WHERE st.scope_key = v_scope AND st.artist_key = z0.k AND st.share > v_res)) z
                WHERE z.n > 0))
             WHEN 'genre' THEN jsonb_build_object('genres', to_jsonb(COALESCE(e.genres, '{}'::text[])))
           END)) ORDER BY ta.rk NULLS LAST, ta.aud), '[]'::jsonb)
    INTO v_auds
    FROM _nta ta;

  SELECT jsonb_build_object('n', count(*), 'email', count(*) FILTER (WHERE c.email_ok), 'sms', count(*) FILTER (WHERE c.phone_ok))
    INTO v_union
    FROM (SELECT DISTINCT email FROM _ntg) g LEFT JOIN _cp c ON c.email = g.email;

  -- Toute la base connue sans place : acheteurs attendus (score validé).
  IF v_score THEN
    SELECT jsonb_build_object('status', 'ok', 'expected', round(COALESCE(sum(s.p), 0)), 'people', count(*))
      INTO v_scorej
      FROM public.crm_person_night_score s
     WHERE s.scope_key = v_scope AND s.event_id = p_event_id
       AND EXISTS (SELECT 1 FROM public.crm_person_profile pp WHERE pp.scope_key = v_scope AND pp.email = s.email)
       AND NOT EXISTS (SELECT 1 FROM public.external_tickets t
                        WHERE t.event_id = p_event_id AND lower(t.buyer_email) = s.email AND t.status IN ('valid', 'transferred'));
    -- Projection de remplissage (20261013110000) : montrée au pro seulement
    -- quand elle a tenu (écart moyen < 15 % sur ses 8 dernières soirées à J-7,
    -- décision de Paul du 07/10). En ACHETEURS : c'est ce que le journal mesure.
    v_gate := public._crm_projection_gate(v_scope);
    IF COALESCE((v_gate->>'open')::boolean, false) THEN
      SELECT v_scorej || jsonb_build_object('projection', jsonb_build_object(
               'buyers', b.n, 'expected', round(k.p), 'band', round(2 * sqrt(k.v)), 'newcomers', round(COALESCE(nw.x, 0)),
               'total', round(b.n + k.p + COALESCE(nw.x, 0)),
               'low', round(GREATEST(b.n, b.n + k.p - 2 * sqrt(k.v) + COALESCE(nw.x, 0))),
               'high', round(b.n + k.p + 2 * sqrt(k.v) + COALESCE(nw.x, 0))))
        INTO v_scorej
        FROM (SELECT count(DISTINCT lower(t.buyer_email)) AS n FROM public.external_tickets t
               WHERE t.event_id = p_event_id AND public._crm_ticket_is_sale(t.status, t.deal_channel) AND t.buyer_email IS NOT NULL) b,
             (SELECT COALESCE(sum(s.p), 0) AS p, COALESCE(sum(s.p * (1 - s.p)), 0) AS v FROM public.crm_person_night_score s
               WHERE s.scope_key = v_scope AND s.event_id = p_event_id) k,
             (SELECT avg(np.new_people) * COALESCE((SELECT sn.remaining_share FROM public.crm_score_night sn
                                                     WHERE sn.scope_key = v_scope AND sn.event_id = p_event_id), 1) AS x
                FROM (SELECT n.new_people FROM public.crm_night_profile n
                       WHERE n.scope_key = v_scope AND n.starts_at < now() ORDER BY n.starts_at DESC LIMIT 8) np) nw;
    END IF;
  ELSE
    v_scorej := jsonb_build_object('status', COALESCE((SELECT m.status FROM public.crm_score_model m WHERE m.scope_key = v_scope), 'none'));
  END IF;

  v_out := jsonb_build_object('ok', true, 'score', v_scorej,
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'series', v_series,
                                'genres', to_jsonb(COALESCE(e.genres, '{}'::text[]))),
    'days_left', GREATEST(0, v_local - (now() AT TIME ZONE v_tz)::date),
    'has_ticket', (SELECT count(DISTINCT lower(t.buyer_email)) FROM public.external_tickets t
                    WHERE t.event_id = p_event_id AND t.status IN ('valid', 'transferred') AND t.buyer_email IS NOT NULL),
    'computed', EXISTS (SELECT 1 FROM public.crm_analysis_state st WHERE st.scope_key = v_scope),
    'union', v_union,
    'audiences', v_auds);
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_night_targets(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_night_targets(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.crm_night_targets(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) TO "service_role";

-- absent · public.crm_practical_email_check(p_campaign_id uuid)
CREATE OR REPLACE FUNCTION public.crm_practical_email_check(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c record;
  v_state jsonb;
  v_issues jsonb;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR NOT c.practical THEN
    RETURN jsonb_build_object('practical', false, 'ok', true, 'issues', '[]'::jsonb);
  END IF;
  IF NOT public.crm_scope_allowed(c.venue_id, c.organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_state := public._crm_practical_night_state(c.venue_id, c.organizer_user_id, c.event_id, c.id);
  v_issues := public._crm_practical_content_issues(c.blocks_json, c.subject, c.preheader, c.event_id,
                                                   v_state->>'ticket_url');
  RETURN jsonb_build_object(
    'practical', true,
    'ok', jsonb_array_length(v_issues) = 0 AND COALESCE((v_state->>'eligible')::boolean, false),
    'issues', v_issues,
    'night', v_state
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_practical_email_check(p_campaign_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_practical_email_check(p_campaign_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.crm_practical_email_check(p_campaign_id uuid) TO "service_role";

-- absent · public.crm_practical_email_rules()
CREATE OR REPLACE FUNCTION public.crm_practical_email_rules()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'max_per_night', 3,          -- e-mails pratiques au plus par soirée
    'hours_after_end', 24,       -- objets trouvés, incident : jusqu'au lendemain
    'yunits_per_email', 1,       -- comme tout e-mail CRM
    'roles', jsonb_build_array('organizer', 'editor')
  );
$function$;
REVOKE ALL ON FUNCTION public.crm_practical_email_rules() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_practical_email_rules() TO "anon";
GRANT EXECUTE ON FUNCTION public.crm_practical_email_rules() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.crm_practical_email_rules() TO "service_role";

-- absent · public.crm_practical_night(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
CREATE OR REPLACE FUNCTION public.crm_practical_night(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_state jsonb;
  v_holders integer := 0;
  v_reach integer := 0;
  v_optin integer := 0;
BEGIN
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_state := public._crm_practical_night_state(p_venue_id, p_organizer_user_id, p_event_id, NULL);
  IF v_state->>'reason' = 'not_mirror' THEN RETURN v_state; END IF;

  WITH h AS (
    SELECT DISTINCT lower(btrim(xt.buyer_email)) AS addr
      FROM public.external_tickets xt
     WHERE xt.event_id = p_event_id AND xt.status = 'valid'
       AND public.marketing_scope_match(xt.venue_id, xt.organizer_user_id, p_venue_id, p_organizer_user_id)
       AND xt.buyer_email IS NOT NULL
       AND btrim(xt.buyer_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
  SELECT count(*),
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = h.addr)),
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.newsletter_subscriptions ns
            WHERE public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)
              AND lower(ns.email) = h.addr AND ns.opted_in))
    INTO v_holders, v_reach, v_optin
    FROM h;

  RETURN v_state || jsonb_build_object(
    'holders', v_holders, 'reachable', v_reach, 'marketing_optin', v_optin,
    'yunits_per_email', (public.crm_practical_email_rules()->>'yunits_per_email')::integer
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_practical_night(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_practical_night(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.crm_practical_night(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid) TO "service_role";

-- rewritten · public.crm_weekly_review(p_venue_id text, p_organizer_user_id uuid) · dépôt : 20261016175000_crm_weekly_review.sql
CREATE OR REPLACE FUNCTION public.crm_weekly_review(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key      text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_to       timestamptz := (date_trunc('week', now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris';
  v_from     timestamptz := v_to - interval '7 days';
  v_mail     record;
  v_sms      record;
  v_scn_msgs integer;
  v_recipes  integer;
  v_hold     jsonb;
  v_measured jsonb;
  v_scns     jsonb;
  v_drift    jsonb := '[]'::jsonb;
  v_actions  jsonb := '[]'::jsonb;
  v_next     record;
  v_prev     record;
  v_sold     integer;
  v_same     integer;
  v_j        record;
  v_active   integer;
  v_recipes_on integer;
  v_loss     jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- ── Activité de la semaine ────────────────────────────────────────────────
  SELECT count(*)::int AS campaigns,
         COALESCE(sum(COALESCE(c.recipients_count, c.total_recipients, 0)), 0)::int AS sent,
         COALESCE(sum(COALESCE(c.bounced_count, 0)), 0)::int AS bounced,
         COALESCE(sum(COALESCE(c.complained_count, 0)), 0)::int AS complained,
         COALESCE(sum(COALESCE(c.policy_skipped_count, 0)), 0)::int AS protected
    INTO v_mail
    FROM public.email_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND (p_venue_id IS NOT NULL OR c.organizer_user_id = p_organizer_user_id)
     AND c.sent_at >= v_from AND c.sent_at < v_to AND c.status IN ('sent', 'sending')
     AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL AND c.child_kind IS NULL
     AND public.crm_campaign_is_crm(c.id);
  SELECT count(*)::int AS campaigns, COALESCE(sum(COALESCE(c.sent_count, 0)), 0)::int AS sent
    INTO v_sms
    FROM public.sms_campaigns c
   WHERE c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND (p_venue_id IS NOT NULL OR c.organizer_id = p_organizer_user_id)
     AND c.sent_at >= v_from AND c.sent_at < v_to;
  SELECT count(*)::int INTO v_scn_msgs
    FROM public.crm_scenario_steps st JOIN public.crm_scenarios s ON s.id = st.scenario_id
   WHERE s.scope_key = v_key AND st.status = 'sent' AND st.done_at >= v_from AND st.done_at < v_to;
  SELECT count(*)::int INTO v_recipes
    FROM public.email_automation_sends l
   WHERE l.venue_id IS NOT DISTINCT FROM p_venue_id
     AND (p_venue_id IS NOT NULL OR l.organizer_user_id = p_organizer_user_id)
     AND l.status = 'queued' AND l.created_at >= v_from AND l.created_at < v_to;

  -- ── Mesuré par le témoin ──────────────────────────────────────────────────
  -- Les envois dont la soirée a eu lieu cette semaine, avec une mesure (10
  -- personnes au moins de chaque côté).
  v_hold := public.crm_holdout_overview(p_venue_id, p_organizer_user_id, 60);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'channel', x->>'channel', 'id', x->>'id', 'label', x->>'label', 'event_id', x->>'event_id', 'event', e.title,
           'contacted', x->'contacted', 'control', x->'control', 'extra', x->'extra', 'z', x->'z',
           'verdict', CASE WHEN (x->>'z')::numeric >= 2 THEN 'gain' WHEN (x->>'z')::numeric <= -2 THEN 'loss' ELSE 'none' END)
           ORDER BY COALESCE((x->>'z')::numeric, 0) DESC), '[]'::jsonb)
    INTO v_measured
    FROM jsonb_array_elements(v_hold->'sends') x
    JOIN public.events e ON e.id = (x->>'event_id')::uuid
   WHERE x->>'event_id' IS NOT NULL AND x->'extra' IS NOT NULL AND jsonb_typeof(x->'extra') = 'number'
     AND e.start_at >= v_from AND e.start_at < v_to;
  -- Les scénarios en ligne ou en pause au verdict net (mesure cumulée).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status, 'measure', m.j,
           'verdict', CASE WHEN (m.j->>'z')::numeric >= 2 THEN 'gain' ELSE 'loss' END)
           ORDER BY (m.j->>'z')::numeric DESC), '[]'::jsonb)
    INTO v_scns
    FROM public.crm_scenarios s
    CROSS JOIN LATERAL (SELECT public._crm_scenario_holdout(s.id) AS j) m
   WHERE s.scope_key = v_key AND s.status IN ('active', 'paused')
     AND COALESCE((m.j->>'done')::boolean, false) AND jsonb_typeof(m.j->'z') = 'number'
     AND abs((m.j->>'z')::numeric) >= 2;

  -- ── Ce qui dérive ─────────────────────────────────────────────────────────
  -- Rythme : la prochaine soirée (21 jours) contre l'édition précédente au même moment.
  SELECT ev.id, ev.title, ev.start_at INTO v_next FROM public.events ev
   WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.start_at > now() AND ev.start_at < now() + interval '21 days'
     AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id) OR (p_venue_id IS NULL AND ev.organizer_user_id = p_organizer_user_id))
   ORDER BY ev.start_at LIMIT 1;
  IF v_next.id IS NOT NULL THEN
    SELECT ev.id, ev.title, ev.start_at INTO v_prev FROM public.events ev
     WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL AND ev.id <> v_next.id AND ev.start_at < now()
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id) OR (p_venue_id IS NULL AND ev.organizer_user_id = p_organizer_user_id))
     ORDER BY (lower(public._crm_night_series(ev.title)) = lower(public._crm_night_series(v_next.title))) DESC, ev.start_at DESC
     LIMIT 1;
    SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int INTO v_sold FROM public.external_tickets t
     WHERE t.event_id = v_next.id AND public._crm_ticket_is_sale(t.status, t.deal_channel);
    IF v_prev.id IS NOT NULL THEN
      SELECT COALESCE(sum(COALESCE(t.quantity, 1)), 0)::int INTO v_same FROM public.external_tickets t
       WHERE t.event_id = v_prev.id AND public._crm_ticket_is_sale(t.status, t.deal_channel)
         AND COALESCE(t.purchased_at, t.first_seen_at) <= v_prev.start_at - (v_next.start_at - now());
      IF v_same >= 20 AND v_sold < 0.85 * v_same THEN
        v_drift := v_drift || jsonb_build_object('kind', 'pace', 'event_id', v_next.id, 'title', v_next.title, 'start_at', v_next.start_at,
          'sold', v_sold, 'prev_title', v_prev.title, 'prev_sold', v_same);
      END IF;
    END IF;
  END IF;
  -- Délivrabilité de la semaine (200 envois au moins pour juger).
  IF v_mail.sent >= 200 AND (v_mail.bounced > 0.03 * v_mail.sent OR v_mail.complained > 0.001 * v_mail.sent) THEN
    v_drift := v_drift || jsonb_build_object('kind', 'deliverability', 'sent', v_mail.sent, 'bounced', v_mail.bounced, 'complained', v_mail.complained);
  END IF;
  -- Une part grandissante de la base protégée par les règles d'envoi (fatigue, pression).
  IF v_mail.sent + v_mail.protected >= 200 AND v_mail.protected > 0.15 * (v_mail.sent + v_mail.protected) THEN
    v_drift := v_drift || jsonb_build_object('kind', 'protected', 'protected', v_mail.protected, 'reached', v_mail.sent);
  END IF;
  -- Journal prévu / réel : la dernière soirée réglée cette semaine, écart > 15 %.
  SELECT r.title, r.start_at, (r.metrics->'projection'->>'predicted')::numeric AS predicted,
         (r.metrics->'projection'->>'actual')::numeric AS actual, (r.metrics->'projection'->>'err')::numeric AS err
    INTO v_j
    FROM public.crm_prediction_results r
   WHERE r.scope_key = v_key AND r.horizon = 'd7' AND r.settled_at >= v_from AND r.settled_at < v_to
     AND r.metrics->'projection'->>'err' IS NOT NULL
   ORDER BY r.start_at DESC LIMIT 1;
  IF v_j.title IS NOT NULL AND v_j.err > 0.15 THEN
    v_drift := v_drift || jsonb_build_object('kind', 'journal', 'title', v_j.title, 'start_at', v_j.start_at,
      'predicted', round(v_j.predicted), 'actual', round(v_j.actual), 'err_pct', round(v_j.err * 100));
  END IF;

  -- ── 1 à 3 actions, chacune avec l'écran qui la prépare ───────────────────
  SELECT count(*) FILTER (WHERE s.status = 'active')::int INTO v_active FROM public.crm_scenarios s WHERE s.scope_key = v_key;
  SELECT count(*)::int INTO v_recipes_on FROM public.email_automations a
   WHERE a.enabled AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND (p_venue_id IS NOT NULL OR a.organizer_user_id = p_organizer_user_id);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_drift) d WHERE d->>'kind' = 'pace') THEN
    v_actions := v_actions || jsonb_build_object('kind', 'targets', 'event_id', v_next.id, 'title', v_next.title, 'start_at', v_next.start_at);
  END IF;
  IF v_next.id IS NOT NULL AND v_next.start_at < now() + interval '14 days' THEN
    v_actions := v_actions || jsonb_build_object('kind', 'plan', 'event_id', v_next.id, 'title', v_next.title, 'start_at', v_next.start_at);
  END IF;
  SELECT x INTO v_loss FROM jsonb_array_elements(v_scns) x WHERE x->>'verdict' = 'loss' LIMIT 1;
  IF v_loss IS NOT NULL THEN
    v_actions := v_actions || jsonb_build_object('kind', 'scenario', 'id', v_loss->>'id', 'name', v_loss->>'name');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_drift) d WHERE d->>'kind' IN ('deliverability', 'protected')) THEN
    v_actions := v_actions || jsonb_build_object('kind', 'base');
  END IF;
  IF v_active = 0 AND v_recipes_on = 0 THEN
    v_actions := v_actions || jsonb_build_object('kind', 'automate');
  END IF;
  SELECT COALESCE(jsonb_agg(a ORDER BY o), '[]'::jsonb) INTO v_actions
    FROM jsonb_array_elements(v_actions) WITH ORDINALITY AS z(a, o) WHERE o <= 3;

  RETURN jsonb_build_object(
    'ok', true,
    'from', v_from, 'to', v_to - interval '1 second',
    'activity', jsonb_build_object('emails', v_mail.sent, 'email_campaigns', v_mail.campaigns, 'sms', v_sms.sent, 'sms_campaigns', v_sms.campaigns,
                                   'scenario_messages', v_scn_msgs, 'recipe_messages', v_recipes, 'protected', v_mail.protected),
    'measured', v_measured,
    'scenarios', v_scns,
    'drift', v_drift,
    'actions', v_actions,
    'holdout_pct', v_hold->'pct',
    'quiet', v_mail.sent + v_sms.sent + v_scn_msgs + v_recipes = 0 AND jsonb_array_length(v_measured) = 0 AND v_next.id IS NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_weekly_review(p_venue_id text, p_organizer_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_weekly_review(p_venue_id text, p_organizer_user_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.crm_weekly_review(p_venue_id text, p_organizer_user_id uuid) TO "service_role";

-- rewritten · public.dispute_promoter_payout(p_payout_id uuid, p_reason text) · dépôt : 20260721090000_promoter_payout_reference_dispute.sql
CREATE OR REPLACE FUNCTION public.dispute_promoter_payout(p_payout_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_promoter_id uuid;
  v_status text;
BEGIN
  PERFORM set_config('yuno.payout_rpc', 'on', true);

  SELECT promoter_id, status INTO v_promoter_id, v_status
  FROM promoter_payouts WHERE id = p_payout_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'payout_not_found'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'payout_not_declared'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM promoters p WHERE p.id = v_promoter_id AND p.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'only_promoter_can_dispute';
  END IF;

  UPDATE promoter_payouts
  SET status = 'disputed', disputed_at = now(), dispute_reason = left(COALESCE(p_reason, ''), 500)
  WHERE id = p_payout_id;

  RETURN jsonb_build_object('disputed', true, 'payout_id', p_payout_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.dispute_promoter_payout(p_payout_id uuid, p_reason text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dispute_promoter_payout(p_payout_id uuid, p_reason text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispute_promoter_payout(p_payout_id uuid, p_reason text) TO "anon";
GRANT EXECUTE ON FUNCTION public.dispute_promoter_payout(p_payout_id uuid, p_reason text) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.dispute_promoter_payout(p_payout_id uuid, p_reason text) TO "service_role";

-- rewritten · public.dj_remind_unpaid_fee(p_dj_set_id uuid) · dépôt : 20260621100000_dj_remind_unpaid_fee.sql
CREATE OR REPLACE FUNCTION public.dj_remind_unpaid_fee(p_dj_set_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_set    public.dj_sets%ROWTYPE;
  v_dj     public.djs%ROWTYPE;
  v_name   text;
  v_recent boolean;
BEGIN
  SELECT s.* INTO v_set FROM public.dj_sets s WHERE s.id = p_dj_set_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- L'appelant doit être le DJ propriétaire du set.
  SELECT d.* INTO v_dj FROM public.djs d
   WHERE d.id = v_set.dj_id AND d.user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF v_set.fee_paid OR COALESCE(v_set.fee, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nothing_due');
  END IF;

  -- La relance n'arrive que dans l'inbox d'un owner de venue.
  IF v_set.venue_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_venue');
  END IF;

  -- Anti-spam : une relance par set toutes les 24h.
  SELECT EXISTS (
    SELECT 1 FROM public.staff_notifications n
    WHERE n.reference_type = 'dj_set' AND n.reference_id = v_set.id
      AND n.notification_type = 'dj_fee_reminder'
      AND n.created_at > now() - interval '24 hours'
  ) INTO v_recent;
  IF v_recent THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  v_name := COALESCE(
    NULLIF(btrim(v_dj.stage_name), ''),
    NULLIF(btrim(COALESCE(v_dj.first_name, '') || ' ' || COALESCE(v_dj.last_name, '')), ''),
    'DJ'
  );

  INSERT INTO public.staff_notifications
    (venue_id, event_id, target_role, notification_type, title, message, reference_type, reference_id, priority, metadata)
  VALUES
    (v_set.venue_id, v_set.event_id, 'owner', 'dj_fee_reminder',
     v_name || ' attend son cachet',
     v_name || ' te relance pour un cachet en attente de ' || COALESCE(v_set.fee, 0)::text
       || ' € (set du ' || to_char(v_set.start_time, 'DD/MM/YYYY') || ').',
     'dj_set', v_set.id, 'normal',
     jsonb_build_object('dj_id', v_dj.id, 'fee', v_set.fee));

  RETURN jsonb_build_object('ok', true);
END; $function$;
REVOKE ALL ON FUNCTION public.dj_remind_unpaid_fee(p_dj_set_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dj_remind_unpaid_fee(p_dj_set_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.dj_remind_unpaid_fee(p_dj_set_id uuid) TO "service_role";

-- rewritten · public.get_external_event_live(p_event_ids uuid[]) · dépôt : 20261008150000_email_yuno_blocks_live.sql
CREATE OR REPLACE FUNCTION public.get_external_event_live(p_event_ids uuid[])
 RETURNS TABLE(event_id uuid, ticket_url text, deals jsonb, left_tickets integer, sold_out boolean, venue_label text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT e.id, e.external_ticket_url, e.tickets_sold_out, e.location_name, e.location_city,
           ee.url, ee.deals, ee.left_tickets, ee.city, ee.address_visibility,
           -- Rue montrée seulement quand Shotgun la dit publique (une valeur
           -- inconnue la cache : un lieu secret ne fuit jamais par l'email).
           CASE WHEN COALESCE(lower(btrim(ee.address_visibility)), 'public') IN ('public', 'visible', 'always', 'everyone', 'all')
                THEN NULLIF(btrim(ee.street), '') END AS street
      FROM public.events e
      LEFT JOIN public.external_events ee ON ee.event_id = e.id
     WHERE e.id = ANY (p_event_ids)
       AND e.external_source IS NOT NULL
       AND (COALESCE(auth.role(), '') = 'service_role'
            OR public.is_super_admin()
            OR (auth.uid() IS NOT NULL AND public.can_manage_event_design(auth.uid(), e.id)))
  ), d AS (
    SELECT ev.id AS event_id, x.ord,
           NULLIF(btrim(x.j->>'id'), '') AS did,
           btrim(x.j->>'name') AS name,
           CASE WHEN x.j->>'price' ~ '^[0-9]+(\.[0-9]+)?$' THEN (x.j->>'price')::numeric END AS price,
           CASE WHEN x.j->>'quantity' ~ '^[0-9]+$' THEN (x.j->>'quantity')::integer END AS q
      FROM ev,
           jsonb_array_elements(CASE WHEN jsonb_typeof(ev.deals) = 'array' THEN ev.deals ELSE '[]'::jsonb END)
             WITH ORDINALITY AS x(j, ord)
     WHERE COALESCE(lower(x.j->>'visibility'), 'public') = 'public'
       AND COALESCE(lower(x.j->>'sales_channel'), 'online') = 'online'
       AND NULLIF(btrim(x.j->>'name'), '') IS NOT NULL
  ), sold AS (
    -- Billets vendus par tarif : même rapprochement que _crm_night_tiers
    -- (id Shotgun, sinon nom), mêmes ventes (_crm_ticket_is_sale).
    SELECT d.event_id, d.ord,
           COALESCE((SELECT sum(GREATEST(t.quantity, 1))
                       FROM public.external_tickets t
                      WHERE t.event_id = d.event_id
                        AND public._crm_ticket_is_sale(t.status, t.deal_channel)
                        AND ((d.did IS NOT NULL AND t.deal_id = d.did)
                          OR (lower(btrim(t.deal_name)) = lower(d.name)
                              AND (d.did IS NULL OR t.deal_id IS DISTINCT FROM d.did)))), 0) AS n
      FROM d
  )
  SELECT ev.id,
         COALESCE(ev.url, ev.external_ticket_url),
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'id', d.did,
                    'name', d.name,
                    'price', d.price,
                    'out', (d.q IS NOT NULL AND d.q > 0 AND s.n >= d.q))
                  ORDER BY d.price NULLS LAST, d.ord)
             FROM d JOIN sold s ON s.event_id = d.event_id AND s.ord = d.ord
            WHERE d.event_id = ev.id
         ), '[]'::jsonb),
         ev.left_tickets,
         COALESCE(ev.tickets_sold_out, false),
         NULLIF(concat_ws(' — ',
           NULLIF(btrim(ev.location_name), ''),
           CASE
             WHEN ev.street IS NULL THEN NULLIF(btrim(COALESCE(ev.city, ev.location_city)), '')
             WHEN NULLIF(btrim(COALESCE(ev.city, ev.location_city)), '') IS NOT NULL
              AND position(lower(btrim(COALESCE(ev.city, ev.location_city))) IN lower(ev.street)) = 0
               THEN ev.street || ', ' || btrim(COALESCE(ev.city, ev.location_city))
             ELSE ev.street
           END), '')
    FROM ev;
$function$;
REVOKE ALL ON FUNCTION public.get_external_event_live(p_event_ids uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_external_event_live(p_event_ids uuid[]) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.get_external_event_live(p_event_ids uuid[]) TO "service_role";

-- older · public.get_visitor_stats(p_venue_id text, p_start timestamp with time zone, p_end timestamp with time zone, p_compare_start timestamp with time zone, p_compare_end timestamp with time zone) · dépôt : 20260220150837_8bd7fb9d-c710-4249-98b8-7c5b93ef125e.sql (dernière : 20260503133945_c61ab1fe-3f39-458e-ab3d-9071980e11a5.sql)
CREATE OR REPLACE FUNCTION public.get_visitor_stats(p_venue_id text, p_start timestamp with time zone, p_end timestamp with time zone, p_compare_start timestamp with time zone, p_compare_end timestamp with time zone)
 RETURNS TABLE(current_visits bigint, current_converted bigint, previous_visits bigint, previous_converted bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    (SELECT COUNT(*) FROM visitor_sessions WHERE venue_id = p_venue_id AND visited_at >= p_start AND visited_at < p_end),
    (SELECT COUNT(*) FROM visitor_sessions WHERE venue_id = p_venue_id AND visited_at >= p_start AND visited_at < p_end AND completed_order = true),
    (SELECT COUNT(*) FROM visitor_sessions WHERE venue_id = p_venue_id AND visited_at >= p_compare_start AND visited_at < p_compare_end),
    (SELECT COUNT(*) FROM visitor_sessions WHERE venue_id = p_venue_id AND visited_at >= p_compare_start AND visited_at < p_compare_end AND completed_order = true);
$function$;
REVOKE ALL ON FUNCTION public.get_visitor_stats(p_venue_id text, p_start timestamp with time zone, p_end timestamp with time zone, p_compare_start timestamp with time zone, p_compare_end timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_visitor_stats(p_venue_id text, p_start timestamp with time zone, p_end timestamp with time zone, p_compare_start timestamp with time zone, p_compare_end timestamp with time zone) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_visitor_stats(p_venue_id text, p_start timestamp with time zone, p_end timestamp with time zone, p_compare_start timestamp with time zone, p_compare_end timestamp with time zone) TO "anon";
GRANT EXECUTE ON FUNCTION public.get_visitor_stats(p_venue_id text, p_start timestamp with time zone, p_end timestamp with time zone, p_compare_start timestamp with time zone, p_compare_end timestamp with time zone) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.get_visitor_stats(p_venue_id text, p_start timestamp with time zone, p_end timestamp with time zone, p_compare_start timestamp with time zone, p_compare_end timestamp with time zone) TO "service_role";

-- absent · public.guard_crm_practical_email()
CREATE OR REPLACE FUNCTION public.guard_crm_practical_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_state jsonb;
  v_issues jsonb;
  v_going boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.practical AND NOT NEW.practical THEN
    RAISE EXCEPTION 'crm_practical_locked' USING ERRCODE = 'P0001',
      HINT = 'Un e-mail pratique le reste : en créer un autre pour une campagne marketing.';
  END IF;
  IF NOT NEW.practical THEN
    -- Une campagne CRM « informative » qui n'est pas un e-mail pratique
    -- échapperait aux règles de pression sans rien gagner : le CRM n'a que
    -- deux types, marketing (registre de consentement) ou pratique.
    IF NEW.product = 'crm' AND NEW.type = 'informational'
       AND (TG_OP = 'INSERT' OR OLD.type IS DISTINCT FROM NEW.type OR OLD.product IS DISTINCT FROM NEW.product) THEN
      RAISE EXCEPTION 'crm_informational_requires_practical' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.venue_id IS NULL AND NEW.organizer_user_id IS NULL THEN
    RAISE EXCEPTION 'crm_practical_scope' USING ERRCODE = 'P0001';
  END IF;

  NEW.type := 'informational';
  NEW.product := 'crm';
  NEW.exclusions_json := '{}'::jsonb;

  -- Jamais combinable : ni autre audience, ni segment, ni A/B, ni renvoi,
  -- ni relance, ni enfant d'automatisation.
  IF (jsonb_typeof(NEW.audiences_json) = 'array' AND jsonb_array_length(NEW.audiences_json) > 0)
     OR NEW.segment_id IS NOT NULL THEN
    RAISE EXCEPTION 'crm_practical_audience' USING ERRCODE = 'P0001',
      HINT = 'Un e-mail pratique part aux détenteurs de la soirée, seuls.';
  END IF;
  NEW.audiences_json := '[]'::jsonb;
  IF COALESCE(NEW.ab_enabled, false) OR COALESCE(NEW.resend_enabled, false) OR COALESCE(NEW.followup_enabled, false)
     OR NEW.automation_id IS NOT NULL OR NEW.child_kind IS NOT NULL OR NEW.parent_campaign_id IS NOT NULL THEN
    RAISE EXCEPTION 'crm_practical_feature' USING ERRCODE = 'P0001',
      HINT = 'Ni A/B, ni renvoi, ni relance sur un e-mail pratique.';
  END IF;
  IF NEW.event_id IS NULL THEN
    RAISE EXCEPTION 'crm_practical_event' USING ERRCODE = 'P0001';
  END IF;

  -- Le contenu et la soirée se jugent quand l'e-mail part (envoi, programmé)
  -- et à chaque retouche des blocs pendant qu'il part. Les mises à jour des
  -- compteurs (webhook, tranches) ne relisent rien.
  v_going := NEW.status IN ('sending', 'scheduled')
         AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status
              OR OLD.blocks_json IS DISTINCT FROM NEW.blocks_json
              OR OLD.subject IS DISTINCT FROM NEW.subject
              OR OLD.preheader IS DISTINCT FROM NEW.preheader
              OR OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at);
  IF NOT v_going AND TG_OP = 'UPDATE' AND OLD.event_id IS NOT DISTINCT FROM NEW.event_id THEN
    RETURN NEW;
  END IF;

  v_state := public._crm_practical_night_state(NEW.venue_id, NEW.organizer_user_id, NEW.event_id, NEW.id);
  IF v_state->>'reason' = 'not_mirror' THEN
    RAISE EXCEPTION 'crm_practical_event' USING ERRCODE = 'P0001',
      HINT = 'Un e-mail pratique vise une soirée de la billetterie connectée de cet espace.';
  END IF;
  IF NOT v_going THEN RETURN NEW; END IF;

  v_issues := public._crm_practical_content_issues(NEW.blocks_json, NEW.subject, NEW.preheader, NEW.event_id,
                                                   v_state->>'ticket_url');
  IF jsonb_array_length(v_issues) > 0 THEN
    RAISE EXCEPTION 'crm_practical_content' USING ERRCODE = 'P0001',
      DETAIL = v_issues::text,
      HINT = 'Un e-mail pratique ne vend rien : ni tarif, ni table, ni autre soirée, ni code promo.';
  END IF;

  -- Une campagne déjà partie (tranche suivante, reprise) ne se rejuge pas sur
  -- la fenêtre ou le plafond : elle a été jugée au départ.
  IF TG_OP = 'UPDATE' AND OLD.status IN ('sending', 'paused') AND NEW.status = 'sending' THEN
    RETURN NEW;
  END IF;
  IF NOT COALESCE((v_state->>'eligible')::boolean, false) THEN
    RAISE EXCEPTION '%', 'crm_practical_' || (v_state->>'reason') USING ERRCODE = 'P0001',
      DETAIL = v_state::text;
  END IF;
  IF NEW.status = 'scheduled' AND NEW.scheduled_at IS NOT NULL
     AND NEW.scheduled_at > (v_state->>'window_end')::timestamptz THEN
    RAISE EXCEPTION 'crm_practical_window' USING ERRCODE = 'P0001', DETAIL = v_state::text;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_crm_practical_email() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_crm_practical_email() TO "service_role";

-- rewritten · public.guard_promoter_payout_write() · dépôt : 20260721090000_promoter_payout_reference_dispute.sql
CREATE OR REPLACE FUNCTION public.guard_promoter_payout_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Les jobs serveur (crons, maintenance) gardent la main.
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF COALESCE(current_setting('yuno.payout_rpc', true), '') = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payout_direct_write_forbidden'
      USING HINT = 'Annulez le lot via cancel_promoter_payout.';
  END IF;

  -- On ne verrouille QUE le statut et les horodatages du cycle : un club doit
  -- pouvoir corriger une note ou un libelle de periode librement.
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.disputed_at IS DISTINCT FROM OLD.disputed_at
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.transfer_reference IS DISTINCT FROM OLD.transfer_reference THEN
    RAISE EXCEPTION 'payout_direct_write_forbidden'
      USING HINT = 'Le cycle de reglement passe par declare_promoter_payout_sent / confirm_promoter_payout_received.';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_promoter_payout_write() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_promoter_payout_write() TO "service_role";

-- older · public.is_event_partner_venue_owner(_user_id uuid, _event_id uuid) · dépôt : 20260421103841_b3bf8afe-d0f7-4959-92e5-3d085868dac0.sql (dernière : 20260503132722_df478593-422f-4445-b572-f0e2e981b309.sql)
CREATE OR REPLACE FUNCTION public.is_event_partner_venue_owner(_user_id uuid, _event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.venues v ON v.id = e.partner_venue_id OR v.id = e.venue_id
    WHERE e.id = _event_id
      AND v.owner_id = _user_id
  )
$function$;
REVOKE ALL ON FUNCTION public.is_event_partner_venue_owner(_user_id uuid, _event_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_event_partner_venue_owner(_user_id uuid, _event_id uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_event_partner_venue_owner(_user_id uuid, _event_id uuid) TO "anon";
GRANT EXECUTE ON FUNCTION public.is_event_partner_venue_owner(_user_id uuid, _event_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.is_event_partner_venue_owner(_user_id uuid, _event_id uuid) TO "service_role";

-- rewritten · public.preview_unsubscribe(p_token uuid) · dépôt : 20260428103535_7d3d4017-3702-4465-ab18-765d9bada90d.sql
CREATE OR REPLACE FUNCTION public.preview_unsubscribe(p_token uuid)
 RETURNS TABLE(email text, scope_name text, already_unsubscribed boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ns.email,
         COALESCE(v.name, p.organization_name, p.first_name || ' ' || p.last_name, 'Yuno')::text AS scope_name,
         NOT ns.opted_in AS already_unsubscribed
  FROM public.newsletter_subscriptions ns
  LEFT JOIN public.venues v ON v.id = ns.venue_id
  LEFT JOIN public.profiles p ON p.id = ns.organizer_user_id
  WHERE ns.unsubscribe_token = p_token
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.preview_unsubscribe(p_token uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_unsubscribe(p_token uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_unsubscribe(p_token uuid) TO "anon";
GRANT EXECUTE ON FUNCTION public.preview_unsubscribe(p_token uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.preview_unsubscribe(p_token uuid) TO "service_role";

-- rewritten · public.record_campaign_list_baseline(p_campaign_id uuid) · dépôt : 20260915180000_contact_base_engagement.sql
CREATE OR REPLACE FUNCTION public.record_campaign_list_baseline(p_campaign_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c record; v_snap jsonb;
BEGIN
  SELECT id, venue_id, organizer_user_id INTO c FROM public.email_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT public.contact_scope_allowed_or_internal(c.venue_id, c.organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.email_campaign_list_impact i WHERE i.campaign_id = p_campaign_id AND i.baseline IS NOT NULL) THEN
    RETURN false;
  END IF;
  v_snap := public.contact_base_snapshot(c.venue_id, c.organizer_user_id);
  INSERT INTO public.email_campaign_list_impact (campaign_id, venue_id, organizer_user_id, baseline, baseline_at)
  VALUES (p_campaign_id, c.venue_id, c.organizer_user_id, v_snap, now())
  ON CONFLICT (campaign_id) DO UPDATE SET baseline = EXCLUDED.baseline, baseline_at = EXCLUDED.baseline_at
   WHERE public.email_campaign_list_impact.baseline IS NULL;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_campaign_list_baseline(p_campaign_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_campaign_list_baseline(p_campaign_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.record_campaign_list_baseline(p_campaign_id uuid) TO "service_role";

-- rewritten · public.resolve_campaign_audience(p_campaign_id uuid) · dépôt : 20261005211000_email_push_guards_anon.sql
CREATE OR REPLACE FUNCTION public.resolve_campaign_audience(p_campaign_id uuid)
 RETURNS TABLE(email text, first_name text, last_name text, user_id uuid, unsubscribe_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campaign RECORD;
  v_is_authorized boolean := false;
  v_audiences jsonb := '[]'::jsonb;
  v_excl_recent_days integer := NULL;
  v_excl_buyers boolean := false;
  -- Mode de combinaison des audiences cochées : 'any' (réunir, défaut) ou
  -- 'all' (croiser : le contact doit être dans CHAQUE audience cochée).
  v_match_all boolean := false;
  v_aud_n integer := 0;
BEGIN
  SELECT * INTO v_campaign FROM public.email_campaigns WHERE id = p_campaign_id;
  IF v_campaign IS NULL THEN RETURN; END IF;

  IF v_campaign.venue_id IS NOT NULL THEN
    v_is_authorized := public.is_venue_owner(auth.uid(), v_campaign.venue_id) OR public.is_super_admin();
  ELSIF v_campaign.organizer_user_id IS NOT NULL THEN
    v_is_authorized := COALESCE((v_campaign.organizer_user_id = auth.uid()) OR public.is_super_admin(), false);
  ELSE
    -- Portée plateforme : super admin uniquement.
    v_is_authorized := public.is_super_admin();
  END IF;
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    v_is_authorized := true;
  END IF;
  -- E-mail pratique (Yuno CRM) : l'équipe de l'espace le compose aussi.
  IF v_campaign.practical AND NOT v_is_authorized THEN
    v_is_authorized := public.crm_scope_allowed(v_campaign.venue_id, v_campaign.organizer_user_id);
  END IF;
  IF NOT COALESCE(v_is_authorized, false) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- ── E-mail pratique (Yuno CRM, 20261019150000) ───────────────────────────
  -- Les détenteurs d'un billet valide de la soirée, seuls, sans accord
  -- marketing : l'information d'un achat, jamais une audience combinable.
  IF v_campaign.practical THEN
    RETURN QUERY SELECT * FROM public._crm_practical_audience(p_campaign_id);
    RETURN;
  END IF;

  -- ── Console Yuno CRM ─────────────────────────────────────────────────────
  -- Audiences {kind:'crm', segmentId?, def} : la base clients du CRM, filtrée
  -- par la même définition que l'écran Clients (_crm_filter_sql), et toujours
  -- passée par le registre de consentement de la portée (_crm_campaign_audience).
  IF jsonb_typeof(v_campaign.audiences_json) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_campaign.audiences_json) x WHERE x->>'kind' = 'crm') THEN
    RETURN QUERY SELECT * FROM public._crm_campaign_audience(p_campaign_id);
    RETURN;
  END IF;

  -- ── Portée plateforme ────────────────────────────────────────────────────
  -- Yuno écrit à SA base, jamais à celle d'un club. Une seule source : le
  -- registre plateforme (`newsletter_subscriptions` avec les deux colonnes de
  -- portée à NULL), alimenté par `sync_platform_marketing_contacts` et par les
  -- imports attestés. C'est lui qui porte le jeton de désinscription : aucune
  -- adresse ne peut entrer dans une campagne sans porte de sortie.
  IF v_campaign.venue_id IS NULL AND v_campaign.organizer_user_id IS NULL THEN
    v_audiences := COALESCE(v_campaign.audiences_json, '[]'::jsonb);
    v_aud_n := CASE WHEN jsonb_typeof(v_audiences) = 'array' THEN jsonb_array_length(v_audiences) ELSE 0 END;
    v_match_all := COALESCE(v_campaign.exclusions_json->>'audienceMatch', 'any') = 'all';
    IF jsonb_typeof(v_audiences) <> 'array' OR jsonb_array_length(v_audiences) = 0 THEN
      RETURN;                       -- audience vide ⇒ personne, jamais « tout le monde »
    END IF;

    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    RETURN QUERY
    WITH cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.venue_id IS NULL AND cs.organizer_user_id IS NULL
        CROSS JOIN LATERAL public.resolve_contact_segment_def(NULL, NULL, cs.definition) r
       WHERE r.email IS NOT NULL
    ), cseg_hits AS (
      SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(ch.n, 0)::integer AS seg_hits, 0::integer AS vseg_hits,
             COALESCE(p.first_name, ns.first_name) AS fname,
             COALESCE(p.last_name,  ns.last_name)  AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(ns.source, '') AS src,
             EXISTS (SELECT 1 FROM public.tickets t
                      WHERE LOWER(t.user_email) = LOWER(ns.email) AND t.status = 'paid') AS bought
        FROM public.newsletter_subscriptions ns
        LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE (
         SELECT count(*) FROM jsonb_array_elements(v_audiences) a
          WHERE a->>'kind' NOT IN ('contact_segment','segment') AND CASE a->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'clients'    THEN s.src = 'platform:clients'
            WHEN 'pros'       THEN s.src = 'platform:pros'
            WHEN 'waitlist'   THEN s.src = 'platform:waitlist'
            WHEN 'leads'      THEN s.src = 'platform:leads'
            WHEN 'app_users'  THEN s.uid IS NOT NULL
            WHEN 'no_account' THEN s.uid IS NULL
            WHEN 'buyers'     THEN s.bought
            WHEN 'contact_segment' THEN false  -- compté via seg_hits
            WHEN 'import'     THEN s.imp IS NOT NULL
                                   AND s.imp::text = lower(COALESCE(a->>'importId',''))
            ELSE false
          END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.venue_id IS NULL AND c2.organizer_user_id IS NULL
                AND c2.id <> p_campaign_id
                AND r.status = 'sent'
                AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                AND LOWER(r.email) = m.addr))
       AND (NOT v_excl_buyers OR NOT EXISTS (
             SELECT 1 FROM public.tickets t
              WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                AND LOWER(t.user_email) = m.addr));
    RETURN;
  END IF;

  IF v_campaign.type = 'informational' AND v_campaign.event_id IS NOT NULL THEN
    -- Les acheteurs d'une soirée ne sont joignables en informatif QUE par ses
    -- parties PRINCIPALES : un co-hôte n'a que les contacts qui l'ont nommé
    -- (case du checkout), jamais toute la liste des acheteurs.
    IF NOT public.campaign_scope_is_event_principal(v_campaign.venue_id, v_campaign.organizer_user_id, v_campaign.event_id) THEN
      RETURN;
    END IF;
    IF v_campaign.audience_type IN ('event_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(t.user_email))
        LOWER(t.user_email)::text,
        SPLIT_PART(COALESCE(t.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(t.full_name,''), '^\S+\s*', ''), '')::text,
        t.user_id,
        NULL::uuid
      FROM public.tickets t
      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid' AND t.user_email IS NOT NULL;
    END IF;
    IF v_campaign.audience_type IN ('event_table_buyers','event_all_buyers') THEN
      RETURN QUERY
      SELECT DISTINCT ON (LOWER(tr.user_email))
        LOWER(tr.user_email)::text,
        SPLIT_PART(COALESCE(tr.full_name,''), ' ', 1)::text,
        NULLIF(REGEXP_REPLACE(COALESCE(tr.full_name,''), '^\S+\s*', ''), '')::text,
        tr.user_id,
        NULL::uuid
      FROM public.table_reservations tr
      WHERE tr.event_id = v_campaign.event_id AND tr.status = 'confirmed' AND tr.user_email IS NOT NULL;
    END IF;
    RETURN;
  END IF;

  IF v_campaign.type <> 'promotional' THEN RETURN; END IF;

  IF jsonb_typeof(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(v_campaign.audiences_json, '[]'::jsonb)) > 0 THEN

    v_audiences := v_campaign.audiences_json;
    v_aud_n := CASE WHEN jsonb_typeof(v_audiences) = 'array' THEN jsonb_array_length(v_audiences) ELSE 0 END;
    v_match_all := COALESCE(v_campaign.exclusions_json->>'audienceMatch', 'any') = 'all';
    v_excl_recent_days := CASE
      WHEN COALESCE(v_campaign.exclusions_json->>'recentDays', '') ~ '^[0-9]{1,3}$'
      THEN (v_campaign.exclusions_json->>'recentDays')::integer
      ELSE NULL
    END;
    v_excl_buyers := COALESCE(v_campaign.exclusions_json->>'excludeEventBuyers', 'false') IN ('true', 't', '1')
                     AND v_campaign.event_id IS NOT NULL;

    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      WITH seg_emails AS (
        SELECT DISTINCT LOWER(seg.email) AS addr, vs.id AS sid
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.venue_segments vs
            ON a->>'kind' = 'segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND vs.id = (a->>'segmentId')::uuid
           AND vs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_venue_segment(v_campaign.venue_id, vs.definition) seg
      ), cseg AS (
        -- Segments sur la base importée : la définition est résolue à l'envoi.
        SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
          FROM jsonb_array_elements(v_audiences) a
          JOIN public.contact_segments cs
            ON a->>'kind' = 'contact_segment'
           AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           AND cs.id = (a->>'segmentId')::uuid
           AND cs.venue_id = v_campaign.venue_id
          CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
         WHERE r.email IS NOT NULL
      ), cseg_hits AS (
        SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
      ), vseg_hits AS (
        SELECT addr, count(DISTINCT sid) AS n FROM seg_emails GROUP BY addr
      ), subs AS (
        SELECT LOWER(ns.email) AS addr,
               COALESCE(ch.n, 0)::integer AS seg_hits, COALESCE(vh.n, 0)::integer AS vseg_hits,
               COALESCE(p.first_name, vc.first_name, ns.first_name) AS fname,
               COALESCE(p.last_name,  vc.last_name, ns.last_name)  AS lname,
               ns.user_id AS uid, ns.unsubscribe_token AS tok,
               ns.import_id AS imp,
               COALESCE(vc.total_spent, 0) AS spent,
               (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) AS visits,
               vc.last_visit_at AS last_visit
          FROM public.newsletter_subscriptions ns
          LEFT JOIN public.venue_customers vc
            ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
          LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
          LEFT JOIN vseg_hits vh ON vh.addr = LOWER(ns.email)
          LEFT JOIN public.profiles p ON p.id = ns.user_id
         WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
      ), matched AS (
        SELECT DISTINCT ON (s.addr) s.*
          FROM subs s
         WHERE (
           SELECT count(*) FROM jsonb_array_elements(v_audiences) a
            WHERE a->>'kind' NOT IN ('contact_segment','segment') AND CASE a->>'kind'
              WHEN 'all_subscribers' THEN true
              WHEN 'vip'           THEN s.spent >= 500
              WHEN 'big_spenders'  THEN s.spent >= 1000
              WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
              WHEN 'new_customers' THEN s.visits <= 1
              WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
              WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                     SELECT 1 FROM public.tickets t
                      WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                        AND LOWER(t.user_email) = s.addr)
              WHEN 'segment' THEN false  -- compté via vseg_hits
              WHEN 'contact_segment' THEN false  -- compté via seg_hits
              WHEN 'import'  THEN s.imp IS NOT NULL
                                  AND s.imp::text = lower(COALESCE(a->>'importId',''))
              ELSE false
            END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
      )
      SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
        FROM matched m
       WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
               SELECT 1 FROM public.email_campaign_recipients r
                 JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
                WHERE c2.venue_id = v_campaign.venue_id
                  AND c2.id <> p_campaign_id
                  AND r.status = 'sent'
                  AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                  AND LOWER(r.email) = m.addr))
         AND (NOT v_excl_buyers OR (
               NOT EXISTS (SELECT 1 FROM public.tickets t
                            WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                              AND LOWER(t.user_email) = m.addr)
               AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr
                            WHERE tr.event_id = v_campaign.event_id AND tr.status IN ('paid','confirmed')
                              AND LOWER(tr.user_email) = m.addr)));
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      -- Un client est quelqu'un qui est VENU : billets, tables ET guest list
      -- (contact_scope_customers, la même source que la base de contacts).
      -- Avant, seuls les billets comptaient : un organisateur qui ne vend que
      -- des tables n'avait ni VIP, ni habitué, ni dormant.
      SELECT c.email AS addr,
             COALESCE(c.spent, 0)::numeric AS spent,
             COALESCE(c.event_count, 0) AS visits,
             c.last_at AS last_seen,
             c.first_name AS fname0,
             c.last_name AS lname0
        FROM public.contact_scope_customers(NULL, v_campaign.organizer_user_id) c
    ), cseg AS (
      SELECT DISTINCT LOWER(r.email) AS addr, cs.id AS sid
        FROM jsonb_array_elements(v_audiences) a
        JOIN public.contact_segments cs
          ON a->>'kind' = 'contact_segment'
         AND (a->>'segmentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND cs.id = (a->>'segmentId')::uuid
         AND cs.organizer_user_id = v_campaign.organizer_user_id
        CROSS JOIN LATERAL public.resolve_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition) r
       WHERE r.email IS NOT NULL
    ), cseg_hits AS (
      SELECT addr, count(DISTINCT sid) AS n FROM cseg GROUP BY addr
    ), subs AS (
      SELECT LOWER(ns.email) AS addr,
             COALESCE(ch.n, 0)::integer AS seg_hits, 0::integer AS vseg_hits,
             COALESCE(p.first_name, ns.first_name, a.fname0) AS fname,
             COALESCE(p.last_name, ns.last_name, a.lname0) AS lname,
             ns.user_id AS uid, ns.unsubscribe_token AS tok,
             ns.import_id AS imp,
             COALESCE(a.spent, 0) AS spent,
             COALESCE(a.visits, 0) AS visits,
             a.last_seen AS last_visit
        FROM public.newsletter_subscriptions ns
        LEFT JOIN agg a ON a.addr = LOWER(ns.email)
        LEFT JOIN cseg_hits ch ON ch.addr = LOWER(ns.email)
        LEFT JOIN public.profiles p ON p.id = ns.user_id
       WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
    ), matched AS (
      SELECT DISTINCT ON (s.addr) s.*
        FROM subs s
       WHERE (
         SELECT count(*) FROM jsonb_array_elements(v_audiences) a2
          WHERE a2->>'kind' NOT IN ('contact_segment','segment') AND CASE a2->>'kind'
            WHEN 'all_subscribers' THEN true
            WHEN 'vip'           THEN s.spent >= 500
            WHEN 'big_spenders'  THEN s.spent >= 1000
            WHEN 'regulars'      THEN s.visits BETWEEN 2 AND 4
            WHEN 'new_customers' THEN s.visits <= 1
            WHEN 'dormant'       THEN s.last_visit IS NOT NULL AND s.last_visit < now() - interval '90 days'
            WHEN 'event_subscribers' THEN v_campaign.event_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.tickets t
                    WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                      AND LOWER(t.user_email) = s.addr)
            WHEN 'contact_segment' THEN false  -- compté via seg_hits
            WHEN 'import'  THEN s.imp IS NOT NULL
                                AND s.imp::text = lower(COALESCE(a2->>'importId',''))
            ELSE false
          END) + s.seg_hits + s.vseg_hits >= CASE WHEN v_match_all THEN v_aud_n ELSE 1 END
    )
    SELECT m.addr::text, m.fname::text, m.lname::text, m.uid, m.tok
      FROM matched m
     WHERE (v_excl_recent_days IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.email_campaign_recipients r
               JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
              WHERE c2.organizer_user_id = v_campaign.organizer_user_id
                AND c2.id <> p_campaign_id
                AND r.status = 'sent'
                AND r.sent_at > now() - make_interval(days => v_excl_recent_days)
                AND LOWER(r.email) = m.addr))
       AND (NOT v_excl_buyers OR (
             NOT EXISTS (SELECT 1 FROM public.tickets t
                          WHERE t.event_id = v_campaign.event_id AND t.status = 'paid'
                            AND LOWER(t.user_email) = m.addr)
             AND NOT EXISTS (SELECT 1 FROM public.table_reservations tr
                          WHERE tr.event_id = v_campaign.event_id AND tr.status IN ('paid','confirmed')
                            AND LOWER(tr.user_email) = m.addr)));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'all_subscribers' THEN
    RETURN QUERY
    SELECT LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'event_subscribers' AND v_campaign.event_id IS NOT NULL THEN
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text, p.first_name::text, p.last_name::text, ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.tickets t ON LOWER(t.user_email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.opted_in = true
      AND t.event_id = v_campaign.event_id AND t.status = 'paid'
      AND ((v_campaign.venue_id IS NOT NULL AND ns.venue_id = v_campaign.venue_id)
           OR (v_campaign.organizer_user_id IS NOT NULL AND ns.organizer_user_id = v_campaign.organizer_user_id));
    RETURN;
  END IF;

  IF v_campaign.audience_type = 'custom_segment' THEN
    IF v_campaign.venue_id IS NULL OR v_campaign.segment_id IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT DISTINCT ON (LOWER(ns.email))
      LOWER(ns.email)::text,
      COALESCE(p.first_name, vc.first_name)::text,
      COALESCE(p.last_name, vc.last_name)::text,
      ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN public.resolve_venue_segment(
           v_campaign.venue_id,
           (SELECT vs.definition FROM public.venue_segments vs
             WHERE vs.id = v_campaign.segment_id AND vs.venue_id = v_campaign.venue_id)
         ) seg ON LOWER(seg.email) = LOWER(ns.email)
    LEFT JOIN public.venue_customers vc
      ON vc.venue_id = v_campaign.venue_id AND LOWER(vc.email) = LOWER(ns.email)
    LEFT JOIN public.profiles p ON p.id = ns.user_id
    WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true;
    RETURN;
  END IF;

  IF v_campaign.audience_type IN ('vip','regulars','new_customers','big_spenders','dormant') THEN
    IF v_campaign.venue_id IS NOT NULL THEN
      RETURN QUERY
      SELECT LOWER(ns.email)::text,
             COALESCE(p.first_name, vc.first_name)::text,
             COALESCE(p.last_name, vc.last_name)::text,
             ns.user_id, ns.unsubscribe_token
      FROM public.newsletter_subscriptions ns
      JOIN public.venue_customers vc ON LOWER(vc.email) = LOWER(ns.email) AND vc.venue_id = v_campaign.venue_id
      LEFT JOIN public.profiles p ON p.id = ns.user_id
      WHERE ns.venue_id = v_campaign.venue_id AND ns.opted_in = true
        AND CASE v_campaign.audience_type
          WHEN 'vip' THEN vc.total_spent >= 500
          WHEN 'regulars' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) BETWEEN 2 AND 4
          WHEN 'new_customers' THEN (COALESCE(vc.ticket_count,0) + COALESCE(vc.order_count,0) + COALESCE(vc.table_count,0)) <= 1
          WHEN 'big_spenders' THEN vc.total_spent >= 1000
          WHEN 'dormant' THEN vc.last_visit_at < now() - interval '90 days'
          ELSE FALSE
        END;
      RETURN;
    END IF;

    RETURN QUERY
    WITH agg AS (
      SELECT c.email,
             COALESCE(c.spent, 0)::numeric AS spent,
             COALESCE(c.event_count, 0) AS visits,
             c.last_at AS last_seen,
             c.first_name, c.last_name
        FROM public.contact_scope_customers(NULL, v_campaign.organizer_user_id) c
    )
    SELECT a.email::text,
           a.first_name::text,
           a.last_name::text,
           ns.user_id, ns.unsubscribe_token
    FROM public.newsletter_subscriptions ns
    JOIN agg a ON a.email = LOWER(ns.email)
    WHERE ns.organizer_user_id = v_campaign.organizer_user_id AND ns.opted_in = true
      AND CASE v_campaign.audience_type
        WHEN 'vip' THEN a.spent >= 500
        WHEN 'regulars' THEN a.visits BETWEEN 2 AND 4
        WHEN 'new_customers' THEN a.visits = 1
        WHEN 'big_spenders' THEN a.spent >= 1000
        WHEN 'dormant' THEN a.last_seen < now() - interval '90 days'
        ELSE FALSE
      END;
    RETURN;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.resolve_campaign_audience(p_campaign_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_campaign_audience(p_campaign_id uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.resolve_campaign_audience(p_campaign_id uuid) TO "service_role";

-- rewritten · public.ticketing_after_sync(p_connection_id uuid) · dépôt : 20261018220000_ticketing_after_sync_incremental.sql
CREATE OR REPLACE FUNCTION public.ticketing_after_sync(p_connection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
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
  -- Passe incrémentale (20261018220000) : seuls les billets synchronisés
  -- depuis la dernière passe (marge de 10 min sur l'horloge du connecteur) et
  -- les adresses qu'ils portent sont retraités. Une passe complète au moins
  -- toutes les 24 h, pendant l'import initial, et quand post_full_at est remis
  -- à NULL (TOUTE règle changée ici doit le remettre à NULL, sinon elle ne vaut
  -- que pour les billets qui bougent).
  v_t0 timestamptz := clock_timestamp();
  v_full boolean;
  v_since timestamptz;
  v_emails text[];
  v_new_ext text[] := '{}';
  v_erased integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ticketing_after_sync: service_role only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.ticketing_connections WHERE id = p_connection_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'unknown_connection'); END IF;

  v_full := c.post_synced_at IS NULL OR c.post_full_at IS NULL
            OR c.post_full_at < now() - interval '24 hours'
            OR c.initial_import_done_at IS NULL;
  v_since := c.post_synced_at - interval '10 minutes';
  IF NOT v_full THEN
    -- Adresses à revoir : celles des billets touchés, et celles qu'un billet a
    -- quittées (adresse changée chez la billetterie, ticketing_email_moves) —
    -- sans elles, un retrait d'accord porté par l'ancienne adresse attendrait
    -- la passe complète.
    SELECT COALESCE(array_agg(DISTINCT tch.em), '{}') INTO v_emails FROM (
      SELECT lower(t.buyer_email) AS em FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id AND t.synced_at > v_since AND t.buyer_email IS NOT NULL
      UNION
      SELECT m.email FROM public.ticketing_email_moves m WHERE m.connection_id = p_connection_id
    ) tch;
  END IF;

  -- Import initial : la table grossit de ~3 500 billets par passe, plus vite
  -- que l'autoanalyse. Sur des statistiques périmées, la même passe prenait
  -- 14 s au lieu de 0,3 s (mesuré le 14/10). Au plus une fois par 3 minutes.
  IF c.initial_import_done_at IS NULL
     AND COALESCE((SELECT GREATEST(st.last_analyze, st.last_autoanalyze)
                     FROM pg_stat_user_tables st
                    WHERE st.relid = 'public.external_tickets'::regclass), '-infinity'::timestamptz)
         < now() - interval '3 minutes' THEN
    ANALYZE public.external_tickets;
  END IF;

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
      v_new_ext := v_new_ext || x.external_id;
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
     AND t.event_id IS DISTINCT FROM ee.event_id
     -- Un billet ne change jamais de soirée chez la billetterie, et une soirée
     -- miroir supprimée remet ses billets à NULL (clé SET NULL) : hors passe
     -- complète, seuls les billets sans soirée, touchés, ou d'une soirée
     -- miroir créée à l'instant peuvent avoir à être reliés.
     AND (v_full OR t.event_id IS NULL OR t.synced_at > v_since OR t.external_event_id = ANY (v_new_ext));
  GET DIAGNOSTICS v_linked = ROW_COUNT;

  -- 3b' Contact effacé chez la billetterie (20261019310000) : profil, accord
  --     versé par la billetterie et base de contacts suivent ; adresse écartée
  --     de tout import. Jamais bloquant : la file reste pour la passe suivante.
  BEGIN
    v_erased := public.ticketing_apply_erasures(p_connection_id);
  EXCEPTION WHEN others THEN
    v_erased := -1;
  END;

  -- 3c. Accord newsletter rapporté par la billetterie → registre de la portée.
  --     Jamais un désabonné (la ligne existe : on n'y touche pas), jamais une
  --     adresse purgée (email_opt_outs) ni supprimée (bounce, plainte), jamais
  --     un acheteur dont le DERNIER signal chez la billetterie est un retrait.
  --     Ensembliste depuis 20261016200000 : le dernier signal de chaque
  --     adresse se calcule UNE fois (DISTINCT ON), plus par billet. La
  --     sous-requête corrélée d'avant coûtait n² : vers 30 000 billets, la
  --     passe dépassait les 30 s du service_role et toute la fonction était
  --     annulée (ni soirées miroirs, ni billets reliés, ni contacts). Même
  --     règle qu'avant, mot pour mot.
  IF NOT v_full AND cardinality(v_emails) = 0 THEN
    NULL;  -- aucun billet touché : rien à verser au registre
  ELSIF c.venue_id IS NOT NULL THEN
    WITH last_sig AS (
      -- Dernier signal newsletter de chaque adresse, calculé UNE fois.
      SELECT DISTINCT ON (lower(t.buyer_email))
             lower(t.buyer_email) AS em, t.newsletter_optin AS opt
        FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id
         AND t.buyer_email IS NOT NULL
         AND t.newsletter_optin IS NOT NULL
         AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
       ORDER BY lower(t.buyer_email), COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) DESC NULLS LAST
    ),
    cand AS (
      SELECT DISTINCT ON (lower(t.buyer_email))
             lower(t.buyer_email) AS em, COALESCE(t.purchased_at, t.first_seen_at) AS at,
             t.buyer_first_name AS fn, t.buyer_last_name AS ln
        FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id
         AND t.newsletter_optin IS TRUE
         AND t.buyer_email IS NOT NULL
         AND t.status IN ('valid', 'transferred')
         AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
       ORDER BY lower(t.buyer_email), t.purchased_at DESC NULLS LAST
    )
    INSERT INTO public.newsletter_subscriptions
      (venue_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    SELECT c.venue_id, cd.em, true, 'connector:' || c.provider, 'ticketing', cd.at, cd.fn, cd.ln
      FROM cand cd
      JOIN last_sig l ON l.em = cd.em AND l.opt IS TRUE
     WHERE NOT EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = cd.em)
       AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                        WHERE o.venue_id = c.venue_id AND lower(o.email) = cd.em)
    ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_consent = ROW_COUNT;
  ELSIF c.organizer_user_id IS NOT NULL THEN
    WITH last_sig AS (
      -- Dernier signal newsletter de chaque adresse, calculé UNE fois.
      SELECT DISTINCT ON (lower(t.buyer_email))
             lower(t.buyer_email) AS em, t.newsletter_optin AS opt
        FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id
         AND t.buyer_email IS NOT NULL
         AND t.newsletter_optin IS NOT NULL
         AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
       ORDER BY lower(t.buyer_email), COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) DESC NULLS LAST
    ),
    cand AS (
      SELECT DISTINCT ON (lower(t.buyer_email))
             lower(t.buyer_email) AS em, COALESCE(t.purchased_at, t.first_seen_at) AS at,
             t.buyer_first_name AS fn, t.buyer_last_name AS ln
        FROM public.external_tickets t
       WHERE t.connection_id = p_connection_id
         AND t.newsletter_optin IS TRUE
         AND t.buyer_email IS NOT NULL
         AND t.status IN ('valid', 'transferred')
         AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
       ORDER BY lower(t.buyer_email), t.purchased_at DESC NULLS LAST
    )
    INSERT INTO public.newsletter_subscriptions
      (organizer_user_id, email, opted_in, source, consent_source, consent_recorded_at, first_name, last_name)
    SELECT c.organizer_user_id, cd.em, true, 'connector:' || c.provider, 'ticketing', cd.at, cd.fn, cd.ln
      FROM cand cd
      JOIN last_sig l ON l.em = cd.em AND l.opt IS TRUE
     WHERE NOT EXISTS (SELECT 1 FROM public.email_suppressions s WHERE lower(s.email) = cd.em)
       AND NOT EXISTS (SELECT 1 FROM public.email_opt_outs o
                        WHERE o.organizer_user_id = c.organizer_user_id AND lower(o.email) = cd.em)
    ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_consent = ROW_COUNT;
  END IF;

  -- 3d. Désinscription rapportée par la billetterie : l'accord qu'ELLE avait
  --     donné (source connector:%) est retiré quand son DERNIER signal pour
  --     cette personne est un retrait postérieur à l'accord. Tracé.
  IF v_full OR cardinality(v_emails) > 0 THEN
  WITH g AS (
    SELECT DISTINCT ON (lower(t.buyer_email))
           lower(t.buyer_email) AS em, t.newsletter_optin AS opt,
           COALESCE(t.source_updated_at, t.purchased_at, t.first_seen_at) AS at
      FROM public.external_tickets t
     WHERE t.connection_id = p_connection_id
       AND t.buyer_email IS NOT NULL
       AND t.newsletter_optin IS NOT NULL
       AND (v_full OR lower(t.buyer_email) = ANY (v_emails))
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
  END IF;

  -- 3e. Analyse client (20261010110000) : mémoire des annonces de line-up et
  --     e-mails à recalculer. Jamais bloquant pour la synchro.
  BEGIN
    v_an := public._crm_analysis_mark_sync(p_connection_id);
  EXCEPTION WHEN others THEN
    v_an := jsonb_build_object('error', SQLSTATE);
  END;

  -- La base de contacts de la portée suit les billets (cache relu par la
  -- Console, contact_base_cache_refresh) : marquée dès qu'un billet a bougé.
  IF v_full OR cardinality(v_emails) > 0 OR v_linked > 0 OR v_created > 0 THEN
    UPDATE public.contact_base_cache_state s SET dirty_at = clock_timestamp()
     WHERE s.scope_key = public.contact_base_scope_key(c.venue_id, c.organizer_user_id);
  END IF;

  DELETE FROM public.ticketing_email_moves m WHERE m.connection_id = p_connection_id AND m.at <= v_t0;
  UPDATE public.ticketing_connections
     SET post_synced_at = v_t0,
         post_full_at = CASE WHEN v_full THEN v_t0 ELSE post_full_at END
   WHERE id = p_connection_id;

  RETURN jsonb_build_object('events_created', v_created, 'events_updated', v_updated,
                            'tickets_linked', v_linked, 'consents_added', v_consent,
                            'consents_withdrawn', v_withdrawn, 'contacts_erased', v_erased, 'analysis', v_an,
                            'mode', CASE WHEN v_full THEN 'full' ELSE 'incremental' END,
                            'emails_reviewed', CASE WHEN v_full THEN NULL ELSE cardinality(v_emails) END);
END;
$function$;
REVOKE ALL ON FUNCTION public.ticketing_after_sync(p_connection_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ticketing_after_sync(p_connection_id uuid) TO "service_role";

-- rewritten · public.unsubscribe_by_token(p_token uuid) · dépôt : 20260428101010_d5087a63-fd12-4621-8a2a-1650e2b6dd59.sql
CREATE OR REPLACE FUNCTION public.unsubscribe_by_token(p_token uuid)
 RETURNS TABLE(success boolean, scope_name text, email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sub_id uuid;
  v_email text;
  v_scope_name text;
BEGIN
  SELECT ns.id, ns.email, COALESCE(v.name, p.organization_name, p.first_name || ' ' || p.last_name, 'Yuno')::text
    INTO v_sub_id, v_email, v_scope_name
  FROM public.newsletter_subscriptions ns
  LEFT JOIN public.venues v ON v.id = ns.venue_id
  LEFT JOIN public.profiles p ON p.id = ns.organizer_user_id
  WHERE ns.unsubscribe_token = p_token
  LIMIT 1;

  IF v_sub_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  UPDATE public.newsletter_subscriptions
  SET opted_in = false, opted_out_at = now(), updated_at = now()
  WHERE id = v_sub_id;

  RETURN QUERY SELECT true, v_scope_name, v_email;
END;
$function$;
REVOKE ALL ON FUNCTION public.unsubscribe_by_token(p_token uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unsubscribe_by_token(p_token uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsubscribe_by_token(p_token uuid) TO "anon";
GRANT EXECUTE ON FUNCTION public.unsubscribe_by_token(p_token uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.unsubscribe_by_token(p_token uuid) TO "service_role";

COMMIT;
