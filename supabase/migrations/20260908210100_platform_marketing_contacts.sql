-- ───────────────────────────────────────────────────────────────────────────
-- Marketing plateforme — la base de contacts de Yuno.
--
-- Le registre de consentement est le MÊME que celui des pros :
-- `newsletter_subscriptions` pour l'email, `venue_sms_contacts` pour le SMS,
-- avec les deux colonnes de portée à NULL. C'est ce qui donne gratuitement le
-- lien de désinscription (`unsubscribe_token` + /unsubscribe), le STOP SMS, la
-- liste de suppression globale et les imports attestés.
--
-- RÈGLE : une personne n'entre JAMAIS dans une campagne sans passer par ce
-- registre. Les sources internes (comptes, liste d'attente, leads pro) y sont
-- VERSÉES par `sync_platform_marketing_contacts`, jamais lues en direct au
-- moment de l'envoi — sinon un destinataire n'aurait pas de jeton de
-- désinscription, et un email marketing sans porte de sortie ne part pas.
--
-- Ce que la synchro ne fait jamais :
--   • réveiller un désabonné explicite (`opted_out_at` posé) — comme l'import ;
--   • écrire une adresse sur la liste de suppression (bounce/plainte) ;
--   • compter la démo (`is_demo_email`) ni les profils orphelins — voir
--     docs/ORPHAN_PROFILES.md, une ligne `profiles` sans `auth.users` n'est
--     plus un compte.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.contact_rows(p_venue_id text, p_organizer_user_id uuid)
 RETURNS SETOF imported_contacts
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (COALESCE(c.email, c.phone_e164)) c.*
    FROM public.imported_contacts c
   WHERE public.marketing_scope_match(c.venue_id, c.organizer_user_id, p_venue_id, p_organizer_user_id)
   ORDER BY COALESCE(c.email, c.phone_e164),
            c.created_at DESC,
            ((c.phone_e164 IS NOT NULL)::int + (c.total_spent IS NOT NULL)::int + (c.event_count IS NOT NULL)::int
             + (c.last_purchase_at IS NOT NULL)::int + (c.zone IS NOT NULL)::int + (c.city IS NOT NULL)::int
             + (c.country_code IS NOT NULL)::int + (c.age IS NOT NULL)::int + (c.gender IS NOT NULL)::int) DESC,
            c.id;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_contact_segment_def(p_venue_id text, p_organizer_user_id uuid, p_definition jsonb)
 RETURNS TABLE(email text, phone_e164 text, first_name text, last_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'resolve_contact_segment_def: une seule portée à la fois (club OU organisateur OU plateforme)';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.email, c.phone_e164, c.first_name, c.last_name
    FROM public.contact_rows(p_venue_id, p_organizer_user_id) c
   WHERE public.contact_row_matches(to_jsonb(c), p_definition);
END;
$function$;

CREATE OR REPLACE FUNCTION public.count_contact_segment_def(p_venue_id text, p_organizer_user_id uuid, p_definition jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer; v_e integer; v_p integer;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT count(*),
         count(*) FILTER (WHERE r.email IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.newsletter_subscriptions ns
            WHERE lower(ns.email) = r.email AND ns.opted_in
              AND (public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id))
         ) AND NOT public.is_email_suppressed(r.email)),
         count(*) FILTER (WHERE r.phone_e164 IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.venue_sms_contacts vc
            WHERE vc.phone_e164 = r.phone_e164 AND NOT vc.unsubscribed
              AND vc.sms_consent_at > now() - interval '36 months'
              AND (public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, p_venue_id, p_organizer_user_id))
         ))
    INTO v_n, v_e, v_p
    FROM public.resolve_contact_segment_def(p_venue_id, p_organizer_user_id, p_definition) r;
  RETURN jsonb_build_object('contacts', COALESCE(v_n,0), 'emails', COALESCE(v_e,0), 'phones', COALESCE(v_p,0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_contact_segments(p_venue_id text, p_organizer_user_id uuid, p_segments jsonb, p_list_import_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  x jsonb; v_id uuid; v_out jsonb := '[]'::jsonb;
  v_name text; v_key text; v_def jsonb; v_desc text;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'save_contact_segments: une seule portée à la fois (club OU organisateur OU plateforme)';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_segments, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_segments doit être un tableau';
  END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(p_segments) LOOP
    v_name := NULLIF(left(btrim(COALESCE(x->>'name', '')), 80), '');
    v_key := NULLIF(btrim(COALESCE(x->>'key', '')), '');
    v_desc := NULLIF(left(btrim(COALESCE(x->>'description', '')), 400), '');
    v_def := x->'definition';
    IF v_name IS NULL OR v_def IS NULL OR jsonb_typeof(v_def->'conditions') <> 'array' THEN CONTINUE; END IF;

    -- Même clé de proposition déjà créée : on rafraîchit la définition et le nom.
    v_id := NULL;
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_id FROM public.contact_segments cs
       WHERE cs.suggestion_key = v_key
         AND (public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id))
       LIMIT 1;
    END IF;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.contact_segments cs
       WHERE lower(cs.name) = lower(v_name)
         AND (public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id))
       LIMIT 1;
    END IF;

    IF v_id IS NULL THEN
      INSERT INTO public.contact_segments
        (venue_id, organizer_user_id, name, description, definition, origin, suggestion_key, list_import_id, created_by)
      VALUES (p_venue_id, p_organizer_user_id, v_name, v_desc, v_def,
              CASE WHEN v_key IS NULL THEN 'manual' ELSE 'suggested' END, v_key, p_list_import_id, v_uid)
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.contact_segments
         SET name = v_name, description = COALESCE(v_desc, description), definition = v_def,
             suggestion_key = COALESCE(suggestion_key, v_key),
             list_import_id = COALESCE(p_list_import_id, list_import_id)
       WHERE id = v_id;
    END IF;
    v_out := v_out || jsonb_build_object('key', v_key, 'id', v_id, 'name', v_name);
  END LOOP;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_contact_intelligence_overview(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'lists', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', li.id, 'list_name', li.list_name, 'filename', li.filename, 'created_at', li.created_at,
                 'row_count', li.row_count, 'email_count', li.email_count, 'phone_count', li.phone_count,
                 'both_count', li.both_count, 'analyzed_at', li.analyzed_at,
                 'email_import_id', li.email_import_id, 'sms_import_id', li.sms_import_id,
                 'detected_columns', li.detected_columns) ORDER BY li.created_at DESC)
               FROM public.contact_list_imports li
              WHERE public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id)), '[]'::jsonb),
    'segments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', cs.id, 'name', cs.name, 'description', cs.description, 'definition', cs.definition,
                 'origin', cs.origin, 'suggestion_key', cs.suggestion_key, 'created_at', cs.created_at,
                 'counts', public.count_contact_segment_def(cs.venue_id, cs.organizer_user_id, cs.definition))
                 ORDER BY cs.created_at DESC)
               FROM public.contact_segments cs
              WHERE public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id)), '[]'::jsonb),
    'contacts', (SELECT count(*) FROM public.contact_rows(p_venue_id, p_organizer_user_id)),
    'analysis', (SELECT li.analysis FROM public.contact_list_imports li
                  WHERE li.analysis IS NOT NULL
                    AND (public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id))
                  ORDER BY li.analyzed_at DESC LIMIT 1)
  ) INTO v;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.analyze_contact_lists(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'analyze_contact_lists: une seule portée à la fois (club OU organisateur OU plateforme)';
  END IF;
  IF NOT public.contact_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  DROP TABLE IF EXISTS _cr;
  CREATE TEMP TABLE _cr ON COMMIT DROP AS
  SELECT c.*, to_jsonb(c) AS j,
         (c.email IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.newsletter_subscriptions ns
            WHERE lower(ns.email) = c.email AND ns.opted_in
              AND (public.marketing_scope_match(ns.venue_id, ns.organizer_user_id, p_venue_id, p_organizer_user_id)))
          AND NOT public.is_email_suppressed(c.email)) AS email_ok,
         (c.phone_e164 IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.venue_sms_contacts vc
            WHERE vc.phone_e164 = c.phone_e164 AND NOT vc.unsubscribed
              AND vc.sms_consent_at > now() - interval '36 months'
              AND (public.marketing_scope_match(vc.venue_id, vc.organizer_user_id, p_venue_id, p_organizer_user_id)))) AS phone_ok
    FROM public.contact_rows(p_venue_id, p_organizer_user_id) c;

  SELECT count(*) INTO v_n FROM _cr;
  SELECT count(*) INTO v_lists FROM public.contact_list_imports li
   WHERE public.marketing_scope_match(li.venue_id, li.organizer_user_id, p_venue_id, p_organizer_user_id);

  IF v_n = 0 THEN
    RETURN jsonb_build_object('generated_at', now(), 'contacts', 0, 'lists', v_lists, 'suggestions', '[]'::jsonb);
  END IF;

  -- Taille minimale d'un segment proposé : 10 personnes ou 1 % de la base.
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

  -- Pays d'attache = le plus fréquent.
  SELECT country_code, count(*) INTO v_home_country, v_home_n
    FROM _cr WHERE country_code IS NOT NULL GROUP BY country_code ORDER BY count(*) DESC LIMIT 1;
  -- Zone : la colonne « zone géographique » si elle est bien remplie, sinon la ville.
  IF v_cnt_zone < GREATEST(v_cnt_city, 1) * 0.6 THEN v_zone_field := 'city'; END IF;

  -- Seuil « meilleurs clients » : 90e percentile des dépenses parmi ceux qui ont payé.
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

  -- ── Candidats ────────────────────────────────────────────────────────────
  DROP TABLE IF EXISTS _cand;
  CREATE TEMP TABLE _cand (ord serial, key text, grp text, def jsonb, params jsonb) ON COMMIT DROP;

  -- Géographie
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

  -- Dépenses
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

  -- Fréquence
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

  -- Récence
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

  -- Démographie
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

  -- Consentement déclaré dans l'ancien outil
  IF v_cnt_news >= v_n * 0.3 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('newsletter_yes', 'consent', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(jsonb_build_object('type', 'newsletter_opt_in', 'value', true))), '{}'::jsonb);
  END IF;

  -- Canaux
  IF v_phones > 0 THEN
    INSERT INTO _cand (key, grp, def, params) VALUES
      ('channel_both', 'channel', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'has_email', 'value', true), jsonb_build_object('type', 'has_phone', 'value', true))), '{}'::jsonb),
      ('channel_sms_only', 'channel', jsonb_build_object('version', 1, 'match', 'all', 'conditions', jsonb_build_array(
         jsonb_build_object('type', 'has_email', 'value', false), jsonb_build_object('type', 'has_phone', 'value', true))), '{}'::jsonb);
  END IF;

  -- ── Effectifs réels par candidat ─────────────────────────────────────────
  FOR r IN SELECT * FROM _cand ORDER BY ord LOOP
    SELECT count(*), count(*) FILTER (WHERE email_ok), count(*) FILTER (WHERE phone_ok)
      INTO v_c, v_ce, v_cp
      FROM _cr x WHERE public.contact_row_matches(x.j, r.def);
    IF v_c >= v_min THEN
      v_sugs := v_sugs || jsonb_build_object(
        'key', r.key, 'group', r.grp, 'definition', r.def, 'params', r.params,
        'contacts', v_c, 'emails', v_ce, 'phones', v_cp,
        'share', round(v_c::numeric / v_n, 4),
        'existing_id', (SELECT cs.id FROM public.contact_segments cs
                         WHERE cs.suggestion_key = r.key
                           AND (public.marketing_scope_match(cs.venue_id, cs.organizer_user_id, p_venue_id, p_organizer_user_id))
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
$function$;

CREATE OR REPLACE FUNCTION public.import_sms_contacts(p_contacts jsonb, p_consent_source text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_filename text DEFAULT NULL::text, p_consent_details text DEFAULT NULL::text, p_collected_since date DEFAULT NULL::date, p_import_id uuid DEFAULT NULL::uuid, p_list_name text DEFAULT NULL::text, p_default_country text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_import_id uuid := p_import_id;
  v_uid uuid := auth.uid();
  v_submitted integer := 0;
  v_valid integer := 0;
  v_invalid integer := 0;
  v_dupes integer := 0;
  v_suppressed integer := 0;
  v_inserted integer := 0;
  v_unchanged integer := 0;
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'import_sms_contacts: une seule portée à la fois';
  END IF;
  IF NOT public.sms_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'Import indisponible en session support';
  END IF;
  IF p_consent_source IS NULL OR p_consent_source NOT IN
     ('in_person','website_form','ticketing','social','other_tool','other') THEN
    RAISE EXCEPTION 'Origine du consentement requise';
  END IF;

  SELECT count(*) INTO v_submitted FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb));
  IF v_submitted > 2000 THEN
    RAISE EXCEPTION 'Maximum 2000 contacts par appel (reçu %)', v_submitted;
  END IF;

  IF v_import_id IS NULL THEN
    INSERT INTO public.sms_list_imports
      (venue_id, organizer_user_id, filename, list_name, consent_source, consent_details,
       collected_since, default_country, attested_by)
    VALUES (p_venue_id, p_organizer_user_id, p_filename,
            NULLIF(left(btrim(COALESCE(p_list_name, '')), 60), ''),
            p_consent_source, p_consent_details, p_collected_since, p_default_country, v_uid)
    RETURNING id INTO v_import_id;
  ELSE
    PERFORM 1 FROM public.sms_list_imports
     WHERE id = v_import_id
       AND public.marketing_scope_match(venue_id, organizer_user_id, p_venue_id, p_organizer_user_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Import inconnu'; END IF;
  END IF;

  -- Normalisation + dédoublonnage intra-fichier + validation.
  CREATE TEMP TABLE _sms_in ON COMMIT DROP AS
  WITH raw AS (
    SELECT public.normalize_phone_e164(COALESCE(x->>'phone','')) AS phone,
           NULLIF(btrim(COALESCE(x->>'first_name','')), '') AS fname,
           NULLIF(btrim(COALESCE(x->>'last_name','')), '')  AS lname,
           row_number() OVER () AS ord
      FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb)) x
  )
  SELECT DISTINCT ON (COALESCE(phone, 'invalid-' || ord::text))
         phone, fname, lname,
         phone IS NOT NULL AND phone ~ '^\+[1-9][0-9]{6,14}$' AS valid
    FROM raw
   ORDER BY COALESCE(phone, 'invalid-' || ord::text), ord;

  SELECT count(*) FILTER (WHERE valid), count(*) FILTER (WHERE NOT valid)
    INTO v_valid, v_invalid FROM _sms_in;
  v_dupes := v_submitted - (v_valid + v_invalid);

  -- Liste repoussoir : un numéro qui a répondu STOP ou s'est retiré, où que ce
  -- soit chez ce pro, n'est jamais réabonné par un import. Un STOP est global
  -- (le numéro d'envoi est partagé) : on regarde toutes les portées.
  CREATE TEMP TABLE _sms_block ON COMMIT DROP AS
  SELECT DISTINCT i.phone
    FROM _sms_in i
   WHERE i.valid AND EXISTS (
     SELECT 1 FROM public.venue_sms_contacts c
      WHERE c.phone_e164 = i.phone AND c.unsubscribed
   );
  SELECT count(*) INTO v_suppressed FROM _sms_block;

  IF p_venue_id IS NOT NULL THEN
    WITH ins AS (
      INSERT INTO public.venue_sms_contacts
        (venue_id, organizer_user_id, phone_e164, full_name, sms_consent_at, consent_source, import_id, is_vip)
      SELECT p_venue_id, NULL, i.phone,
             btrim(concat_ws(' ', i.fname, i.lname)),
             now(), 'import', v_import_id, false
        FROM _sms_in i
       WHERE i.valid AND i.phone NOT IN (SELECT phone FROM _sms_block)
      ON CONFLICT (venue_id, phone_e164) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    WITH ins AS (
      INSERT INTO public.venue_sms_contacts
        (venue_id, organizer_user_id, phone_e164, full_name, sms_consent_at, consent_source, import_id, is_vip)
      SELECT NULL, p_organizer_user_id, i.phone,
             btrim(concat_ws(' ', i.fname, i.lname)),
             now(), 'import', v_import_id, false
        FROM _sms_in i
       WHERE i.valid AND i.phone NOT IN (SELECT phone FROM _sms_block)
      ON CONFLICT (organizer_user_id, phone_e164) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;
  ELSE
    -- Portée plateforme : l'arbitre est l'index PARTIEL posé par
    -- 20260908210000. Sans le WHERE, Postgres ne le reconnaît pas (42P10).
    WITH ins AS (
      INSERT INTO public.venue_sms_contacts
        (venue_id, organizer_user_id, phone_e164, full_name, sms_consent_at, consent_source, import_id, is_vip)
      SELECT NULL, NULL, i.phone,
             btrim(concat_ws(' ', i.fname, i.lname)),
             now(), 'import', v_import_id, false
        FROM _sms_in i
       WHERE i.valid AND i.phone NOT IN (SELECT phone FROM _sms_block)
      ON CONFLICT (phone_e164) WHERE venue_id IS NULL AND organizer_user_id IS NULL DO NOTHING
      RETURNING 1
    )
    SELECT count(*) INTO v_inserted FROM ins;
  END IF;

  -- Déjà présents (consentement checkout ou import antérieur) : on ne touche à
  -- rien, la preuve d'origine reste la première.
  v_unchanged := GREATEST(0, (v_valid - v_suppressed) - v_inserted);

  UPDATE public.sms_list_imports
     SET submitted_count = submitted_count + v_submitted,
         inserted_count = inserted_count + v_inserted,
         duplicate_count = duplicate_count + v_dupes,
         invalid_count = invalid_count + v_invalid,
         suppressed_count = suppressed_count + v_suppressed,
         unchanged_count = unchanged_count + v_unchanged
   WHERE id = v_import_id;

  DROP TABLE IF EXISTS _sms_in;
  DROP TABLE IF EXISTS _sms_block;

  RETURN jsonb_build_object(
    'import_id', v_import_id,
    'submitted', v_submitted,
    'valid', v_valid,
    'invalid', v_invalid,
    'duplicates', v_dupes,
    'suppressed', v_suppressed,
    'inserted', v_inserted,
    'unchanged', v_unchanged
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_email_contacts(p_contacts jsonb, p_consent_source text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_filename text DEFAULT NULL::text, p_consent_details text DEFAULT NULL::text, p_collected_since date DEFAULT NULL::date, p_import_id uuid DEFAULT NULL::uuid, p_list_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_import_id uuid := p_import_id;
  v_uid uuid := auth.uid();
  v_submitted integer := 0;
  v_valid integer := 0;
  v_invalid integer := 0;
  v_dupes integer := 0;
  v_suppressed integer := 0;
  v_inserted integer := 0;
  v_reactivated integer := 0;
  v_optout integer := 0;
BEGIN
  -- 1. Périmètre : exactement un propriétaire.
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'import_email_contacts: une seule portée à la fois';
  END IF;

  -- 2. Autorisation.
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(v_uid, p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (p_organizer_user_id = v_uid OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSE
    -- Portée plateforme : la base marketing de Yuno elle-même.
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;

  -- 3. Jamais depuis une session support.
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'Import indisponible en session support';
  END IF;

  IF p_consent_source IS NULL OR p_consent_source NOT IN
     ('in_person','website_form','ticketing','social','other_tool','other') THEN
    RAISE EXCEPTION 'Origine du consentement requise';
  END IF;

  SELECT count(*) INTO v_submitted
    FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb));
  IF v_submitted > 2000 THEN
    RAISE EXCEPTION 'Maximum 2000 contacts par appel (reçu %)', v_submitted;
  END IF;

  -- 4. Ligne d'import (créée au 1er lot, réutilisée par les suivants).
  IF v_import_id IS NULL THEN
    INSERT INTO public.email_list_imports
      (venue_id, organizer_user_id, filename, consent_source, consent_details,
       collected_since, attested_by, list_name)
    VALUES (p_venue_id, p_organizer_user_id, p_filename, p_consent_source,
            p_consent_details, p_collected_since, v_uid,
            NULLIF(btrim(COALESCE(p_list_name, '')), ''))
    RETURNING id INTO v_import_id;
  ELSE
    PERFORM 1 FROM public.email_list_imports
     WHERE id = v_import_id
       AND public.marketing_scope_match(venue_id, organizer_user_id, p_venue_id, p_organizer_user_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Import inconnu'; END IF;
  END IF;

  -- 5. Normalisation + dédoublonnage intra-fichier + validation.
  CREATE TEMP TABLE _in ON COMMIT DROP AS
  WITH raw AS (
    SELECT lower(btrim(COALESCE(x->>'email',''))) AS addr,
           NULLIF(btrim(COALESCE(x->>'first_name','')), '') AS fname,
           NULLIF(btrim(COALESCE(x->>'last_name','')), '')  AS lname,
           row_number() OVER () AS ord
      FROM jsonb_array_elements(COALESCE(p_contacts, '[]'::jsonb)) x
  )
  SELECT DISTINCT ON (addr) addr, fname, lname,
         addr ~ '^[^@\s;,]+@[^@\s;,.]+(\.[^@\s;,.]+)+$' AS valid
    FROM raw
   ORDER BY addr, ord;

  SELECT count(*) FILTER (WHERE valid),
         count(*) FILTER (WHERE NOT valid)
    INTO v_valid, v_invalid FROM _in;
  v_dupes := v_submitted - (v_valid + v_invalid);

  SELECT count(*) INTO v_suppressed
    FROM _in WHERE valid AND public.is_email_suppressed(addr);

  -- 6. Écriture. Le WHERE du DO UPDATE est la règle n°2 : un désabonné
  --    explicite n'est jamais réactivé par un import.
  IF p_venue_id IS NOT NULL THEN
    WITH up AS (
      INSERT INTO public.newsletter_subscriptions
        (venue_id, email, opted_in, source, import_id, consent_source, consent_recorded_at,
         first_name, last_name)
      SELECT p_venue_id, i.addr, true, 'import', v_import_id, p_consent_source, now(),
             i.fname, i.lname
        FROM _in i
       WHERE i.valid AND NOT public.is_email_suppressed(i.addr)
      ON CONFLICT (lower(email), venue_id) WHERE venue_id IS NOT NULL DO UPDATE
        SET opted_in = true,
            import_id = EXCLUDED.import_id,
            consent_source = COALESCE(public.newsletter_subscriptions.consent_source, EXCLUDED.consent_source),
            consent_recorded_at = COALESCE(public.newsletter_subscriptions.consent_recorded_at, EXCLUDED.consent_recorded_at),
            first_name = COALESCE(EXCLUDED.first_name, public.newsletter_subscriptions.first_name),
            last_name = COALESCE(EXCLUDED.last_name, public.newsletter_subscriptions.last_name),
            updated_at = now()
        WHERE public.newsletter_subscriptions.opted_out_at IS NULL
          AND public.newsletter_subscriptions.opted_in = false
      RETURNING (xmax = 0) AS is_insert
    )
    SELECT count(*) FILTER (WHERE is_insert),
           count(*) FILTER (WHERE NOT is_insert)
      INTO v_inserted, v_reactivated FROM up;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    WITH up AS (
      INSERT INTO public.newsletter_subscriptions
        (organizer_user_id, email, opted_in, source, import_id, consent_source, consent_recorded_at,
         first_name, last_name)
      SELECT p_organizer_user_id, i.addr, true, 'import', v_import_id, p_consent_source, now(),
             i.fname, i.lname
        FROM _in i
       WHERE i.valid AND NOT public.is_email_suppressed(i.addr)
      ON CONFLICT (lower(email), organizer_user_id) WHERE organizer_user_id IS NOT NULL DO UPDATE
        SET opted_in = true,
            import_id = EXCLUDED.import_id,
            consent_source = COALESCE(public.newsletter_subscriptions.consent_source, EXCLUDED.consent_source),
            consent_recorded_at = COALESCE(public.newsletter_subscriptions.consent_recorded_at, EXCLUDED.consent_recorded_at),
            first_name = COALESCE(EXCLUDED.first_name, public.newsletter_subscriptions.first_name),
            last_name = COALESCE(EXCLUDED.last_name, public.newsletter_subscriptions.last_name),
            updated_at = now()
        WHERE public.newsletter_subscriptions.opted_out_at IS NULL
          AND public.newsletter_subscriptions.opted_in = false
      RETURNING (xmax = 0) AS is_insert
    )
    SELECT count(*) FILTER (WHERE is_insert),
           count(*) FILTER (WHERE NOT is_insert)
      INTO v_inserted, v_reactivated FROM up;
  ELSE
    -- Portée plateforme. Arbitre = l'index PARTIEL uniq_newsletter_subs_email_platform.
    WITH up AS (
      INSERT INTO public.newsletter_subscriptions
        (venue_id, organizer_user_id, email, opted_in, source, import_id, consent_source,
         consent_recorded_at, first_name, last_name)
      SELECT NULL, NULL, i.addr, true, 'platform:import', v_import_id, p_consent_source, now(),
             i.fname, i.lname
        FROM _in i
       WHERE i.valid AND NOT public.is_email_suppressed(i.addr)
      ON CONFLICT (lower(email)) WHERE venue_id IS NULL AND organizer_user_id IS NULL DO UPDATE
        SET opted_in = true,
            import_id = EXCLUDED.import_id,
            consent_source = COALESCE(public.newsletter_subscriptions.consent_source, EXCLUDED.consent_source),
            consent_recorded_at = COALESCE(public.newsletter_subscriptions.consent_recorded_at, EXCLUDED.consent_recorded_at),
            first_name = COALESCE(EXCLUDED.first_name, public.newsletter_subscriptions.first_name),
            last_name = COALESCE(EXCLUDED.last_name, public.newsletter_subscriptions.last_name),
            updated_at = now()
        WHERE public.newsletter_subscriptions.opted_out_at IS NULL
          AND public.newsletter_subscriptions.opted_in = false
      RETURNING (xmax = 0) AS is_insert
    )
    SELECT count(*) FILTER (WHERE is_insert),
           count(*) FILTER (WHERE NOT is_insert)
      INTO v_inserted, v_reactivated FROM up;
  END IF;

  -- Ce que le DO UPDATE n'a pas touché : déjà abonné actif, ou désabonné
  -- explicite qu'on respecte. On les compte pour le rapport d'import.
  v_optout := GREATEST(0, (v_valid - v_suppressed) - (v_inserted + v_reactivated));

  UPDATE public.email_list_imports
     SET submitted_count = submitted_count + v_submitted,
         inserted_count = inserted_count + v_inserted,
         reactivated_count = reactivated_count + v_reactivated,
         duplicate_count = duplicate_count + v_dupes,
         invalid_count = invalid_count + v_invalid,
         suppressed_count = suppressed_count + v_suppressed,
         unchanged_count = unchanged_count + v_optout
   WHERE id = v_import_id;

  DROP TABLE IF EXISTS _in;

  RETURN jsonb_build_object(
    'import_id', v_import_id,
    'submitted', v_submitted,
    'valid', v_valid,
    'invalid', v_invalid,
    'duplicates', v_dupes,
    'suppressed', v_suppressed,
    'inserted', v_inserted,
    'reactivated', v_reactivated,
    'unchanged', v_optout
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_contact_list(p_rows jsonb, p_consent_source text, p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid, p_filename text DEFAULT NULL::text, p_consent_details text DEFAULT NULL::text, p_collected_since date DEFAULT NULL::date, p_list_import_id uuid DEFAULT NULL::uuid, p_list_name text DEFAULT NULL::text, p_default_country text DEFAULT NULL::text, p_channels jsonb DEFAULT '{"sms": true, "email": true}'::jsonb, p_detected jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_list public.contact_list_imports%ROWTYPE;
  v_submitted integer := 0;
  v_rows integer := 0;
  v_emails integer := 0;
  v_phones integer := 0;
  v_both integer := 0;
  v_invalid integer := 0;
  v_email_res jsonb := NULL;
  v_sms_res jsonb := NULL;
  v_email_payload jsonb;
  v_sms_payload jsonb;
  v_want_email boolean := COALESCE((p_channels->>'email')::boolean, true);
  v_want_sms boolean := COALESCE((p_channels->>'sms')::boolean, true);
BEGIN
  IF p_venue_id IS NOT NULL AND p_organizer_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'import_contact_list: une seule portée à la fois';
  END IF;
  -- Même autorisation que l'import email (le plus strict des deux) : les deux
  -- RPC appelées en dessous doivent passer.
  IF p_venue_id IS NOT NULL THEN
    IF NOT (public.is_venue_owner(v_uid, p_venue_id) OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSIF p_organizer_user_id IS NOT NULL THEN
    IF NOT (p_organizer_user_id = v_uid OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  ELSE
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'Import indisponible en session support';
  END IF;
  IF p_consent_source IS NULL OR p_consent_source NOT IN
     ('in_person','website_form','ticketing','social','other_tool','other') THEN
    RAISE EXCEPTION 'Origine du consentement requise';
  END IF;

  SELECT count(*) INTO v_submitted FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb));
  IF v_submitted > 2000 THEN
    RAISE EXCEPTION 'Maximum 2000 contacts par appel (reçu %)', v_submitted;
  END IF;

  -- 1. La liste (créée au 1er lot, réutilisée ensuite).
  IF p_list_import_id IS NULL THEN
    INSERT INTO public.contact_list_imports
      (venue_id, organizer_user_id, list_name, filename, consent_source, consent_details,
       collected_since, default_country, detected_columns, channels, attested_by)
    VALUES (p_venue_id, p_organizer_user_id,
            NULLIF(left(btrim(COALESCE(p_list_name, '')), 60), ''),
            p_filename, p_consent_source, p_consent_details, p_collected_since,
            p_default_country, COALESCE(p_detected, '{}'::jsonb),
            jsonb_build_object('email', v_want_email, 'sms', v_want_sms), v_uid)
    RETURNING * INTO v_list;
  ELSE
    SELECT * INTO v_list FROM public.contact_list_imports
     WHERE id = p_list_import_id
       AND public.marketing_scope_match(venue_id, organizer_user_id, p_venue_id, p_organizer_user_id);
    IF NOT FOUND THEN RAISE EXCEPTION 'Import inconnu'; END IF;
    v_want_email := COALESCE((v_list.channels->>'email')::boolean, v_want_email);
    v_want_sms := COALESCE((v_list.channels->>'sms')::boolean, v_want_sms);
  END IF;

  -- 2. Typage défensif de chaque ligne.
  CREATE TEMP TABLE _ucl ON COMMIT DROP AS
  WITH raw AS (
    SELECT x, row_number() OVER () AS ord FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) x
  ), typed AS (
    SELECT ord,
      CASE WHEN lower(btrim(COALESCE(x->>'email',''))) ~ '^[^@\s;,]+@[^@\s;,.]+(\.[^@\s;,.]+)+$'
           THEN lower(btrim(x->>'email')) END AS email,
      CASE WHEN public.normalize_phone_e164(x->>'phone') ~ '^\+[1-9][0-9]{6,14}$'
           THEN public.normalize_phone_e164(x->>'phone') END AS phone,
      NULLIF(left(btrim(COALESCE(x->>'first_name','')), 80), '') AS first_name,
      NULLIF(left(btrim(COALESCE(x->>'last_name','')), 80), '') AS last_name,
      CASE WHEN upper(btrim(COALESCE(x->>'country_code',''))) ~ '^[A-Z]{2}$' THEN upper(btrim(x->>'country_code')) END AS country_code,
      NULLIF(left(btrim(COALESCE(x->>'country','')), 80), '') AS country,
      NULLIF(left(btrim(COALESCE(x->>'region','')), 80), '') AS region,
      NULLIF(left(btrim(COALESCE(x->>'city','')), 80), '') AS city,
      NULLIF(left(btrim(COALESCE(x->>'postal_code','')), 20), '') AS postal_code,
      NULLIF(left(btrim(COALESCE(x->>'zone','')), 80), '') AS zone,
      CASE WHEN COALESCE(x->>'age','') ~ '^[0-9]{1,3}$' AND (x->>'age')::int BETWEEN 12 AND 110 THEN (x->>'age')::int END AS age,
      CASE WHEN x->>'gender' IN ('female','male','other') THEN x->>'gender' END AS gender,
      CASE WHEN x->>'newsletter_opt_in' IN ('true','false') THEN (x->>'newsletter_opt_in')::boolean END AS newsletter_opt_in,
      CASE WHEN COALESCE(x->>'added_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (x->>'added_at')::timestamptz END AS added_at,
      CASE WHEN COALESCE(x->>'last_purchase_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (x->>'last_purchase_at')::timestamptz END AS last_purchase_at,
      CASE WHEN COALESCE(x->>'total_spent','') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN GREATEST(0, (x->>'total_spent')::numeric) END AS total_spent,
      CASE WHEN COALESCE(x->>'event_count','') ~ '^[0-9]{1,6}$' THEN (x->>'event_count')::int END AS event_count,
      CASE WHEN jsonb_typeof(x->'extra') = 'object' THEN x->'extra' END AS extra
    FROM raw
  )
  SELECT DISTINCT ON (COALESCE(email, phone)) *
    FROM typed
   WHERE email IS NOT NULL OR phone IS NOT NULL
   ORDER BY COALESCE(email, phone),
            ((phone IS NOT NULL)::int + (total_spent IS NOT NULL)::int + (event_count IS NOT NULL)::int
             + (last_purchase_at IS NOT NULL)::int + (zone IS NOT NULL)::int + (city IS NOT NULL)::int) DESC,
            ord;

  SELECT count(*), count(*) FILTER (WHERE email IS NOT NULL), count(*) FILTER (WHERE phone IS NOT NULL),
         count(*) FILTER (WHERE email IS NOT NULL AND phone IS NOT NULL)
    INTO v_rows, v_emails, v_phones, v_both FROM _ucl;
  v_invalid := v_submitted - v_rows;

  -- 3. Les lignes typées (idempotent sur une même liste).
  INSERT INTO public.imported_contacts
    (list_import_id, venue_id, organizer_user_id, email, phone_e164, first_name, last_name,
     country_code, country, region, city, postal_code, zone, age, gender, newsletter_opt_in,
     added_at, last_purchase_at, total_spent, event_count, extra)
  SELECT v_list.id, p_venue_id, p_organizer_user_id, u.email, u.phone, u.first_name, u.last_name,
         u.country_code, u.country, u.region, u.city, u.postal_code, u.zone, u.age, u.gender,
         u.newsletter_opt_in, u.added_at, u.last_purchase_at, u.total_spent, u.event_count, u.extra
    FROM _ucl u
  ON CONFLICT (list_import_id, COALESCE(email,''), COALESCE(phone_e164,'')) DO UPDATE
    SET first_name = COALESCE(EXCLUDED.first_name, public.imported_contacts.first_name),
        last_name = COALESCE(EXCLUDED.last_name, public.imported_contacts.last_name),
        country_code = COALESCE(EXCLUDED.country_code, public.imported_contacts.country_code),
        country = COALESCE(EXCLUDED.country, public.imported_contacts.country),
        region = COALESCE(EXCLUDED.region, public.imported_contacts.region),
        city = COALESCE(EXCLUDED.city, public.imported_contacts.city),
        postal_code = COALESCE(EXCLUDED.postal_code, public.imported_contacts.postal_code),
        zone = COALESCE(EXCLUDED.zone, public.imported_contacts.zone),
        age = COALESCE(EXCLUDED.age, public.imported_contacts.age),
        gender = COALESCE(EXCLUDED.gender, public.imported_contacts.gender),
        newsletter_opt_in = COALESCE(EXCLUDED.newsletter_opt_in, public.imported_contacts.newsletter_opt_in),
        added_at = COALESCE(EXCLUDED.added_at, public.imported_contacts.added_at),
        last_purchase_at = COALESCE(EXCLUDED.last_purchase_at, public.imported_contacts.last_purchase_at),
        total_spent = COALESCE(EXCLUDED.total_spent, public.imported_contacts.total_spent),
        event_count = COALESCE(EXCLUDED.event_count, public.imported_contacts.event_count),
        extra = COALESCE(EXCLUDED.extra, public.imported_contacts.extra);

  -- 4. Canal email → la RPC existante (attestation, désabonnés, suppression).
  IF v_want_email AND v_emails > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('email', u.email, 'first_name', u.first_name, 'last_name', u.last_name))
      INTO v_email_payload FROM _ucl u WHERE u.email IS NOT NULL;
    v_email_res := public.import_email_contacts(
      v_email_payload, p_consent_source, p_venue_id, p_organizer_user_id, p_filename,
      p_consent_details, p_collected_since, v_list.email_import_id, p_list_name);
    IF v_list.email_import_id IS NULL THEN
      v_list.email_import_id := (v_email_res->>'import_id')::uuid;
      UPDATE public.contact_list_imports SET email_import_id = v_list.email_import_id WHERE id = v_list.id;
    END IF;
  END IF;

  -- 5. Canal SMS → la RPC existante (liste repoussoir STOP, jamais réabonné).
  IF v_want_sms AND v_phones > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('phone', u.phone, 'first_name', u.first_name, 'last_name', u.last_name))
      INTO v_sms_payload FROM _ucl u WHERE u.phone IS NOT NULL;
    v_sms_res := public.import_sms_contacts(
      v_sms_payload, p_consent_source, p_venue_id, p_organizer_user_id, p_filename,
      p_consent_details, p_collected_since, v_list.sms_import_id, p_list_name, p_default_country);
    IF v_list.sms_import_id IS NULL THEN
      v_list.sms_import_id := (v_sms_res->>'import_id')::uuid;
      UPDATE public.contact_list_imports SET sms_import_id = v_list.sms_import_id WHERE id = v_list.id;
    END IF;
    -- Le contact SMS connaît son email : c'est ce qui relie les deux canaux.
    UPDATE public.venue_sms_contacts vc
       SET email = u.email
      FROM _ucl u
     WHERE vc.import_id = v_list.sms_import_id
       AND vc.phone_e164 = u.phone
       AND u.email IS NOT NULL
       AND vc.email IS NULL;
  END IF;

  -- Effectifs RECOMPTÉS depuis les lignes stockées : un ré-import idempotent
  -- de la même liste ne gonfle jamais les compteurs.
  UPDATE public.contact_list_imports li
     SET row_count = s.n, email_count = s.e, phone_count = s.p, both_count = s.b
    FROM (SELECT count(*) AS n,
                 count(*) FILTER (WHERE email IS NOT NULL) AS e,
                 count(*) FILTER (WHERE phone_e164 IS NOT NULL) AS p,
                 count(*) FILTER (WHERE email IS NOT NULL AND phone_e164 IS NOT NULL) AS b
            FROM public.imported_contacts WHERE list_import_id = v_list.id) s
   WHERE li.id = v_list.id;

  DROP TABLE IF EXISTS _ucl;

  RETURN jsonb_build_object(
    'list_import_id', v_list.id,
    'email_import_id', v_list.email_import_id,
    'sms_import_id', v_list.sms_import_id,
    'submitted', v_submitted,
    'rows', v_rows,
    'emails', v_emails,
    'phones', v_phones,
    'both', v_both,
    'invalid', v_invalid,
    'email', v_email_res,
    'sms', v_sms_res
  );
END;
$function$;

-- ── La synchro des sources internes vers le registre ───────────────────────
-- Sources reconnues :
--   'clients'  — comptes sans rôle pro (les gens qui sortent)
--   'pros'     — comptes portant un rôle pro (club, orga, promoteur, agence,
--                affilié, DJ, manager)
--   'waitlist' — `launch_waitlist` (inscription volontaire = consentement)
--   'leads'    — `links_pro_leads` (formulaire pro de /links)
-- Chaque source pose `source = 'platform:<clé>'`, ce qui devient le ciblage
-- côté campagne. Une personne déjà présente n'est jamais retaguée : la
-- première origine est la pièce du dossier de consentement.
CREATE OR REPLACE FUNCTION public.sync_platform_marketing_contacts(
  p_sources text[] DEFAULT ARRAY['clients','pros','waitlist','leads']
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_src text[] := COALESCE(p_sources, ARRAY[]::text[]);
  v_email_new integer := 0;
  v_sms_new integer := 0;
  v_n integer;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RAISE EXCEPTION 'Synchronisation indisponible en session support';
  END IF;

  -- Le vivier : une ligne par personne, avec son origine et son canal.
  CREATE TEMP TABLE _pmc ON COMMIT DROP AS
  WITH pro_users AS (
    SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
     WHERE ur.role IN ('owner','organizer','promoter','agency','affiliate','dj','manager')
  ), accounts AS (
    SELECT lower(btrim(p.email)) AS email,
           public.normalize_phone_e164(p.phone) AS phone,
           p.first_name, p.last_name,
           COALESCE(p.preferred_language, 'fr') AS lang,
           COALESCE(p.phone_sms_opt_in, false) AS sms_ok,
           CASE WHEN pu.user_id IS NOT NULL THEN 'pros' ELSE 'clients' END AS src,
           p.id AS user_id
      FROM public.profiles p
      JOIN auth.users au ON au.id = p.id AND au.deleted_at IS NULL
      LEFT JOIN pro_users pu ON pu.user_id = p.id
     WHERE p.email IS NOT NULL AND btrim(p.email) <> ''
       AND COALESCE(p.is_suspended, false) = false
  ), waitlist AS (
    SELECT lower(btrim(w.email)) AS email,
           public.normalize_phone_e164(w.phone) AS phone,
           w.first_name, w.last_name,
           COALESCE(w.lang, 'fr') AS lang,
           true AS sms_ok, 'waitlist' AS src, NULL::uuid AS user_id
      FROM public.launch_waitlist w
     WHERE w.email IS NOT NULL AND btrim(w.email) <> ''
  ), leads AS (
    SELECT lower(btrim(l.email)) AS email,
           public.normalize_phone_e164(l.phone) AS phone,
           NULLIF(split_part(btrim(COALESCE(l.name,'')), ' ', 1), '') AS first_name,
           NULLIF(btrim(regexp_replace(COALESCE(l.name,''), '^\S+\s*', '')), '') AS last_name,
           COALESCE(l.lang, 'fr') AS lang,
           true AS sms_ok, 'leads' AS src, NULL::uuid AS user_id
      FROM public.links_pro_leads l
     WHERE l.email IS NOT NULL AND btrim(l.email) <> ''
  ), unioned AS (
    SELECT * FROM accounts  WHERE 'clients'  = ANY(v_src) AND src = 'clients'
    UNION ALL
    SELECT * FROM accounts  WHERE 'pros'     = ANY(v_src) AND src = 'pros'
    UNION ALL
    SELECT * FROM waitlist  WHERE 'waitlist' = ANY(v_src)
    UNION ALL
    SELECT * FROM leads     WHERE 'leads'    = ANY(v_src)
  )
  SELECT DISTINCT ON (u.email) u.*
    FROM unioned u
   WHERE u.email ~ '^[^@\s;,]+@[^@\s;,.]+(\.[^@\s;,.]+)+$'
     AND NOT public.is_demo_email(u.email)
   ORDER BY u.email,
            -- Un pro prime sur un client, un compte prime sur un lead : c'est
            -- l'origine la plus engageante qui étiquette la personne.
            CASE u.src WHEN 'pros' THEN 0 WHEN 'clients' THEN 1
                       WHEN 'leads' THEN 2 ELSE 3 END;

  -- Email. Le DO UPDATE ne réveille jamais un désabonné explicite.
  WITH up AS (
    INSERT INTO public.newsletter_subscriptions
      (venue_id, organizer_user_id, user_id, email, opted_in, source,
       consent_source, consent_recorded_at, first_name, last_name)
    SELECT NULL, NULL, c.user_id, c.email, true, 'platform:' || c.src,
           CASE c.src WHEN 'waitlist' THEN 'website_form'
                      WHEN 'leads'    THEN 'website_form'
                      ELSE 'ticketing' END,
           now(), c.first_name, c.last_name
      FROM _pmc c
     WHERE NOT public.is_email_suppressed(c.email)
    ON CONFLICT (lower(email)) WHERE venue_id IS NULL AND organizer_user_id IS NULL DO UPDATE
      SET user_id    = COALESCE(public.newsletter_subscriptions.user_id, EXCLUDED.user_id),
          first_name = COALESCE(public.newsletter_subscriptions.first_name, EXCLUDED.first_name),
          last_name  = COALESCE(public.newsletter_subscriptions.last_name,  EXCLUDED.last_name),
          updated_at = now()
      WHERE public.newsletter_subscriptions.opted_out_at IS NULL
    RETURNING (xmax = 0) AS is_insert
  )
  SELECT count(*) FILTER (WHERE is_insert) INTO v_email_new FROM up;

  -- SMS. Un numéro qui a déjà répondu STOP quelque part n'est jamais réinscrit
  -- (le numéro d'envoi est partagé : un STOP vaut partout).
  WITH up AS (
    INSERT INTO public.venue_sms_contacts
      (venue_id, organizer_user_id, user_id, phone_e164, full_name, email,
       sms_consent_at, consent_source)
    SELECT NULL, NULL, c.user_id, c.phone,
           NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
           c.email, now(),
           CASE c.src WHEN 'clients' THEN 'checkout' WHEN 'pros' THEN 'checkout'
                      ELSE 'import' END
      FROM _pmc c
     WHERE c.sms_ok
       AND c.phone IS NOT NULL
       AND c.phone ~ '^\+[1-9][0-9]{6,14}$'
       AND NOT EXISTS (
         SELECT 1 FROM public.venue_sms_contacts b
          WHERE b.phone_e164 = c.phone AND b.unsubscribed)
    ON CONFLICT (phone_e164) WHERE venue_id IS NULL AND organizer_user_id IS NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_sms_new FROM up;

  SELECT count(*) INTO v_n FROM _pmc;
  DROP TABLE IF EXISTS _pmc;

  RETURN jsonb_build_object(
    'scanned', COALESCE(v_n, 0),
    'email_added', COALESCE(v_email_new, 0),
    'sms_added', COALESCE(v_sms_new, 0),
    'sources', to_jsonb(v_src)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_platform_marketing_contacts(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_platform_marketing_contacts(text[]) TO authenticated;

-- ── Le tableau de bord de la base plateforme ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_platform_marketing_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  WITH subs AS (
    SELECT ns.*
      FROM public.newsletter_subscriptions ns
     WHERE ns.venue_id IS NULL AND ns.organizer_user_id IS NULL
  ), sms AS (
    SELECT c.*
      FROM public.venue_sms_contacts c
     WHERE c.venue_id IS NULL AND c.organizer_user_id IS NULL
  )
  SELECT jsonb_build_object(
    'email', jsonb_build_object(
      'total',        (SELECT count(*) FROM subs),
      'opted_in',     (SELECT count(*) FROM subs WHERE opted_in),
      'opted_out',    (SELECT count(*) FROM subs WHERE NOT opted_in),
      'suppressed',   (SELECT count(*) FROM subs s WHERE public.is_email_suppressed(s.email)),
      'reachable',    (SELECT count(*) FROM subs s WHERE s.opted_in
                         AND NOT public.is_email_suppressed(s.email)),
      'by_source',    COALESCE((SELECT jsonb_object_agg(src, n) FROM (
                        SELECT COALESCE(source, 'inconnu') AS src, count(*) AS n
                          FROM subs WHERE opted_in GROUP BY 1) x), '{}'::jsonb)
    ),
    'sms', jsonb_build_object(
      'total',        (SELECT count(*) FROM sms),
      'reachable',    (SELECT count(*) FROM sms
                        WHERE NOT unsubscribed
                          AND sms_consent_at > now() - interval '36 months'
                          AND phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
      'unsubscribed', (SELECT count(*) FROM sms WHERE unsubscribed)
    ),
    'imports', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', li.id, 'list_name', li.list_name, 'filename', li.filename,
               'created_at', li.created_at,
               'contacts', (SELECT count(*) FROM subs s WHERE s.import_id = li.id))
             ORDER BY li.created_at DESC)
        FROM public.email_list_imports li
       WHERE li.venue_id IS NULL AND li.organizer_user_id IS NULL), '[]'::jsonb),
    'campaigns', jsonb_build_object(
      'email_drafts',  (SELECT count(*) FROM public.email_campaigns
                         WHERE venue_id IS NULL AND organizer_user_id IS NULL AND status = 'draft'),
      'email_sent',    (SELECT count(*) FROM public.email_campaigns
                         WHERE venue_id IS NULL AND organizer_user_id IS NULL AND status = 'sent'),
      'sms_drafts',    (SELECT count(*) FROM public.sms_campaigns
                         WHERE venue_id IS NULL AND organizer_id IS NULL AND status = 'draft'),
      'sms_sent',      (SELECT count(*) FROM public.sms_campaigns
                         WHERE venue_id IS NULL AND organizer_id IS NULL AND status = 'sent')
    ),
    'quota', public.get_email_quota_status(NULL, NULL)
  ) INTO v;

  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_platform_marketing_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_marketing_overview() TO authenticated;
