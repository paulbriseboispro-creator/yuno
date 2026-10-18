-- ============================================================================
-- Yuno CRM — « Chances de venir » : les lectures (2026-10-07).
-- Plan : docs/designs/CRM_PREDICTION_SCORE_PLAN.md.
--
-- • « Qui cibler » : acheteurs attendus par audience (somme des chances) et
--   l'audience « Les plus probables » (chances élevées) ; en-tête `score`.
--   Porte unique _crm_night_target_set + clé `ntgt` (audience `likely`).
-- • Fiche client (crm_client_analysis) : `chances` = les 3 prochaines soirées
--   sans place, une étiquette (élevées / moyennes / faibles) et ses raisons,
--   jamais un pourcentage ; `score_status`.
-- • Admin CRM (crm_admin_analysis) : santé du modèle et projection de
--   remplissage (connus attendus ± bande, nouveaux au rythme des 8 dernières
--   soirées), super admin seulement.
-- • MCP : `chances_to_come` dans l'analyse de get_customer_profile.
-- • Purge : la déconnexion et l'opposition effacent aussi les scores.
-- Corps repris des migrations 20261011110000, 20261010140000, 20261011100000
-- (identiques à la base liée).
-- ============================================================================

SET lock_timeout = '5s';

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
  DELETE FROM public.crm_person_night_score WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_score_night WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_score_model WHERE scope_key = p_scope_key;
  DELETE FROM public.crm_analysis_state WHERE scope_key = p_scope_key;  -- et crm_analysis_dirty (cascade)
END;
$$;
REVOKE ALL ON FUNCTION public._crm_analysis_purge_scope(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_analysis_purge_scope(text) TO service_role;

-- Opposition au profilage : ses scores partent avec son profil.
CREATE OR REPLACE FUNCTION public._crm_score_on_optout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.crm_person_night_score WHERE scope_key = NEW.scope_key AND email = NEW.email;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_score_on_optout() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_crm_score_on_optout ON public.crm_profile_optouts;
CREATE TRIGGER trg_crm_score_on_optout AFTER INSERT ON public.crm_profile_optouts
  FOR EACH ROW EXECUTE FUNCTION public._crm_score_on_optout();

CREATE OR REPLACE FUNCTION public._crm_night_target_set(p_scope text, p_event uuid, p_aud text)
 RETURNS TABLE(email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e        record;
  v_series text;
  v_arts   text[];
  v_genres text[];
  v_res    numeric := COALESCE((public.crm_analysis_config()->'rarity'->>'resident_share')::numeric, 0.2);
BEGIN
  IF p_scope IS NULL OR p_scope = '' OR p_event IS NULL THEN RETURN; END IF;
  SELECT ev.id, ev.title, ev.start_at, x.artists, x.genres INTO e
    FROM public.events ev
    LEFT JOIN public.external_events x ON x.event_id = ev.id
   WHERE ev.id = p_event AND ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
     AND COALESCE(ev.end_at, ev.start_at + interval '6 hours') > now()
     AND (p_scope = 'venue:' || ev.venue_id OR p_scope = 'org:' || ev.organizer_user_id::text)
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  v_series := public._crm_night_series(e.title);
  SELECT array_agg(DISTINCT 'a:' || k) INTO v_arts
    FROM (SELECT public._crm_artist_key(a) AS k FROM jsonb_array_elements(COALESCE(e.artists, '[]'::jsonb)) a) z
   WHERE z.k IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.crm_artist_stats s
                      WHERE s.scope_key = p_scope AND s.artist_key = z.k AND s.share > v_res);
  SELECT array_agg(DISTINCT lower(btrim(g))) INTO v_genres
    FROM unnest(COALESCE(e.genres, '{}'::text[])) g WHERE btrim(g) <> '';

  RETURN QUERY
  WITH has AS (
    SELECT DISTINCT lower(t.buyer_email) AS em
      FROM public.external_tickets t
     WHERE t.event_id = p_event AND t.status IN ('valid', 'transferred') AND t.buyer_email IS NOT NULL
  )
  SELECT p.email
    FROM public.crm_person_profile p
   WHERE p.scope_key = p_scope
     AND NOT EXISTS (SELECT 1 FROM has WHERE has.em = p.email)
     AND CASE p_aud
       WHEN 'concept' THEN v_series IS NOT NULL AND ('s:' || lower(v_series)) = ANY (p.tags)
       WHEN 'lineup' THEN v_arts IS NOT NULL AND p.tags && v_arts
       WHEN 'genre' THEN v_genres IS NOT NULL AND p.nights >= 2
                         AND COALESCE((p.agg->'genres'->0->>'n')::int, 0) >= 2
                         AND (p.agg->'genres'->0->>'v') = ANY (v_genres)
       WHEN 'early' THEN p.tags && ARRAY['b:early', 'b:launch']::text[]
       WHEN 'last_minute' THEN 'b:last_minute' = ANY (p.tags)
       WHEN 'once_local' THEN p.nights = 1 AND 'loc' = ANY (p.tags)
       -- « Les plus probables » : chances élevées (score de prédiction validé).
       WHEN 'likely' THEN EXISTS (SELECT 1 FROM public.crm_person_night_score s
                                   WHERE s.scope_key = p_scope AND s.event_id = p_event AND s.email = p.email AND s.label = 'high')
       ELSE false END;
END;
$function$;

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

  WITH counts AS (
    SELECT g.aud, count(*)::int AS n,
           count(*) FILTER (WHERE c.email_ok)::int AS email,
           count(*) FILTER (WHERE c.phone_ok)::int AS sms,
           sum(s.p) AS expected
      FROM _ntg g LEFT JOIN _cp c ON c.email = g.email
      LEFT JOIN public.crm_person_night_score s ON v_score AND s.scope_key = v_scope AND s.event_id = p_event_id AND s.email = g.email
     GROUP BY g.aud
  ), fam AS (
    SELECT a.aud, a.family, a.moment
      FROM (VALUES ('likely', NULL, 'now'), ('concept', 'series', 'now'), ('lineup', 'artist', 'now'), ('genre', 'genre', 'week'),
                   ('early', 'early', 'now'), ('last_minute', 'last_minute', 'eve'), ('once_local', NULL, 'week')) a(aud, family, moment)
  )
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'key', f.aud,
           'n', COALESCE(c.n, 0), 'email', COALESCE(c.email, 0), 'sms', COALESCE(c.sms, 0),
           -- Acheteurs attendus : somme des chances (score validé seulement).
           'expected', CASE WHEN v_score THEN round(COALESCE(c.expected, 0)) END,
           'family', f.family,
           'status', s.status, 'availability', s.availability, 'gain', s.gain,
           'moment', f.moment,
           'send_at', CASE f.moment WHEN 'eve' THEN v_eve WHEN 'week' THEN v_week ELSE now() END,
           'params', CASE f.aud
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
           END)) ORDER BY
             CASE WHEN v_score THEN -COALESCE(c.expected, 0) ELSE 0 END,
             CASE WHEN s.status = 'supported' AND s.availability IN ('ok', 'reduced') THEN 0 ELSE 1 END,
             COALESCE(c.n, 0) DESC), '[]'::jsonb)
    INTO v_auds
    FROM fam f
    LEFT JOIN counts c ON c.aud = f.aud
    LEFT JOIN LATERAL (
      SELECT fs.status, fs.availability, fs.gain FROM public.crm_family_status fs
       WHERE fs.scope_key = v_scope AND fs.family = f.family AND COALESCE(fs.variant, '') = '' LIMIT 1) s ON true;

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

CREATE OR REPLACE FUNCTION public.crm_client_analysis(p_venue_id text, p_organizer_user_id uuid, p_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_cfg jsonb := public.crm_analysis_config();
  v_em text := lower(btrim(COALESCE(p_email, '')));
  pp public.crm_person_profile%ROWTYPE;
  v_excluded boolean;
  v_hyps jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_excluded := EXISTS (SELECT 1 FROM public.crm_profile_optouts o WHERE o.scope_key = v_key AND o.email = v_em);
  SELECT * INTO pp FROM public.crm_person_profile WHERE scope_key = v_key AND email = v_em;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('excluded', v_excluded, 'profile', false,
      'computed_at', (SELECT computed_at FROM public.crm_analysis_state WHERE scope_key = v_key));
  END IF;

  SELECT COALESCE(jsonb_agg(h.h || jsonb_build_object(
           'status', fs.status, 'availability', fs.availability, 'kind', fs.kind,
           'gain', fs.gain, 'o', round(fs.o, 1), 'e', round(fs.e, 1), 'n', fs.n, 'direction', fs.direction,
           'detail', fs.detail, 'since', fs.status_since,
           'prior', CASE WHEN pr.family IS NOT NULL THEN jsonb_build_object('accounts', pr.accounts, 'gain', pr.gain, 'status', pr.status) END)
         ORDER BY h.ord), '[]'::jsonb)
    INTO v_hyps
    FROM jsonb_array_elements(pp.hyps) WITH ORDINALITY h(h, ord)
    LEFT JOIN public.crm_family_status fs
      ON fs.scope_key = v_key AND fs.family = h.h->>'f'
     AND fs.variant = CASE WHEN h.h->>'f' = 'channel' THEN COALESCE(h.h->'p'->>'src', '') ELSE '' END
    LEFT JOIN public.crm_learning_priors pr
      ON pr.rules_version = fs.rules_version AND pr.family = fs.family
     AND pr.variant = public._crm_an_cur_variant(fs.family, fs.variant, v_cfg);

  RETURN jsonb_build_object(
    'excluded', v_excluded, 'profile', true, 'computed_at', pp.computed_at,
    'nights', pp.nights, 'first', pp.first_facts, 'agg', pp.agg, 'hyps', v_hyps,
    'dist_km', pp.dist_km, 'passing', pp.passing,
    -- « Chances de venir » (20261012100000) : une étiquette et ses raisons,
    -- jamais un pourcentage ; seulement avec un modèle validé ; les 3
    -- prochaines soirées pour lesquelles il n'a pas encore de place.
    'score_status', COALESCE((SELECT m.status FROM public.crm_score_model m WHERE m.scope_key = v_key), 'none'),
    'chances', (SELECT COALESCE(jsonb_agg(jsonb_build_object('event_id', z.event_id, 'title', z.title, 'start_at', z.start_at,
                                  'label', z.label, 'reasons', z.reasons) ORDER BY z.start_at), '[]'::jsonb)
                  FROM (SELECT s.event_id, e.title, e.start_at, s.label, s.reasons
                          FROM public.crm_person_night_score s
                          JOIN public.events e ON e.id = s.event_id AND e.start_at > now() AND e.cancelled_at IS NULL
                         WHERE s.scope_key = v_key AND s.email = v_em
                           AND EXISTS (SELECT 1 FROM public.crm_score_model m WHERE m.scope_key = v_key AND m.status = 'ok')
                           AND NOT EXISTS (SELECT 1 FROM public.external_tickets t
                                            WHERE t.event_id = s.event_id AND lower(t.buyer_email) = v_em AND t.status IN ('valid', 'transferred'))
                         ORDER BY e.start_at LIMIT 3) z));
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_admin_analysis(p_scope_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
                         WHERE t.event_id = e.id AND public._crm_ticket_is_sale(t.status, t.raw)),
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
       ORDER BY e.start_at LIMIT 6) z));
END;
$$;

CREATE OR REPLACE FUNCTION public._mcp_tool(p_tool text, p_kind text, p_space_id text, p_product text, p_tz text, p_args jsonb, p_level text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue  text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org    uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_crm    boolean := p_product = 'crm';
  gate     record;
  w        record;
  v_event  uuid;
  v_ref    text;
  v_limit  integer;
  v_offset integer;
  v        jsonb;
  v2       jsonb;
  v3       jsonb;
  v_when   text;
  v_search text;
  v_topic  text;
  v_ids    uuid[];
  v_out    jsonb;
  r        record;
BEGIN
  SELECT * INTO gate FROM public.analytics_scope_gate(v_venue, v_org);
  IF NOT coalesce(gate.ok, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'reason', gate.reason);
  END IF;
  -- Compte Yuno CRM : ses soirées sont des soirées MIROIR, qu'analytics_scope_gate
  -- écarte depuis le 07/10 (la Billetterie ne doit pas les compter). Sans elles,
  -- l'IA d'un compte CRM voyait « 0 soirée » et ne trouvait aucun rapport.
  IF v_crm THEN
    gate.scope_ids := public._mcp_email_scope_events(v_venue, v_org);
  END IF;

  CASE p_tool

  -- ── Contexte ──────────────────────────────────────────────────────────────
  WHEN 'get_account_overview' THEN
    SELECT jsonb_build_object(
      'past_events', count(*) FILTER (WHERE coalesce(e.end_at, e.start_at + interval '8 hours') < now()),
      'upcoming_events', count(*) FILTER (WHERE coalesce(e.end_at, e.start_at + interval '8 hours') >= now()),
      'first_event_at', min(e.start_at), 'last_event_at', max(e.start_at) FILTER (WHERE e.start_at < now()))
      INTO v
      FROM public.events e
     WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
       AND (e.is_active OR e.external_source IS NOT NULL);
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
             'external', x.external_source IS NOT NULL) ORDER BY x.start_at), '[]'::jsonb)
      INTO v2
      FROM (SELECT e.* FROM public.events e
             WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
               AND (e.is_active OR e.external_source IS NOT NULL)
               AND coalesce(e.end_at, e.start_at + interval '8 hours') >= now()
             ORDER BY e.start_at LIMIT 5) x;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'start_at', x.start_at,
             'external', x.external_source IS NOT NULL) ORDER BY x.start_at DESC), '[]'::jsonb)
      INTO v3
      FROM (SELECT e.* FROM public.events e
             WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
               AND (e.is_active OR e.external_source IS NOT NULL)
               AND coalesce(e.end_at, e.start_at + interval '8 hours') < now()
             ORDER BY e.start_at DESC LIMIT 5) x;
    v_out := jsonb_build_object(
      'ok', true, 'now', now(), 'timezone', coalesce(gate.tz, p_tz),
      'today_local', to_char(now() AT TIME ZONE coalesce(gate.tz, p_tz), 'YYYY-MM-DD (Dy)'),
      'currency', 'EUR', 'product', p_product, 'can_see_money', gate.money,
      'access_level', p_level, 'events', v, 'next_events', v2, 'last_events', v3);
    IF v_crm THEN
      -- Statut de la billetterie connectée, lu ici (la RPC de la Console est
      -- réservée au fondateur et rend l'indice du jeton et l'erreur brute).
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'provider', tc.provider, 'account', tc.external_org_name, 'status', tc.status,
               'last_sync_ok_at', tc.last_ok_at, 'first_import_done', tc.initial_import_done_at IS NOT NULL,
               'has_sync_error', tc.last_error_at IS NOT NULL AND (tc.last_ok_at IS NULL OR tc.last_error_at > tc.last_ok_at)))
             ORDER BY tc.created_at), '[]'::jsonb)
        INTO v
        FROM public.ticketing_connections tc
       WHERE (v_venue IS NOT NULL AND tc.venue_id = v_venue) OR (v_org IS NOT NULL AND tc.organizer_user_id = v_org);
      v_out := v_out || jsonb_build_object('ticketing', v);
    END IF;
    RETURN v_out;

  -- ── Soirées ───────────────────────────────────────────────────────────────
  WHEN 'list_events' THEN
    v_when := coalesce(nullif(p_args->>'when', ''), 'all');
    v_search := nullif(btrim(coalesce(p_args->>'search', '')), '');
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 20), 60));
    IF v_crm THEN
      v := public.get_crm_nights(v_venue, v_org, 200, 0);
      SELECT coalesce(jsonb_agg(n ORDER BY CASE WHEN v_when = 'upcoming' THEN (n->>'start_at')::timestamptz END ASC,
                                           (n->>'start_at')::timestamptz DESC), '[]'::jsonb)
        INTO v2
        FROM (SELECT n FROM jsonb_array_elements(v->'nights') n
               WHERE (v_when = 'all' OR (v_when = 'upcoming') = coalesce((n->>'upcoming')::boolean, false))
                 AND (v_search IS NULL OR lower(n->>'title') LIKE '%' || lower(v_search) || '%')
               ORDER BY CASE WHEN v_when = 'upcoming' THEN (n->>'start_at')::timestamptz END ASC,
                        (n->>'start_at')::timestamptz DESC
               LIMIT v_limit) q;
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'total', v->'total', 'events', v2);
    END IF;
    v := public.get_analytics_event_rail(v_venue, v_org, 400);
    SELECT coalesce(jsonb_agg(q.e), '[]'::jsonb) INTO v2
      FROM (SELECT e FROM jsonb_array_elements(v->'events') e
             WHERE (v_when = 'all' OR (v_when = 'upcoming' AND e->>'phase' <> 'after')
                    OR (v_when = 'past' AND e->>'phase' = 'after'))
               AND (v_search IS NULL OR lower(e->>'title') LIKE '%' || lower(v_search) || '%')
               AND (nullif(p_args->>'from', '') IS NULL OR (e->>'startAt')::timestamptz >= (p_args->>'from')::date)
               AND (nullif(p_args->>'to', '') IS NULL OR (e->>'startAt')::timestamptz < (p_args->>'to')::date + 1)
             ORDER BY CASE WHEN v_when = 'upcoming' THEN (e->>'startAt')::timestamptz END ASC,
                      (e->>'startAt')::timestamptz DESC
             LIMIT v_limit) q;
    v_out := jsonb_build_object('ok', true, 'money', v->'money', 'events', v2);
    IF v_when IN ('upcoming', 'all') THEN
      -- Jauges et ventes du jour des prochaines soirées (même source que
      -- « Vos prochaines soirées » de l'accueil).
      v_out := v_out || jsonb_build_object('upcoming_pipeline', public.get_events_sales_summary(v_venue, v_org)->'events');
    END IF;
    RETURN v_out;

  WHEN 'get_event_report' THEN
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    IF v_crm OR EXISTS (SELECT 1 FROM public.events WHERE id = v_event AND external_source IS NOT NULL) THEN
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'event_id', v_event, 'report', public.get_crm_night_report(v_event));
    END IF;
    RETURN public.get_event_report(v_event);

  WHEN 'get_event_details' THEN
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    v_topic := coalesce(nullif(p_args->>'topic', ''), 'ticket_types');
    CASE v_topic
      WHEN 'ticket_types' THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'name', tr.name, 'price', tr.price, 'capacity', tr.max_tickets, 'sold', tr.tickets_sold,
                 'fill_pct', CASE WHEN coalesce(tr.max_tickets, 0) > 0 THEN round(100.0 * tr.tickets_sold / tr.max_tickets, 1) END,
                 'open', tr.is_active, 'sold_out_by_hand', tr.manually_sold_out, 'hidden', tr.hidden,
                 'type', tr.ticket_type, 'group_size', CASE WHEN tr.is_group THEN tr.group_size END,
                 'sale_starts_at', tr.sale_starts_at, 'sale_ends_at', tr.sale_ends_at,
                 'entry_deadline', tr.entry_deadline, 'includes_free_drink', tr.includes_drink)
               ORDER BY tr.position, tr.price), '[]'::jsonb)
          INTO v
          FROM public.ticket_rounds tr WHERE tr.event_id = v_event;
        SELECT jsonb_build_object('title', e.title, 'start_at', e.start_at, 'selling_mode', e.ticket_selling_mode,
                 'ticketing_enabled', e.ticketing_enabled, 'tables_enabled', e.tables_enabled,
                 'guest_list_parts', (SELECT count(*) FROM public.guest_lists gl WHERE gl.event_id = e.id),
                 'tickets_sold_out', e.tickets_sold_out,
                 'tables_sold_out', e.tables_sold_out, 'guest_list_sold_out', e.guest_list_sold_out,
                 'entry_target', e.entry_target)
          INTO v2 FROM public.events e WHERE e.id = v_event;
        RETURN jsonb_build_object('ok', true, 'event', v2, 'ticket_types', v);
      WHEN 'tables' THEN
        RETURN public.get_vip_table_analytics(v_venue, v_event, NULL, NULL, coalesce(gate.tz, p_tz), v_org);
      WHEN 'guest_list' THEN
        RETURN public.get_guest_list_analytics(v_venue, v_event, NULL, NULL, coalesce(gate.tz, p_tz), v_org);
      WHEN 'traffic' THEN
        RETURN public.get_event_traffic(v_event);
      WHEN 'pacing' THEN
        RETURN public.get_analytics_pacing(v_event, 'previous', greatest(7, least(coalesce(nullif(p_args->>'days', '')::integer, 30), 90)));
      WHEN 'door' THEN
        RETURN public.get_analytics_door(v_venue, v_org, v_event, NULL, NULL);
      WHEN 'partners' THEN
        RETURN public.get_collab_party_breakdown(v_event);
      WHEN 'promoters' THEN
        RETURN public.get_analytics_promoters(v_venue, v_org, v_event, NULL, NULL);
      ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'unknown topic');
    END CASE;

  WHEN 'compare_events' THEN
    v_ids := '{}';
    IF jsonb_typeof(p_args->'events') = 'array' THEN
      FOR v_ref IN SELECT x FROM jsonb_array_elements_text(p_args->'events') x LIMIT 6 LOOP
        v_event := public._mcp_resolve_event(v_ref, gate.scope_ids);
        IF v_event IS NOT NULL AND NOT v_event = ANY (v_ids) THEN v_ids := v_ids || v_event; END IF;
      END LOOP;
    END IF;
    IF cardinality(v_ids) = 0 THEN
      SELECT coalesce(array_agg(x.id ORDER BY x.start_at DESC), '{}') INTO v_ids
        FROM (SELECT e.id, e.start_at FROM public.events e
               WHERE e.id = ANY (gate.scope_ids) AND e.cancelled_at IS NULL
                 AND (e.is_active OR e.external_source IS NOT NULL)
                 AND coalesce(e.end_at, e.start_at + interval '8 hours') < now()
               ORDER BY e.start_at DESC
               LIMIT greatest(2, least(coalesce(nullif(p_args->>'last', '')::integer, 4), 6))) x;
    END IF;
    v := '[]'::jsonb;
    FOREACH v_event IN ARRAY v_ids LOOP
      IF v_crm OR EXISTS (SELECT 1 FROM public.events WHERE id = v_event AND external_source IS NOT NULL) THEN
        v2 := public.get_crm_night_report(v_event);
        v := v || jsonb_build_array(jsonb_build_object('event_id', v_event, 'source', 'ticketing',
                 'report', v2 - 'curve' - 'buyers_list'));
      ELSE
        v2 := public.get_event_report(v_event);
        v := v || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                 'event', v2->'event', 'totals', v2->'totals', 'audience', v2->'audience',
                 'channels', v2->'channels', 'visit_sources', v2->'visitSources',
                 'takeaways', v2->'takeaways', 'money', v2->'money')));
      END IF;
    END LOOP;
    RETURN jsonb_build_object('ok', true, 'events', v);

  -- ── Ventes ────────────────────────────────────────────────────────────────
  WHEN 'get_sales_overview' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 90);
      v := public.crm_ana_sales(v_venue, v_org, v_when, NULL, 'all');
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when, 'window', v->'meta',
        'totals', v->'totals', 'fill', v->'fill', 'tariffs', v->'tariffs', 'from_yuno_messages', v->'msg',
        'events', v->'events', 'events_other', v->'events_other',
        'account', public.get_crm_overview(v_venue, v_org),
        'note', 'Yuno CRM account: sales reported by the connected ticketing over the period (24h, 48h, 7d, 30d, 90d or 12m ending today), compared with the period just before.');
    END IF;
    RETURN public.get_sales_takeaways(v_venue, v_org,
      CASE WHEN p_args->>'period' IN ('last', 'last4', 'month', 'year', 'all') THEN p_args->>'period' ELSE 'last4' END);

  WHEN 'get_sales_trends' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 90);
      v := public.crm_ana_sales(v_venue, v_org, v_when, NULL, 'all');
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when, 'window', v->'meta',
        'series', v->'series', 'yuno_sends_on_the_series', v->'sends', 'pace_vs_reference_nights', v->'goal',
        'note', 'series[i] = tickets and revenue of slot i of the window (window.mode: hour, day or month from window.start), prev_* = same slot of the previous period.');
      BEGIN v_out := v_out || jsonb_build_object('traffic', public.crm_ana_traffic(v_venue, v_org, v_when, NULL));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('traffic', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    v_out := jsonb_build_object('ok', true, 'from', w.w_from, 'to', w.w_to);
    BEGIN v_out := v_out || jsonb_build_object('curve', public.get_sales_period_curve(v_venue, v_org, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('curve', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('drivers', public.get_sales_period_drivers(v_venue, v_org, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('drivers', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('audience', public.get_sales_period_audience(v_venue, v_org, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('audience', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  WHEN 'get_purchase_behavior' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 90);
      v := public.crm_ana_sales(v_venue, v_org, v_when, NULL, 'all');
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when,
        'purchases_by_weekday_and_hour', v->'heat', 'ticket_tiers', v->'tariffs', 'totals', v->'totals',
        'note', 'purchases_by_weekday_and_hour: cells[weekday][slot], weekday 0 = Monday, 8 two-hour slots starting at 10:00, 12:00, 14:00, 16:00, 18:00, 20:00, 22:00, 00:00 (local time), outside = purchases outside these slots; n = tickets, amount = revenue. '
             || 'buying_habits: tested hypotheses on how customers buy (see get_customer_analysis), never a certainty.');
      BEGIN
        v2 := public.crm_analysis_overview(v_venue, v_org);
        v_out := v_out || jsonb_build_object('buying_habits', (
          SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('family', f->>'family', 'status', f->>'status',
                   'availability', f->>'availability', 'matched', f->'o', 'expected_by_chance', f->'e', 'tested', f->'n', 'gain', f->'gain'))), '[]'::jsonb)
            FROM jsonb_array_elements(coalesce(v2->'families', '[]'::jsonb)) f
           WHERE f->>'family' IN ('launch', 'early', 'last_minute', 'door', 'group', 'table')));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('buying_habits', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 180);
    RETURN public.get_purchase_behavior(v_venue, v_org, w.w_from, w.w_to);

  WHEN 'get_promoters_performance' THEN
    IF v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_in_crm'); END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    RETURN public.get_analytics_promoters(v_venue, v_org, NULL, w.w_from, w.w_to);

  WHEN 'get_live_now' THEN
    IF v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_in_crm'); END IF;
    RETURN public.get_live_view(v_venue, v_org);

  -- ── Public et trafic ──────────────────────────────────────────────────────
  WHEN 'get_audience_overview' THEN
    IF v_crm THEN
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing');
      BEGIN v_out := v_out || jsonb_build_object('clients', public.crm_clients_overview(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('clients', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v := public.crm_ana_community(v_venue, v_org, public._mcp_crm_period(p_args, 365), NULL, 'all');
        v_out := v_out || jsonb_build_object('community', v - 'top' - 'spark' - 'series',
          'note', 'community: lifecycle (hab = regulars, occ = occasional, nou = new, end = lapsed, none = known contact without a night), '
               || 'hist = people by number of nights, reach = reachable by email / SMS, wake = people to bring back, cohort = return of each recent night''s buyers.');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('community', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v2 := public.crm_artists_analysis(v_venue, v_org, 10);
        v_out := v_out || jsonb_build_object('artists', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'name', x->>'name', 'nights', x->'nights', 'entries', x->'entries', 'newcomers', x->'new_brought',
                   'return_rate', x->'return_rate', 'resident', x->'resident'))), '[]'::jsonb)
                   FROM jsonb_array_elements(coalesce(v2->'artists', '[]'::jsonb)) x));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('artists', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
    v_out := jsonb_build_object('ok', true);
    BEGIN v_out := v_out || jsonb_build_object('community', public.get_community_overview(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('community', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('tastes', public.get_community_tastes(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('tastes', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('cohorts', public.get_analytics_cohorts(v_venue, v_org, 6));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('cohorts', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  WHEN 'get_web_traffic' THEN
    IF v_crm THEN
      v_when := public._mcp_crm_period(p_args, 30);
      RETURN jsonb_build_object('ok', true, 'source', 'ticketing', 'period', v_when,
        'traffic', public.crm_ana_traffic(v_venue, v_org, v_when, NULL),
        'note', 'Yuno CRM account: where ticket buyers came from (utm_source reported by the ticketing, Yuno links /go/, signup pages). Page visits on the ticketing site are not reported by Shotgun.');
    END IF;
    SELECT * INTO w FROM public._mcp_window(p_args, 30);
    v_out := jsonb_build_object('ok', true);
    BEGIN v_out := v_out || jsonb_build_object('page', public.get_page_traffic(v_venue, v_org, least(w.w_days, 365)));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('page', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('sources', public.get_analytics_sources(v_venue, v_org, NULL, w.w_from, w.w_to));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('sources', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  WHEN 'count_contacts' THEN
    IF jsonb_typeof(p_args->'conditions') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'conditions[] required');
    END IF;
    RETURN jsonb_build_object('ok', true, 'definition', jsonb_build_object('conditions', p_args->'conditions'),
      'result', public.count_contact_segment_def(v_venue, v_org, jsonb_build_object('conditions', p_args->'conditions')));

  WHEN 'get_customer_segments' THEN
    IF v_crm THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description,
               'template', s.template, 'definition', s.definition) ORDER BY s.updated_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.crm_segments cs
               WHERE (v_venue IS NOT NULL AND cs.venue_id = v_venue)
                  OR (v_org IS NOT NULL AND cs.organizer_user_id = v_org AND cs.venue_id IS NULL)
               ORDER BY cs.updated_at DESC LIMIT 40) s;
      v_out := jsonb_build_object('ok', true, 'source', 'ticketing', 'saved_segments', v);
      BEGIN
        v2 := public.crm_segments_overview(v_venue, v_org, public._mcp_crm_period(p_args, 90));
        v_out := v_out || jsonb_build_object('lifecycle_segments', v2->'segments', 'rules', v2->'rules', 'messages_totals', v2->'totals',
          'note', 'lifecycle keys: hab = regulars, occ = occasional, nou = new, end = lapsed, none = known contact without a night (rules: regulars = N nights over M months).');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('lifecycle_segments', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      RETURN v_out;
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'description', s.description,
             'definition', s.definition, 'origin', s.origin) ORDER BY s.updated_at DESC), '[]'::jsonb)
      INTO v
      FROM (SELECT * FROM public.contact_segments cs
             WHERE (v_venue IS NOT NULL AND cs.venue_id = v_venue)
                OR (v_org IS NOT NULL AND cs.organizer_user_id = v_org)
             ORDER BY cs.updated_at DESC LIMIT 30) s;
    v_out := jsonb_build_object('ok', true, 'saved_segments', v);
    BEGIN v_out := v_out || jsonb_build_object('rfm', public.get_analytics_rfm(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('rfm', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('imported_lists', public.get_email_lists_health(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('imported_lists', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN v_out := v_out || jsonb_build_object('basket_threshold', public.suggest_basket_threshold(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('basket_threshold', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  -- ── Marketing ─────────────────────────────────────────────────────────────
  WHEN 'get_marketing_performance' THEN
    SELECT * INTO w FROM public._mcp_window(p_args, 90);
    v_topic := coalesce(nullif(p_args->>'channel', ''), 'all');
    v_out := jsonb_build_object('ok', true, 'from', w.w_from, 'to', w.w_to);
    IF v_topic IN ('all', 'email') THEN
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', c.id, 'name', c.name, 'subject', c.subject, 'type', c.type, 'status', c.status,
               'sent_at', c.sent_at, 'event_id', c.event_id,
               'recipients', coalesce(c.total_recipients, c.recipients_count), 'delivered', c.delivered_count,
               'opens', c.opens_count, 'clicks', c.clicks_count, 'clickers', c.clickers_count,
               'unsubscribes', c.unsubscribes_count, 'bounced', c.bounced_count, 'complaints', c.complained_count,
               'protected_by_yuno_rules', c.policy_skipped_count, 'ab_test', c.ab_enabled, 'ab_winner', c.ab_winner,
               'open_rate_pct', CASE WHEN coalesce(c.delivered_count, 0) > 0 THEN round(100.0 * c.opens_count / c.delivered_count, 1) END,
               'click_rate_pct', CASE WHEN coalesce(c.delivered_count, 0) > 0 THEN round(100.0 * coalesce(c.clickers_count, c.clicks_count) / c.delivered_count, 1) END))
             ORDER BY c.sent_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.email_campaigns c
               WHERE ((v_venue IS NOT NULL AND c.venue_id = v_venue) OR (v_org IS NOT NULL AND c.organizer_user_id = v_org AND c.venue_id IS NULL))
                 AND c.automation_id IS NULL AND c.parent_campaign_id IS NULL
                 AND c.sent_at >= w.w_from AND c.sent_at < w.w_to
               ORDER BY c.sent_at DESC LIMIT 20) c;
      v_out := v_out || jsonb_build_object('email_campaigns', v);
      BEGIN
        v_out := v_out || jsonb_build_object('email_revenue_attribution', public.get_email_campaign_attribution(
            CASE WHEN v_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END, coalesce(v_venue, v_org::text)));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('email_revenue_attribution', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('best_send_time', public.get_email_send_time_insights(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('best_send_time', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF v_topic IN ('all', 'automations') THEN
      BEGIN v_out := v_out || jsonb_build_object('email_automations', public.get_email_automation_stats(v_venue, v_org, least(w.w_days, 365)));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('email_automations', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('automation_suggestions', public.get_email_automation_suggestions(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automation_suggestions', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF v_topic IN ('all', 'push') AND NOT v_crm THEN
      BEGIN v_out := v_out || jsonb_build_object('push_campaigns', public.get_push_campaigns(v_venue, v_org, 'all', NULL, 15, 0));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('push_campaigns', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('push_automatic', public.get_push_center(v_venue, v_org, least(w.w_days, 365)));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('push_automatic', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF v_topic IN ('all', 'sms') THEN
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', s.id, 'name', s.name, 'status', s.status, 'sent_at', s.sent_at, 'event_id', s.event_id,
               'recipients', s.total_recipients, 'sent', s.sent_count, 'delivered', s.delivered_count,
               'failed', s.failed_count, 'credits_used', s.credits_consumed)) ORDER BY s.sent_at DESC), '[]'::jsonb)
        INTO v
        FROM (SELECT * FROM public.sms_campaigns s
               WHERE ((v_venue IS NOT NULL AND s.venue_id = v_venue) OR (v_org IS NOT NULL AND s.organizer_id = v_org))
                 AND s.sent_at >= w.w_from AND s.sent_at < w.w_to
               ORDER BY s.sent_at DESC LIMIT 15) s;
      v_out := v_out || jsonb_build_object('sms_campaigns', v);
    END IF;
    RETURN v_out;

  WHEN 'get_campaign_report' THEN
    SELECT * INTO r FROM public.email_campaigns c
     WHERE c.id::text = coalesce(p_args->>'campaign_id', '')
       AND ((v_venue IS NOT NULL AND c.venue_id = v_venue) OR (v_org IS NOT NULL AND c.organizer_user_id = v_org AND c.venue_id IS NULL));
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'campaign_not_found'); END IF;
    BEGIN
      SELECT x INTO v FROM jsonb_array_elements(public.get_email_campaign_attribution(
          CASE WHEN v_venue IS NOT NULL THEN 'venue' ELSE 'organizer' END, coalesce(v_venue, v_org::text))->'campaigns') x
       WHERE x->>'campaign_id' = r.id::text OR x->>'id' = r.id::text LIMIT 1;
    EXCEPTION WHEN others THEN v := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    BEGIN v2 := CASE WHEN r.ab_enabled THEN public.get_campaign_ab_stats(r.id) END;
    EXCEPTION WHEN others THEN v2 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    BEGIN v3 := CASE WHEN r.resend_enabled THEN public.get_campaign_resend_stats(r.id) END;
    EXCEPTION WHEN others THEN v3 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    BEGIN v_out := CASE WHEN r.followup_enabled THEN public.get_campaign_followup_stats(r.id) END;
    EXCEPTION WHEN others THEN v_out := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    RETURN jsonb_build_object('ok', true,
      'campaign', jsonb_strip_nulls(jsonb_build_object(
        'id', r.id, 'name', r.name, 'subject', r.subject, 'subject_b', r.subject_b, 'preheader', r.preheader,
        'status', r.status, 'sent_at', r.sent_at, 'event_id', r.event_id,
        'recipients', coalesce(r.total_recipients, r.recipients_count), 'delivered', r.delivered_count,
        'opens', r.opens_count, 'clicks', r.clicks_count, 'clickers', r.clickers_count,
        'unsubscribes', r.unsubscribes_count, 'bounced', r.bounced_count, 'complaints', r.complained_count,
        'failed', r.failed_count, 'suppressed', r.suppressed_count,
        'protected_by_yuno_rules', r.policy_skipped_count, 'paused_reason', r.paused_reason,
        'audiences', r.audiences_json, 'exclusions', r.exclusions_json, 'resend_enabled', r.resend_enabled,
        'followup_enabled', r.followup_enabled)),
      'revenue_attribution', v,
      'ab_test', v2,
      'resend_to_non_openers', v3,
      'click_followup', v_out);

  -- ── Conseils ──────────────────────────────────────────────────────────────
  WHEN 'get_recommendations' THEN
    v_out := jsonb_build_object('ok', true, 'product', p_product);
    IF v_crm THEN
      BEGIN v_out := v_out || jsonb_build_object('overview', public.get_crm_overview(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('overview', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v := public.crm_ana_community(v_venue, v_org, '90d', NULL, 'all');
        v_out := v_out || jsonb_build_object('people_to_bring_back', v->'wake', 'reachable', v->'reach', 'lifecycle', v->'lifecycle');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('people_to_bring_back', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v := public.crm_analysis_overview(v_venue, v_org);
        v_out := v_out || jsonb_build_object('supported_hypotheses', (
          SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('family', f->>'family', 'variant', nullif(f->>'variant', ''),
                   'gain', f->'gain', 'direction', f->'direction'))), '[]'::jsonb)
            FROM jsonb_array_elements(coalesce(v->'families', '[]'::jsonb)) f
           WHERE f->>'status' = 'supported' AND f->>'availability' IN ('ok', 'reduced')),
          'return_delay_days', v->'state'->'stats'->'median_days');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('supported_hypotheses', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    ELSE
      BEGIN
        v := public.get_sales_takeaways(v_venue, v_org, 'last4');
        v_out := v_out || jsonb_build_object(
          'sales_takeaways', v->'takeaways',
          'sales_last4_vs_previous4', jsonb_build_object('current', v->'current', 'previous', v->'previous'));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('sales_takeaways', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN v_out := v_out || jsonb_build_object('upcoming_pipeline', public.get_events_sales_summary(v_venue, v_org)->'events');
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('upcoming_pipeline', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
      BEGIN
        v_out := v_out || jsonb_build_object('signals_30d',
          public.get_analytics_insights(v_venue, v_org, NULL, now() - interval '30 days', now(), 'previous'));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('signals_30d', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    IF NOT v_crm THEN
      BEGIN v_out := v_out || jsonb_build_object('rfm', public.get_analytics_rfm(v_venue, v_org));
      EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('rfm', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    END IF;
    BEGIN v_out := v_out || jsonb_build_object('automation_suggestions', public.get_email_automation_suggestions(v_venue, v_org));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automation_suggestions', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    BEGIN
      v_out := v_out || jsonb_build_object('automations',
        (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', a->>'kind', 'enabled', a->'enabled', 'sent', a->'sent')), '[]'::jsonb)
           FROM jsonb_array_elements(coalesce(public.get_email_automation_stats(v_venue, v_org, 30), '[]'::jsonb)) a));
    EXCEPTION WHEN others THEN v_out := v_out || jsonb_build_object('automations', public._mcp_unavailable(SQLSTATE, SQLERRM)); END;
    RETURN v_out;

  -- ── Analyse client (« ce qui fait venir », 20261010150000) ────────────────
  -- Agrégats seulement (niveau analytics) : statut de chaque famille
  -- d'hypothèses testée sur le compte, hypothèses des nouveaux venus, venus
  -- une fois, délai de retour, couverture, artistes. Aucune identité.
  -- « Qui cibler » (20261011110000) : audiences sans place d'une soirée à venir.
  WHEN 'get_event_targets' THEN
    IF NOT v_crm THEN RETURN jsonb_build_object('ok', false, 'error', 'not_available_outside_crm'); END IF;
    v_event := public._mcp_resolve_event(coalesce(p_args->>'event_id', p_args->>'event'), gate.scope_ids);
    IF v_event IS NULL AND nullif(coalesce(p_args->>'event_id', p_args->>'event'), '') IS NULL THEN
      SELECT e.id INTO v_event FROM public.events e
       WHERE e.id = ANY (gate.scope_ids) AND e.external_source IS NOT NULL AND e.cancelled_at IS NULL
         AND coalesce(e.end_at, e.start_at + interval '6 hours') > now()
       ORDER BY e.start_at LIMIT 1;
    END IF;
    IF v_event IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'event_not_found'); END IF;
    v := public.crm_night_targets(v_venue, v_org, v_event);
    RETURN v || jsonb_build_object('note',
      'Audiences are people WITHOUT a ticket for this event; one person can be in several. status = what the account data says about the hypothesis family '
      || '(supported, not_supported, untested, inconclusive), never a certainty about a person. send_at = suggested moment.');

  WHEN 'get_customer_analysis' THEN
    BEGIN
      v := public.crm_analysis_overview(v_venue, v_org);
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('ok', false, 'error', 'analysis_unavailable', 'detail', public._mcp_unavailable(SQLSTATE, SQLERRM));
    END;
    IF v->'state' IS NULL OR jsonb_typeof(v->'state') = 'null' THEN
      RETURN jsonb_build_object('ok', true, 'computed', false,
        'note', 'No customer analysis yet: it needs a connected ticketing (Shotgun) and runs the night after the first import.');
    END IF;
    BEGIN
      v2 := public.crm_artists_analysis(v_venue, v_org, 15);
    EXCEPTION WHEN others THEN v2 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    RETURN jsonb_build_object('ok', true, 'computed', true,
      'computed_at', v->'state'->'full_at', 'rules_version', v->'rules_version', 'min_sample', v->'min_sample',
      'families', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                     'family', f->>'family', 'variant', nullif(f->>'variant', ''), 'kind', f->>'kind',
                     'availability', f->>'availability', 'status', f->>'status',
                     'matched', f->'o', 'expected_by_chance', f->'e', 'tested', f->'n', 'gain', f->'gain', 'z', f->'z',
                     'direction', f->'direction', 'return_rate_group', f->'detail'->'r1', 'return_rate_others', f->'detail'->'r0',
                     'confirmed_since', CASE WHEN f->>'status' = 'supported' THEN f->'since' END,
                     'seen_on_other_accounts', f->'prior'))), '[]'::jsonb)
                     FROM jsonb_array_elements(coalesce(v->'families', '[]'::jsonb)) f),
      'newcomers_12_months', v->'newcomers',
      'came_once', v->'once',
      'return_delay_days', jsonb_build_object('median', v->'state'->'stats'->'median_days', 'p25', v->'state'->'stats'->'p25_days',
                                              'p75', v->'state'->'stats'->'p75_days', 'returners', v->'state'->'stats'->'returners'),
      'newcomers_returned_6_months', jsonb_build_object('eligible', v->'state'->'stats'->'eligible', 'returned', v->'state'->'stats'->'returned'),
      'coverage', v->'state'->'coverage',
      'artists', CASE WHEN jsonb_typeof(v2) = 'object' AND v2 ? 'artists' THEN jsonb_build_object(
                   'baseline_return_rate', v2->'baseline'->'rate',
                   'top', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                             'name', x->>'name', 'nights', x->'nights', 'entries', x->'entries', 'newcomers', x->'new_brought',
                             'newcomers_returned_6_months', x->'new_returned', 'newcomers_eligible', x->'new_eligible',
                             'return_rate', x->'return_rate', 'seen_twice_or_more', x->'fans', 'resident', x->'resident'))), '[]'::jsonb)
                             FROM jsonb_array_elements(v2->'artists') x)) ELSE v2 END);

  -- ── Fiches clients (niveau 'customers' seulement) ─────────────────────────
  WHEN 'list_customers' THEN
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 25), 50));
    v_offset := greatest(0, least(coalesce(nullif(p_args->>'offset', '')::integer, 0), 500));
    -- Filtre de l'analyse client : clients qui portent une hypothèse (moyenne ou
    -- forte), ou « de passage » / habitant à proximité. Liste Clients du CRM.
    IF nullif(p_args->>'hypothesis', '') IS NOT NULL OR nullif(p_args->>'passing', '') IS NOT NULL THEN
      v := public.crm_clients_list(v_venue, v_org,
             jsonb_build_object('seg', 'all', 'f', jsonb_strip_nulls(jsonb_build_object(
               'hyp', CASE WHEN p_args->>'hypothesis' ~ '^[a-z_]{2,24}$' THEN jsonb_build_array(p_args->>'hypothesis') END,
               'pass', CASE WHEN p_args->>'passing' = 'true' THEN 'yes' WHEN p_args->>'passing' = 'false' THEN 'no' END))),
             CASE WHEN p_args->>'sort' = 'name' THEN 'name' WHEN p_args->>'sort' = 'events' THEN 'n'
                  WHEN p_args->>'sort' = 'spent' THEN 'sp' ELSE 'last' END, 1, v_limit, v_offset);
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'first_name', x->>'first_name', 'last_name', x->>'last_name', 'email', x->>'email',
               'lifecycle', x->>'lifecycle', 'events', x->'nights', 'last_seen_at', x->>'last_night',
               'total_spent', x->'spent', 'email_ok', x->'email_ok', 'sms_ok', x->'phone_ok'))), '[]'::jsonb)
        INTO v2
        FROM jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) x;
      RETURN jsonb_build_object('ok', true, 'total', v->'total', 'offset', v_offset, 'limit', v_limit,
                                'filter', jsonb_strip_nulls(jsonb_build_object('hypothesis', p_args->>'hypothesis', 'passing', p_args->'passing')),
                                'customers', v2);
    END IF;
    v := public.list_contact_base(v_venue, v_org,
           nullif(btrim(coalesce(p_args->>'search', '')), ''),
           CASE WHEN p_args->>'segment_id' ~* '^[0-9a-f-]{36}$' THEN (p_args->>'segment_id')::uuid END,
           CASE WHEN p_args->>'status' IN ('active', 'passive', 'silent', 'new', 'unsubscribed', 'unreachable') THEN p_args->>'status' END,
           CASE WHEN p_args->>'origin' IN ('import', 'yuno', 'both') THEN p_args->>'origin' END,
           NULL,
           CASE WHEN p_args->>'sort' IN ('recent', 'engaged', 'spent', 'events', 'name') THEN p_args->>'sort' ELSE 'spent' END,
           v_limit, v_offset);
    SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'first_name', x->>'first_name', 'last_name', x->>'last_name', 'email', x->>'email',
             'phone', CASE WHEN coalesce((p_args->>'include_phone')::boolean, false) THEN x->>'phone_e164' END,
             'city', x->>'city', 'age', x->'age', 'gender', x->>'gender', 'status', x->>'status',
             'origin', x->>'origin', 'total_spent', x->'total_spent', 'events', x->'event_count',
             'tables', x->'table_count', 'tickets', x->'ticket_count', 'guest_lists', x->'guest_list_count',
             'last_seen_at', x->>'last_seen_at', 'emails_received', x->'emails_sent', 'opens', x->'opens',
             'clicks', x->'clicks', 'email_ok', x->'email_ok', 'sms_ok', x->'phone_ok'))), '[]'::jsonb)
      INTO v2
      FROM jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) x;
    RETURN jsonb_build_object('ok', true, 'total', v->'total', 'offset', v_offset, 'limit', v_limit, 'customers', v2);

  WHEN 'list_customers_by_segment' THEN
    v_limit := greatest(1, least(coalesce(nullif(p_args->>'limit', '')::integer, 25), 50));
    v_topic := nullif(p_args->>'segment', '');
    IF v_crm THEN
      v_ref := CASE WHEN v_topic IN ('champions', 'loyal') THEN 'hab' WHEN v_topic = 'promising' THEN 'occ'
                    WHEN v_topic = 'new' THEN 'nou' WHEN v_topic IN ('at_risk', 'dormant', 'lost', 'churn_risk') THEN 'end' END;
      v := public.crm_clients_list(v_venue, v_org, jsonb_build_object('seg', coalesce(v_ref, 'all'), 'f', '{}'::jsonb),
             'sp', 1, v_limit, 0);
      SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'first_name', x->>'first_name', 'last_name', x->>'last_name', 'email', x->>'email',
               'lifecycle', x->>'lifecycle', 'events', x->'nights', 'last_seen_at', x->>'last_night',
               'total_spent', x->'spent', 'email_ok', x->'email_ok', 'sms_ok', x->'phone_ok'))), '[]'::jsonb)
        INTO v2
        FROM jsonb_array_elements(coalesce(v->'rows', '[]'::jsonb)) x;
      RETURN jsonb_build_object('ok', true, 'segment', v_topic, 'lifecycle', v_ref, 'total', v->'total', 'customers', v2,
        'note', 'Yuno CRM account: segment mapped to the CRM lifecycle (champions/loyal = regulars, promising = occasional, new = new, at_risk/dormant/lost/churn_risk = lapsed).');
    END IF;
    IF v_venue IS NOT NULL THEN
      SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v FROM (
        SELECT s.first_name, s.last_name, s.email, s.total_spent, s.visit_nights AS nights, s.ticket_count AS tickets,
               s.table_count AS tables, s.avg_basket, s.recency_days, s.last_visit_at, s.rfm_segment, s.rfm_tier,
               s.churn_risk, s.preferred_event_title
          FROM public.get_venue_customer_segments(v_venue) s
         WHERE NOT coalesce(s.is_banned, false)
           AND (v_topic IS NULL OR s.rfm_segment = v_topic OR (v_topic = 'churn_risk' AND s.churn_risk))
         ORDER BY s.total_spent DESC NULLS LAST LIMIT v_limit) q;
    ELSE
      SELECT coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) INTO v FROM (
        SELECT s.first_name, s.last_name, s.email, s.total_spent, s.visit_nights AS nights, s.ticket_count AS tickets,
               s.table_count AS tables, s.avg_basket, s.recency_days, s.last_visit_at, s.rfm_segment, s.rfm_tier,
               s.churn_risk, s.preferred_event_title
          FROM public.get_organizer_customer_segments(v_org) s
         WHERE NOT coalesce(s.is_banned, false)
           AND (v_topic IS NULL OR s.rfm_segment = v_topic OR (v_topic = 'churn_risk' AND s.churn_risk))
         ORDER BY s.total_spent DESC NULLS LAST LIMIT v_limit) q;
    END IF;
    RETURN jsonb_build_object('ok', true, 'segment', v_topic, 'customers', v);

  WHEN 'get_customer_profile' THEN
    v_ref := lower(btrim(coalesce(p_args->>'email', '')));
    IF v_ref !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'message', 'email required');
    END IF;
    -- La base de contacts filtrée par l'adresse (350 ms), pas contact_rows()
    -- entier (jusqu'à 20 s sur un compte CRM : la fiche ne répondait jamais).
    v2 := public.list_contact_base(v_venue, v_org, v_ref, NULL, NULL, NULL, NULL, 'recent', 10, 0);
    SELECT x - 'id' - 'list_import_id' INTO v
      FROM jsonb_array_elements(coalesce(v2->'rows', '[]'::jsonb)) x
     WHERE lower(x->>'email') = v_ref LIMIT 1;
    IF v IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'customer_not_found'); END IF;
    BEGIN v2 := public.get_customer_automation_emails(v_venue, v_org, v_ref);
    EXCEPTION WHEN others THEN v2 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    -- Analyse client : ses hypothèses (des FAITS + le statut de leur famille
    -- sur le compte), jamais une affirmation de motif.
    BEGIN
      v3 := public.crm_client_analysis(v_venue, v_org, v_ref);
      v3 := CASE WHEN coalesce((v3->>'profile')::boolean, false) THEN jsonb_build_object(
              'excluded_from_profiling', v3->'excluded', 'nights', v3->'nights', 'distance_km', v3->'dist_km',
              'passing_through', v3->'passing',
              'hypotheses', (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                               'family', h->>'f', 'strength', h->>'s', 'evidence_key', h->>'k', 'evidence', h->'p',
                               'family_status_on_account', h->>'status', 'family_availability', h->>'availability',
                               'direction', h->>'direction'))), '[]'::jsonb)
                               FROM jsonb_array_elements(coalesce(v3->'hyps', '[]'::jsonb)) h),
              'chances_to_come', CASE WHEN v3->>'score_status' = 'ok' THEN v3->'chances' END,
              'first_night', jsonb_strip_nulls(jsonb_build_object(
                'title', v3->'first'->>'title', 'date', v3->'first'->>'start_at', 'days_before', v3->'first'->'lead_days',
                'source', v3->'first'->>'src', 'order_size', v3->'first'->'order_size',
                'with_existing_customer', v3->'first'->'with_returning', 'invitation', v3->'first'->'invitation')))
            ELSE jsonb_build_object('excluded_from_profiling', v3->'excluded', 'hypotheses', '[]'::jsonb,
                                    'note', 'No analysis profile: no Shotgun ticket for this contact, or excluded at their request.') END;
    EXCEPTION WHEN others THEN v3 := public._mcp_unavailable(SQLSTATE, SQLERRM); END;
    RETURN jsonb_build_object('ok', true, 'customer', v, 'automation_emails', v2, 'analysis', v3);

  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END CASE;
END;
$function$;

REVOKE ALL ON FUNCTION public._mcp_tool(text, text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
