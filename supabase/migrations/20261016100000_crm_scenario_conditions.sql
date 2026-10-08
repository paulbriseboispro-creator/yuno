-- ============================================================================
-- Yuno CRM — Scénarios, lot J1 : le langage de conditions « et / ou » (2026-10-16).
-- Plan : docs/designs/CRM_JOURNEYS_PLAN.md (§ 3).
--
-- Un arbre JSON. Groupe : {"op": "and"|"or", "not": bool, "items": [...]} ;
-- feuille : {"k": <clé>, "v": <valeur>}. Profondeur 3 au plus (racine
-- comprise), 20 feuilles au plus.
--
--   • Feuilles « personne » = le vocabulaire de _crm_filter_sql, compilées PAR
--     _crm_filter_sql lui-même : le chiffre affiché = le filtre = l'envoi.
--     Écartées : `emails` et `q` (une définition ne porte jamais de donnée
--     personnelle). Ajoutée : `segment` (un segment enregistré, remplacé par sa
--     définition par _crm_cond_resolve). `ev`, `glev` et `ntgt.e` acceptent
--     « $event » : la soirée du scénario.
--   • Feuilles « scénario » (contexte d'une inscription, alias de ligne r :
--     scope_key, event_id, email, entered_at, version_id) : sc_bought,
--     sc_entered, sc_opened, sc_clicked, sc_sms_delivered, sc_chance,
--     sc_family. sc_sms_clicked est « Bientôt » (le lien court d'un SMS est
--     partagé par soirée). Dans le filtre d'ENTRÉE, seules sc_chance et
--     sc_family sont permises.
--   • Sûreté : une clé inconnue, une valeur illisible, une référence non
--     résolue rendent l'arbre ENTIER faux, même sous un « non » : l'audience
--     rétrécit, jamais l'inverse.
--
-- Miroir TypeScript : src/crm/lib/scenarioConditions.ts (mêmes codes, mêmes
-- chemins). Cas partagés : src/crm/lib/__tests__/fixtures/scenario-conditions.json,
-- rejoués au banc par scripts/crm-bench/scenarios.mjs.
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1. Une feuille : NULL si elle est bonne, sinon le code d'erreur ─────────
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
         WHEN 'arr' THEN x #>> '{}' IN ('ys', 'yb', 'yt', 'yl', 'em', 'sm', 'dm', 'so', 'sg', 'au', 'di', 'of', 'gl')
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
REVOKE ALL ON FUNCTION public._crm_cond_leaf_check(text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_cond_leaf_check(text, jsonb, text) TO service_role;

-- ── 2. Les erreurs d'un arbre (même ordre et mêmes chemins que condErrors) ──
-- Parcours préfixe, éléments dans l'ordre ; chemin = index séparés par des
-- points depuis la racine (« 1.0 »), '' = la racine.
CREATE OR REPLACE FUNCTION public._crm_cond_walk(p_n jsonb, p_path text, p_depth integer, p_ctx text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  errs jsonb := '[]'::jsonb;
  leaves integer := 0;
  sub jsonb;
  i integer;
  code text;
BEGIN
  IF p_n IS NULL OR jsonb_typeof(p_n) <> 'object' THEN
    RETURN jsonb_build_object('errors', jsonb_build_array(jsonb_build_object('code', 'not_object', 'path', p_path)), 'leaves', 0);
  END IF;
  IF p_n ? 'op' THEN
    IF p_depth > 3 THEN
      RETURN jsonb_build_object('errors', jsonb_build_array(jsonb_build_object('code', 'too_deep', 'path', p_path)), 'leaves', 0);
    END IF;
    IF jsonb_typeof(p_n->'op') IS DISTINCT FROM 'string' OR p_n->>'op' NOT IN ('and', 'or') THEN
      errs := errs || jsonb_build_object('code', 'bad_op', 'path', p_path);
    END IF;
    IF p_n ? 'not' AND jsonb_typeof(p_n->'not') <> 'boolean' THEN
      errs := errs || jsonb_build_object('code', 'bad_not', 'path', p_path);
    END IF;
    -- Deux IF : Postgres ne promet pas l'ordre d'un OR (jsonb_array_length lèverait sur un objet).
    IF jsonb_typeof(p_n->'items') IS DISTINCT FROM 'array' THEN
      RETURN jsonb_build_object('errors', errs || jsonb_build_object('code', 'empty_group', 'path', p_path), 'leaves', 0);
    END IF;
    IF jsonb_array_length(p_n->'items') = 0 THEN
      RETURN jsonb_build_object('errors', errs || jsonb_build_object('code', 'empty_group', 'path', p_path), 'leaves', 0);
    END IF;
    FOR i IN 0 .. jsonb_array_length(p_n->'items') - 1 LOOP
      sub := public._crm_cond_walk(p_n->'items'->i,
                                   CASE WHEN p_path = '' THEN i::text ELSE p_path || '.' || i END,
                                   p_depth + 1, p_ctx);
      errs := errs || (sub->'errors');
      leaves := leaves + (sub->>'leaves')::integer;
    END LOOP;
    RETURN jsonb_build_object('errors', errs, 'leaves', leaves);
  END IF;
  code := public._crm_cond_leaf_check(CASE WHEN jsonb_typeof(p_n->'k') = 'string' THEN p_n->>'k' END, p_n->'v', p_ctx);
  IF code IS NOT NULL THEN errs := errs || jsonb_build_object('code', code, 'path', p_path); END IF;
  RETURN jsonb_build_object('errors', errs, 'leaves', 1);
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_cond_walk(jsonb, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_cond_walk(jsonb, text, integer, text) TO service_role;

-- p_ctx : 'entry' (filtre d'entrée) | 'step' (embranchement, attente, objectif).
CREATE OR REPLACE FUNCTION public._crm_cond_errors(p_tree jsonb, p_ctx text DEFAULT 'step')
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  r jsonb;
BEGIN
  IF p_tree IS NULL OR p_tree = 'null'::jsonb THEN RETURN '[]'::jsonb; END IF;
  IF jsonb_typeof(p_tree) <> 'object' OR NOT (p_tree ? 'op') THEN
    RETURN jsonb_build_array(jsonb_build_object('code', 'root_not_group', 'path', ''));
  END IF;
  r := public._crm_cond_walk(p_tree, '', 1, CASE WHEN p_ctx = 'entry' THEN 'entry' ELSE 'step' END);
  IF (r->>'leaves')::integer > 20 THEN
    RETURN (r->'errors') || jsonb_build_object('code', 'too_many_leaves', 'path', '');
  END IF;
  RETURN r->'errors';
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_cond_errors(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_cond_errors(jsonb, text) TO service_role;

-- ── 3. Une famille CONFIRMÉE sur le compte (miroir de supportedForSegments) ─
CREATE OR REPLACE FUNCTION public._crm_family_confirmed(p_scope text, p_family text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_family_status f
     WHERE f.scope_key = p_scope AND f.family = p_family AND f.variant = ''
       AND f.status = 'supported' AND f.availability NOT IN ('unavailable', 'uniform')
       AND (f.kind <> 'return'
            OR (f.family = 'passing' AND f.direction = 'less')
            OR (f.family <> 'passing' AND f.direction = 'more')));
$function$;
REVOKE ALL ON FUNCTION public._crm_family_confirmed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_family_confirmed(text, text) TO service_role;

-- ── 4. Résoudre : segments enregistrés et « $event » ────────────────────────
-- Une feuille `segment` devient {"k": "_def", "v": <définition>} (compilée par
-- _crm_filter_sql tel quel, liste fixe comprise : elle vient de la base, pas
-- de la définition du scénario). Un segment d'une autre portée, effacé, ou un
-- « $event » sans soirée restent tels quels : le compilateur rend alors faux.
-- `_def` n'est jamais accepté à la publication (_crm_cond_errors : clé inconnue).
CREATE OR REPLACE FUNCTION public._crm_cond_resolve(p_scope text, p_tree jsonb, p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_def jsonb;
  v_out jsonb;
  i integer;
BEGIN
  IF p_tree IS NULL OR jsonb_typeof(p_tree) <> 'object' THEN RETURN p_tree; END IF;
  IF p_tree ? 'op' THEN
    IF jsonb_typeof(p_tree->'items') IS DISTINCT FROM 'array' THEN RETURN p_tree; END IF;
    v_out := '[]'::jsonb;
    FOR i IN 0 .. jsonb_array_length(p_tree->'items') - 1 LOOP
      v_out := v_out || jsonb_build_array(public._crm_cond_resolve(p_scope, p_tree->'items'->i, p_event));
    END LOOP;
    RETURN jsonb_set(p_tree, '{items}', v_out);
  END IF;
  IF p_tree->>'k' = 'segment' AND (p_tree->>'v') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT s.definition INTO v_def FROM public.crm_segments s
     WHERE s.id = (p_tree->>'v')::uuid AND s.scope_key = p_scope;
    IF v_def IS NOT NULL THEN RETURN jsonb_build_object('k', '_def', 'v', v_def); END IF;
    RETURN p_tree;
  END IF;
  IF p_event IS NOT NULL THEN
    IF p_tree->>'k' IN ('ev', 'glev') AND jsonb_typeof(p_tree->'v') = 'array' THEN
      RETURN jsonb_build_object('k', p_tree->>'k', 'v', (
        SELECT COALESCE(jsonb_agg(CASE WHEN x #>> '{}' = '$event' THEN to_jsonb(p_event::text) ELSE x END), '[]'::jsonb)
          FROM jsonb_array_elements(p_tree->'v') x));
    END IF;
    IF p_tree->>'k' = 'ntgt' AND p_tree->'v'->>'e' = '$event' THEN
      RETURN jsonb_build_object('k', 'ntgt', 'v', jsonb_set(p_tree->'v', '{e}', to_jsonb(p_event::text)));
    END IF;
  END IF;
  RETURN p_tree;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_cond_resolve(text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_cond_resolve(text, jsonb, uuid) TO service_role;

-- ── 5. Compiler une feuille : NULL = illisible (l'arbre entier sera faux) ───
-- p_p : alias de la ligne personne (_cp) ; p_r : alias de la ligne
-- d'inscription (scope_key, event_id, email, entered_at, version_id).
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
                  ' AND lower(t.buyer_email) = %s.email AND public._crm_ticket_is_sale(t.status, t.raw)'
                  ' AND COALESCE(t.purchased_at, t.first_seen_at) >= %s.entered_at)', r, r, r);
      RETURN CASE WHEN p_v = 'true'::jsonb THEN q ELSE 'NOT ' || q END;
    WHEN 'sc_entered' THEN
      q := format('EXISTS (SELECT 1 FROM public.external_tickets t WHERE t.event_id = %s.event_id'
                  ' AND lower(t.buyer_email) = %s.email AND t.scanned_at IS NOT NULL)', r, r);
      RETURN CASE WHEN p_v = 'true'::jsonb THEN q ELSE 'NOT ' || q END;
    WHEN 'sc_opened', 'sc_clicked' THEN
      RETURN format('EXISTS (SELECT 1 FROM public.crm_scenario_messages m'
                    ' JOIN public.email_campaign_events ev ON ev.campaign_id = m.campaign_id'
                    ' WHERE m.version_id = %s.version_id AND m.node_id = %L AND ev.event_type IN (%s)'
                    ' AND lower(ev.recipient_email) = %s.email)',
                    r, p_v #>> '{}', CASE p_k WHEN 'sc_opened' THEN '''opened'', ''clicked''' ELSE '''clicked''' END, r);
    WHEN 'sc_sms_delivered' THEN
      RETURN format('EXISTS (SELECT 1 FROM public.crm_scenario_messages m'
                    ' JOIN public.sms_campaign_recipients sr ON sr.campaign_id = m.sms_campaign_id'
                    ' WHERE m.version_id = %s.version_id AND m.node_id = %L AND sr.status = ''delivered'''
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
REVOKE ALL ON FUNCTION public._crm_cond_leaf_sql(text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_cond_leaf_sql(text, jsonb, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public._crm_cond_node_sql(p_n jsonb, p_p text, p_r text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  parts text[] := '{}';
  q text;
  i integer;
BEGIN
  IF p_n ? 'op' THEN
    FOR i IN 0 .. jsonb_array_length(p_n->'items') - 1 LOOP
      q := public._crm_cond_node_sql(p_n->'items'->i, p_p, p_r);
      IF q IS NULL THEN RETURN NULL; END IF;
      parts := array_append(parts, q);
    END LOOP;
    q := '(' || array_to_string(parts, CASE WHEN p_n->>'op' = 'or' THEN ' OR ' ELSE ' AND ' END) || ')';
    RETURN CASE WHEN p_n->'not' = 'true'::jsonb THEN '(NOT ' || q || ')' ELSE q END;
  END IF;
  RETURN public._crm_cond_leaf_sql(p_n->>'k', p_n->'v', p_p, p_r);
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_cond_node_sql(jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_cond_node_sql(jsonb, text, text) TO service_role;

-- ── 6. Compiler un arbre (déjà résolu) ──────────────────────────────────────
-- NULL = pas de condition = vrai. Une erreur quelconque, ou une feuille
-- illisible / non résolue, rend « false » pour TOUT l'arbre.
CREATE OR REPLACE FUNCTION public._crm_cond_sql(p_tree jsonb, p_p text DEFAULT 'p', p_r text DEFAULT 'r')
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_errs jsonb;
  q text;
BEGIN
  IF p_tree IS NULL OR p_tree = 'null'::jsonb THEN RETURN 'true'; END IF;
  -- Les feuilles `_def` viennent du résolveur : on les remplace par une feuille
  -- neutre pour la vérification de forme, le compilateur les lit à part.
  v_errs := public._crm_cond_errors(public._crm_cond_strip_defs(p_tree), 'step');
  IF jsonb_array_length(v_errs) > 0 THEN RETURN 'false'; END IF;
  q := public._crm_cond_node_sql(p_tree, p_p, p_r);
  RETURN COALESCE(q, 'false');
END;
$function$;

-- Remplace chaque feuille `_def` par une feuille valide quelconque (pour la
-- seule vérification de forme : profondeur, nombre de feuilles, opérateurs).
CREATE OR REPLACE FUNCTION public._crm_cond_strip_defs(p_n jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
  i integer;
BEGIN
  IF p_n IS NULL OR jsonb_typeof(p_n) <> 'object' THEN RETURN p_n; END IF;
  IF p_n ? 'op' THEN
    IF jsonb_typeof(p_n->'items') IS DISTINCT FROM 'array' THEN RETURN p_n; END IF;
    v_out := '[]'::jsonb;
    FOR i IN 0 .. jsonb_array_length(p_n->'items') - 1 LOOP
      v_out := v_out || jsonb_build_array(public._crm_cond_strip_defs(p_n->'items'->i));
    END LOOP;
    RETURN jsonb_set(p_n, '{items}', v_out);
  END IF;
  IF p_n->>'k' = '_def' THEN RETURN '{"k": "up", "v": "yes"}'::jsonb; END IF;
  RETURN p_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._crm_cond_strip_defs(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_cond_strip_defs(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public._crm_cond_sql(jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_cond_sql(jsonb, text, text) TO service_role;
