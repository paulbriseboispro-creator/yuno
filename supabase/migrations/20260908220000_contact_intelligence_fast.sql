-- ───────────────────────────────────────────────────────────────────────────
-- Segmentation intelligente : évaluation ENSEMBLISTE des définitions.
--
-- Sur la vraie base de Kevin (12 328 contacts), `analyze_contact_lists`
-- prenait 37 s : chaque candidat appelait `contact_row_matches(jsonb, jsonb)`
-- ligne par ligne (24 candidats × 12 328 lignes, chacune re-parsant la
-- définition). Le rôle `authenticated` est plafonné à 8 s par requête : Kevin
-- a vu « canceling statement due to statement timeout » juste après un import
-- réussi.
--
-- Désormais une définition est COMPILÉE une fois en prédicat SQL
-- (`contact_definition_predicate`) et exécutée en une seule requête sur les
-- colonnes typées. Même vocabulaire, même sémantique (condition inconnue ⇒
-- FAUX, attribut absent ⇒ FAUX), 100× plus rapide. Les valeurs sont passées
-- par %L : jamais de SQL injecté depuis une définition.
--
-- `contact_build_rows` matérialise UNE fois la base consolidée avec les
-- drapeaux de joignabilité (opt-in email non supprimé, SMS consenti) ; les
-- fonctions qui bouclent sur plusieurs définitions (analyse, vue d'ensemble)
-- s'en servent. Elles deviennent VOLATILE (une temp table n'est pas permise
-- en contexte STABLE). Le résolveur d'envoi, lui, reste sans temp table :
-- il est appelé depuis des fonctions STABLE (audience email, comptage SMS).
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.contact_definition_predicate(p_definition jsonb, p_alias text DEFAULT 'c')
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  c jsonb;
  parts text[] := '{}';
  a text := quote_ident(COALESCE(p_alias, 'c'));
  t text; op text; sqlop text; v text; lst text; vmin text; vmax text;
BEGIN
  IF p_definition IS NULL OR jsonb_typeof(p_definition->'conditions') <> 'array' THEN
    RETURN 'false';
  END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(p_definition->'conditions') LOOP
    t := c->>'type';
    op := c->>'op';
    sqlop := CASE op WHEN 'gte' THEN '>=' WHEN 'gt' THEN '>' WHEN 'lte' THEN '<=' WHEN 'lt' THEN '<' WHEN 'eq' THEN '=' ELSE NULL END;
    v := c->>'value';
    IF t IN ('country','country_not','zone','city','region','gender','list') THEN
      SELECT string_agg(format('%L', CASE
                 WHEN t IN ('country','country_not') THEN upper(btrim(x))
                 WHEN t IN ('zone','city','region') THEN lower(btrim(x))
                 ELSE x END), ',')
        INTO lst
        FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c->'in') = 'array' THEN c->'in' ELSE '[]'::jsonb END) x;
      IF lst IS NULL THEN parts := parts || 'false'; CONTINUE; END IF;
    END IF;

    CASE t
      WHEN 'country' THEN
        parts := parts || format('(upper(COALESCE(%s.country_code, '''')) IN (%s))', a, lst);
      WHEN 'country_not' THEN
        parts := parts || format('(%s.country_code IS NOT NULL AND upper(%s.country_code) NOT IN (%s))', a, a, lst);
      WHEN 'zone' THEN
        parts := parts || format('(lower(btrim(COALESCE(%s.zone, ''''))) IN (%s))', a, lst);
      WHEN 'city' THEN
        parts := parts || format('(lower(btrim(COALESCE(%s.city, ''''))) IN (%s))', a, lst);
      WHEN 'region' THEN
        parts := parts || format('(lower(btrim(COALESCE(%s.region, ''''))) IN (%s))', a, lst);
      WHEN 'gender' THEN
        parts := parts || format('(COALESCE(%s.gender, '''') IN (%s))', a, lst);
      WHEN 'list' THEN
        parts := parts || format('(%s.list_import_id::text IN (%s))', a, lst);
      WHEN 'spent' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE(%s.total_spent %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'spent_per_event' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE((%s.total_spent / NULLIF(%s.event_count, 0)) %s %s::numeric, false)', a, a, sqlop, v); END IF;
      WHEN 'events' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE(%s.event_count %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'last_purchase_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.last_purchase_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'added_days' THEN
        IF sqlop IS NULL OR v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE((EXTRACT(EPOCH FROM (now() - %s.added_at)) / 86400.0) %s %s::numeric, false)', a, sqlop, v); END IF;
      WHEN 'age' THEN
        vmin := COALESCE(c->>'min', '0'); vmax := COALESCE(c->>'max', '200');
        IF vmin !~ '^[0-9]{1,3}$' OR vmax !~ '^[0-9]{1,3}$' THEN parts := parts || 'false';
        ELSE parts := parts || format('COALESCE(%s.age BETWEEN %s AND %s, false)', a, vmin, vmax); END IF;
      WHEN 'newsletter_opt_in' THEN
        parts := parts || format('COALESCE(%s.newsletter_opt_in = %L::boolean, false)', a, COALESCE(c->>'value', 'true'));
      WHEN 'has_email' THEN
        parts := parts || format('((%s.email IS NOT NULL) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      WHEN 'has_phone' THEN
        parts := parts || format('((%s.phone_e164 IS NOT NULL) = %L::boolean)', a, COALESCE(c->>'value', 'true'));
      ELSE
        parts := parts || 'false';
    END CASE;
  END LOOP;
  IF array_length(parts, 1) IS NULL THEN RETURN 'true'; END IF;
  RETURN '(' || array_to_string(parts, ' AND ') || ')';
END;
$$;

-- ── Base consolidée + joignabilité, en UNE passe (temp table _cr) ───────────
CREATE OR REPLACE FUNCTION public.contact_build_rows(p_venue_id text, p_organizer_user_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  DROP TABLE IF EXISTS _cr;
  CREATE TEMP TABLE _cr ON COMMIT DROP AS
  WITH base AS (
    SELECT * FROM public.contact_rows(p_venue_id, p_organizer_user_id)
  ), ok_e AS (
    SELECT DISTINCT lower(ns.email) AS e
      FROM public.newsletter_subscriptions ns
     WHERE ns.opted_in
       AND ((p_venue_id IS NOT NULL AND ns.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND ns.organizer_user_id = p_organizer_user_id))
  ), sup AS (
    SELECT DISTINCT lower(s.email) AS e FROM public.email_suppressions s
  ), ok_p AS (
    SELECT DISTINCT vc.phone_e164 AS p
      FROM public.venue_sms_contacts vc
     WHERE NOT vc.unsubscribed
       AND vc.sms_consent_at > now() - interval '36 months'
       AND ((p_venue_id IS NOT NULL AND vc.venue_id = p_venue_id)
         OR (p_organizer_user_id IS NOT NULL AND vc.organizer_user_id = p_organizer_user_id))
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
$$;
REVOKE ALL ON FUNCTION public.contact_build_rows(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_build_rows(text, uuid) TO service_role;

-- ── Résolveur d'envoi : une requête, pas de temp table (contexte STABLE) ────
CREATE OR REPLACE FUNCTION public.resolve_contact_segment_def(
  p_venue_id text, p_organizer_user_id uuid, p_definition jsonb
)
RETURNS TABLE(email text, phone_e164 text, first_name text, last_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'resolve_contact_segment_def: exactly one scope required';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT c.email, c.phone_e164, c.first_name, c.last_name FROM public.contact_rows($1, $2) c WHERE %s',
    public.contact_definition_predicate(p_definition, 'c'))
  USING p_venue_id, p_organizer_user_id;
END;
$$;

-- ── Comptage d'une définition (une passe, VOLATILE) ─────────────────────────
CREATE OR REPLACE FUNCTION public.count_contact_segment_def(
  p_venue_id text, p_organizer_user_id uuid, p_definition jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n integer; v_e integer; v_p integer;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.contact_build_rows(p_venue_id, p_organizer_user_id);
  EXECUTE format('SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
                 public.contact_definition_predicate(p_definition, 'c'))
    INTO v_n, v_e, v_p;
  DROP TABLE IF EXISTS _cr;
  RETURN jsonb_build_object('contacts', COALESCE(v_n,0), 'emails', COALESCE(v_e,0), 'phones', COALESCE(v_p,0));
END;
$$;

CREATE OR REPLACE FUNCTION public.count_contact_segment(p_segment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE s public.contact_segments%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.contact_segments WHERE id = p_segment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('contacts', 0, 'emails', 0, 'phones', 0); END IF;
  RETURN public.count_contact_segment_def(s.venue_id, s.organizer_user_id, s.definition);
END;
$$;

-- ── Vue d'ensemble : _cr construite UNE fois, un EXECUTE par segment ────────
CREATE OR REPLACE FUNCTION public.get_contact_intelligence_overview(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
  v_segs jsonb := '[]'::jsonb;
  r record;
  c_n integer; c_e integer; c_p integer;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  v_n := public.contact_build_rows(p_venue_id, p_organizer_user_id);

  FOR r IN
    SELECT cs.* FROM public.contact_segments cs
     WHERE (p_venue_id IS NOT NULL AND cs.venue_id = p_venue_id)
        OR (p_organizer_user_id IS NOT NULL AND cs.organizer_user_id = p_organizer_user_id)
     ORDER BY cs.created_at DESC
  LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
                   public.contact_definition_predicate(r.definition, 'c'))
      INTO c_n, c_e, c_p;
    v_segs := v_segs || jsonb_build_object(
      'id', r.id, 'name', r.name, 'description', r.description, 'definition', r.definition,
      'origin', r.origin, 'suggestion_key', r.suggestion_key, 'created_at', r.created_at,
      'counts', jsonb_build_object('contacts', COALESCE(c_n,0), 'emails', COALESCE(c_e,0), 'phones', COALESCE(c_p,0)));
  END LOOP;
  DROP TABLE IF EXISTS _cr;

  RETURN jsonb_build_object(
    'lists', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', li.id, 'list_name', li.list_name, 'filename', li.filename, 'created_at', li.created_at,
                 'row_count', li.row_count, 'email_count', li.email_count, 'phone_count', li.phone_count,
                 'both_count', li.both_count, 'analyzed_at', li.analyzed_at,
                 'email_import_id', li.email_import_id, 'sms_import_id', li.sms_import_id,
                 'detected_columns', li.detected_columns) ORDER BY li.created_at DESC)
               FROM public.contact_list_imports li
              WHERE (p_venue_id IS NOT NULL AND li.venue_id = p_venue_id)
                 OR (p_organizer_user_id IS NOT NULL AND li.organizer_user_id = p_organizer_user_id)), '[]'::jsonb),
    'segments', v_segs,
    'contacts', v_n,
    'analysis', (SELECT li.analysis FROM public.contact_list_imports li
                  WHERE li.analysis IS NOT NULL
                    AND ((p_venue_id IS NOT NULL AND li.venue_id = p_venue_id)
                      OR (p_organizer_user_id IS NOT NULL AND li.organizer_user_id = p_organizer_user_id))
                  ORDER BY li.analyzed_at DESC LIMIT 1)
  );
END;
$$;

-- ── L'analyse : mêmes candidats, comptage par EXECUTE sur _cr ───────────────
CREATE OR REPLACE FUNCTION public.analyze_contact_lists(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
  v_min integer;
  v_lists integer := 0;
  v_cov jsonb;
  v_facts jsonb;
  v_sugs jsonb := '[]'::jsonb;
  v_home_country text;
  v_home_n integer := 0;
  v_zone_field text := 'zone';
  v_spend_top numeric;
  v_spend_median numeric;
  v_cnt_country integer; v_cnt_zone integer; v_cnt_city integer; v_cnt_spent integer;
  v_cnt_events integer; v_cnt_last integer; v_cnt_age integer; v_cnt_gender integer; v_cnt_news integer;
  v_emails integer; v_phones integer; v_both integer; v_email_ok integer; v_phone_ok integer;
  r record;
  v_c integer; v_ce integer; v_cp integer;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'analyze_contact_lists: exactly one scope required';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  v_n := public.contact_build_rows(p_venue_id, p_organizer_user_id);
  SELECT count(*) INTO v_lists FROM public.contact_list_imports li
   WHERE (p_venue_id IS NOT NULL AND li.venue_id = p_venue_id)
      OR (p_organizer_user_id IS NOT NULL AND li.organizer_user_id = p_organizer_user_id);

  IF v_n = 0 THEN
    DROP TABLE IF EXISTS _cr;
    RETURN jsonb_build_object('generated_at', now(), 'contacts', 0, 'lists', v_lists, 'suggestions', '[]'::jsonb);
  END IF;

  v_min := GREATEST(10, round(v_n * 0.01));

  SELECT count(*) FILTER (WHERE country_code IS NOT NULL),
         count(*) FILTER (WHERE zone IS NOT NULL),
         count(*) FILTER (WHERE city IS NOT NULL),
         count(*) FILTER (WHERE total_spent IS NOT NULL),
         count(*) FILTER (WHERE event_count IS NOT NULL),
         count(*) FILTER (WHERE last_purchase_at IS NOT NULL),
         count(*) FILTER (WHERE age IS NOT NULL),
         count(*) FILTER (WHERE gender IN ('female','male')),
         count(*) FILTER (WHERE newsletter_opt_in IS NOT NULL),
         count(*) FILTER (WHERE email IS NOT NULL),
         count(*) FILTER (WHERE phone_e164 IS NOT NULL),
         count(*) FILTER (WHERE email IS NOT NULL AND phone_e164 IS NOT NULL),
         count(*) FILTER (WHERE email_ok),
         count(*) FILTER (WHERE phone_ok)
    INTO v_cnt_country, v_cnt_zone, v_cnt_city, v_cnt_spent, v_cnt_events, v_cnt_last,
         v_cnt_age, v_cnt_gender, v_cnt_news, v_emails, v_phones, v_both, v_email_ok, v_phone_ok
    FROM _cr;

  v_cov := jsonb_build_object(
    'country', v_cnt_country, 'zone', v_cnt_zone, 'city', v_cnt_city, 'spent', v_cnt_spent,
    'events', v_cnt_events, 'last_purchase', v_cnt_last, 'age', v_cnt_age, 'gender', v_cnt_gender,
    'newsletter', v_cnt_news);

  SELECT country_code, count(*) INTO v_home_country, v_home_n
    FROM _cr WHERE country_code IS NOT NULL GROUP BY country_code ORDER BY count(*) DESC LIMIT 1;
  IF v_cnt_zone < GREATEST(v_cnt_city, 1) * 0.6 THEN v_zone_field := 'city'; END IF;

  SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY total_spent),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY total_spent)
    INTO v_spend_top, v_spend_median
    FROM _cr WHERE total_spent > 0;

  v_facts := jsonb_build_object(
    'top_countries', COALESCE((SELECT jsonb_agg(jsonb_build_object('code', code, 'n', n) ORDER BY n DESC)
                       FROM (SELECT country_code AS code, count(*) AS n FROM _cr WHERE country_code IS NOT NULL
                             GROUP BY country_code ORDER BY n DESC LIMIT 8) t), '[]'::jsonb),
    'zone_field', v_zone_field,
    'top_zones', COALESCE((SELECT jsonb_agg(jsonb_build_object('value', v, 'n', n) ORDER BY n DESC)
                   FROM (SELECT CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END AS v, count(*) AS n
                           FROM _cr WHERE (CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END) IS NOT NULL
                          GROUP BY 1 ORDER BY n DESC LIMIT 10) t), '[]'::jsonb),
    'spend', jsonb_build_object(
      'zero', (SELECT count(*) FROM _cr WHERE total_spent = 0),
      'paid', (SELECT count(*) FROM _cr WHERE total_spent > 0),
      'median_paid', round(COALESCE(v_spend_median, 0), 2),
      'top_threshold', round(COALESCE(v_spend_top, 0), 2),
      'total', (SELECT round(COALESCE(sum(total_spent), 0), 2) FROM _cr),
      'tables', (SELECT count(*) FROM _cr WHERE total_spent / NULLIF(event_count, 0) >= 60)),
    'events', jsonb_build_object(
      'one', (SELECT count(*) FROM _cr WHERE event_count = 1),
      'two_three', (SELECT count(*) FROM _cr WHERE event_count BETWEEN 2 AND 3),
      'four_plus', (SELECT count(*) FROM _cr WHERE event_count >= 4)),
    'recency', jsonb_build_object(
      'd90', (SELECT count(*) FROM _cr WHERE last_purchase_at > now() - interval '90 days'),
      'd365', (SELECT count(*) FROM _cr WHERE last_purchase_at <= now() - interval '90 days' AND last_purchase_at > now() - interval '365 days'),
      'older', (SELECT count(*) FROM _cr WHERE last_purchase_at <= now() - interval '365 days')),
    'age', jsonb_build_object(
      'avg', (SELECT round(avg(age), 1) FROM _cr WHERE age IS NOT NULL),
      'b18_21', (SELECT count(*) FROM _cr WHERE age BETWEEN 18 AND 21),
      'b22_25', (SELECT count(*) FROM _cr WHERE age BETWEEN 22 AND 25),
      'b26_30', (SELECT count(*) FROM _cr WHERE age BETWEEN 26 AND 30),
      'b31', (SELECT count(*) FROM _cr WHERE age >= 31)),
    'gender', jsonb_build_object(
      'female', (SELECT count(*) FROM _cr WHERE gender = 'female'),
      'male', (SELECT count(*) FROM _cr WHERE gender = 'male')),
    'newsletter_yes', (SELECT count(*) FROM _cr WHERE newsletter_opt_in = true),
    'channels', jsonb_build_object('emails', v_emails, 'phones', v_phones, 'both', v_both,
                                   'emails_reachable', v_email_ok, 'phones_reachable', v_phone_ok)
  );

  DROP TABLE IF EXISTS _cand;
  CREATE TEMP TABLE _cand (ord serial, key text, grp text, def jsonb, params jsonb) ON COMMIT DROP;

  IF v_cnt_country >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params)
    SELECT 'geo_country:' || code, 'geo',
           jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'country', 'in', jsonb_build_array(code)))),
           jsonb_build_object('code', code)
      FROM (SELECT country_code AS code, count(*) AS n FROM _cr WHERE country_code IS NOT NULL
             GROUP BY country_code HAVING count(*) >= GREATEST(v_min, v_n * 0.02) ORDER BY n DESC LIMIT 6) t;
    IF v_home_country IS NOT NULL THEN
      INSERT INTO _cand (key, grp, def, params) VALUES
        ('geo_abroad', 'geo',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'country_not', 'in', jsonb_build_array(v_home_country)))),
         jsonb_build_object('home', v_home_country));
    END IF;
  END IF;
  IF GREATEST(v_cnt_zone, v_cnt_city) >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params)
    SELECT 'geo_zone:' || lower(v), 'geo',
           jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', v_zone_field, 'in', jsonb_build_array(v)))),
           jsonb_build_object('zone', v, 'field', v_zone_field)
      FROM (SELECT CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END AS v, count(*) AS n
              FROM _cr WHERE (CASE WHEN v_zone_field = 'zone' THEN zone ELSE city END) IS NOT NULL
             GROUP BY 1 HAVING count(*) >= GREATEST(v_min, v_n * 0.02) ORDER BY n DESC LIMIT 8) t;
  END IF;

  IF v_cnt_spent >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('spend_free', 'spend',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'spent', 'op', 'eq', 'value', 0))),
       '{}'::jsonb),
      ('spend_tickets', 'spend',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'spent', 'op', 'gt', 'value', 0),
         jsonb_build_object('type', 'spent_per_event', 'op', 'lt', 'value', 60))),
       jsonb_build_object('median', round(COALESCE(v_spend_median, 0)))),
      ('spend_tables', 'spend',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'spent_per_event', 'op', 'gte', 'value', 60))),
       jsonb_build_object('threshold', 60));
    IF COALESCE(v_spend_top, 0) > 0 THEN
      INSERT INTO _cand (key, grp, def, params) VALUES
        ('spend_top', 'spend',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'spent', 'op', 'gte', 'value', round(v_spend_top)))),
         jsonb_build_object('threshold', round(v_spend_top)));
    END IF;
  END IF;

  IF v_cnt_events >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('freq_once', 'freq',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'events', 'op', 'eq', 'value', 1))), '{}'::jsonb),
      ('freq_regular', 'freq',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'events', 'op', 'gte', 'value', 2), jsonb_build_object('type', 'events', 'op', 'lte', 'value', 3))), '{}'::jsonb),
      ('freq_loyal', 'freq',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'events', 'op', 'gte', 'value', 4))), '{}'::jsonb);
  END IF;

  IF v_cnt_last >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('recent_active', 'recency',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'last_purchase_days', 'op', 'lte', 'value', 90))), '{}'::jsonb),
      ('recent_lapsed', 'recency',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'last_purchase_days', 'op', 'gt', 'value', 90), jsonb_build_object('type', 'last_purchase_days', 'op', 'lte', 'value', 365))), '{}'::jsonb),
      ('recent_dormant', 'recency',
       jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'last_purchase_days', 'op', 'gt', 'value', 365))), '{}'::jsonb);
    IF v_cnt_events >= v_n * 0.3 THEN
      INSERT INTO _cand (key, grp, def, params) VALUES
        ('winback_regulars', 'recency',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
           jsonb_build_object('type', 'events', 'op', 'gte', 'value', 2), jsonb_build_object('type', 'last_purchase_days', 'op', 'gt', 'value', 120))), '{}'::jsonb),
        ('new_recent', 'recency',
         jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
           jsonb_build_object('type', 'events', 'op', 'eq', 'value', 1), jsonb_build_object('type', 'last_purchase_days', 'op', 'lte', 'value', 60))), '{}'::jsonb);
    END IF;
  END IF;

  IF v_cnt_age >= v_n * 0.4 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('age_18_21', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 18, 'max', 21))), '{}'::jsonb),
      ('age_22_25', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 22, 'max', 25))), '{}'::jsonb),
      ('age_26_30', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 26, 'max', 30))), '{}'::jsonb),
      ('age_31_plus', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'age', 'min', 31, 'max', 120))), '{}'::jsonb);
  END IF;
  IF v_cnt_gender >= v_n * 0.4 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('gender_female', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'gender', 'in', jsonb_build_array('female')))), '{}'::jsonb),
      ('gender_male', 'demo', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'gender', 'in', jsonb_build_array('male')))), '{}'::jsonb);
  END IF;

  IF v_cnt_news >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('newsletter_yes', 'consent', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'newsletter_opt_in', 'value', true))), '{}'::jsonb);
  END IF;

  IF v_phones > 0 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('channel_both', 'channel', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'has_email', 'value', true), jsonb_build_object('type', 'has_phone', 'value', true))), '{}'::jsonb),
      ('channel_sms_only', 'channel', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'has_email', 'value', false), jsonb_build_object('type', 'has_phone', 'value', true))), '{}'::jsonb);
  END IF;

  FOR r IN SELECT * FROM _cand ORDER BY ord LOOP
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE c.email_ok), count(*) FILTER (WHERE c.phone_ok) FROM _cr c WHERE %s',
                   public.contact_definition_predicate(r.def, 'c'))
      INTO v_c, v_ce, v_cp;
    IF v_c >= v_min THEN
      v_sugs := v_sugs || jsonb_build_object(
        'key', r.key, 'group', r.grp, 'definition', r.def, 'params', r.params,
        'contacts', v_c, 'emails', v_ce, 'phones', v_cp,
        'share', round(v_c::numeric / v_n, 4),
        'existing_id', (SELECT cs.id FROM public.contact_segments cs
                         WHERE cs.suggestion_key = r.key
                           AND ((p_venue_id IS NOT NULL AND cs.venue_id = p_venue_id)
                             OR (p_organizer_user_id IS NOT NULL AND cs.organizer_user_id = p_organizer_user_id))
                         LIMIT 1));
    END IF;
  END LOOP;

  DROP TABLE IF EXISTS _cand;
  DROP TABLE IF EXISTS _cr;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'contacts', v_n,
    'lists', v_lists,
    'min_size', v_min,
    'home_country', v_home_country,
    'coverage', v_cov,
    'facts', v_facts,
    'suggestions', v_sugs
  );
END;
$$;
