-- ============================================================================
-- Yuno CRM — Scénarios, lot J1 : la validation de forme du graphe (2026-10-16).
-- Plan : docs/designs/CRM_JOURNEYS_PLAN.md (§ 4).
--
-- _crm_scenario_graph_errors(graph) → {"errors": [...], "stats": {...}}.
-- MIROIR EXACT de graphErrors (src/crm/lib/scenarioGraph.ts) : mêmes codes,
-- mêmes champs, même tri (le scénario d'abord, puis nœud, champ, code, dans
-- l'ordre des octets), mêmes chiffres de chemins. Cas partagés :
-- src/crm/lib/__tests__/fixtures/scenario-graphs.json (banc : scenarios.mjs).
--
-- Rythme : le temps se compte en MINUTES entières. Deux messages d'un même
-- chemin sont à 20 h au moins ; on ne refuse que ce qui est PROUVÉ trop
-- proche, le moteur reporte le reste. Les contrôles qui lisent la base
-- (modèle du compte, identité SMS, prix) vivent dans la publication (lot J2).
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1. Petits outils (purs) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_scn_int(p jsonb, p_lo bigint, p_hi bigint)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN jsonb_typeof(p) = 'number'
              THEN (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric)
                   AND (p #>> '{}')::numeric BETWEEN p_lo AND p_hi
              ELSE false END;
$function$;

-- Texte de longueur bornée, espaces retirées comme btrim (miroir : btrim TS).
CREATE OR REPLACE FUNCTION public._crm_scn_str(p jsonb, p_lo integer, p_hi integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN jsonb_typeof(p) = 'string'
              THEN length(btrim(p #>> '{}')) BETWEEN p_lo AND p_hi
              ELSE false END;
$function$;

CREATE OR REPLACE FUNCTION public._crm_scn_uuid(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN jsonb_typeof(p) = 'string'
              THEN (p #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              ELSE false END;
$function$;

-- Une adresse web dans un texte : seul le lien court Yuno ({{lien}}) est permis.
CREATE OR REPLACE FUNCTION public._crm_scn_has_url(p_text text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(p_text ~* '(https?://|www\.|[a-z0-9-]+\.(fr|com|eu|es|net|org|io|be|ch|ly|link|app|me|co)(?![a-z0-9]))', false);
$function$;

-- Ajoute une erreur si elle n'y est pas déjà (même code, nœud, champ).
CREATE OR REPLACE FUNCTION public._crm_scn_push(p_errs jsonb, p_code text, p_node text, p_field text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN p_errs @> jsonb_build_array(jsonb_build_object('code', p_code, 'node', p_node, 'field', p_field))
              THEN p_errs
              ELSE p_errs || jsonb_build_object('code', p_code, 'node', p_node, 'field', p_field) END;
$function$;

-- Le nœud d'id p_id s'il existe et est un objet, sinon NULL.
CREATE OR REPLACE FUNCTION public._crm_scn_node(p_nodes jsonb, p_id jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN jsonb_typeof(p_id) = 'string' AND jsonb_typeof(p_nodes -> (p_id #>> '{}')) = 'object'
              THEN p_nodes -> (p_id #>> '{}') END;
$function$;

-- Successeurs d'un nœud, dans l'ordre : [{"field", "id"}] (id peut manquer).
CREATE OR REPLACE FUNCTION public._crm_scn_succ(p_n jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_n->>'type'
    WHEN 'branch' THEN jsonb_build_array(jsonb_build_object('field', 'yes', 'id', p_n->'yes'),
                                         jsonb_build_object('field', 'no', 'id', p_n->'no'))
    WHEN 'split' THEN CASE WHEN jsonb_typeof(p_n->'paths') = 'array'
      THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('field', 'paths.' || (o - 1),
                                                         'id', CASE WHEN jsonb_typeof(x) = 'object' THEN x->'next' END)
                                      ORDER BY o), '[]'::jsonb)
              FROM jsonb_array_elements(p_n->'paths') WITH ORDINALITY AS a(x, o))
      ELSE '[]'::jsonb END
    WHEN 'wait' THEN CASE WHEN p_n->>'mode' = 'until_cond'
      THEN jsonb_build_array(jsonb_build_object('field', 'next', 'id', p_n->'next'),
                             jsonb_build_object('field', 'timeout', 'id', p_n->'timeout'))
      ELSE jsonb_build_array(jsonb_build_object('field', 'next', 'id', p_n->'next')) END
    WHEN 'end' THEN '[]'::jsonb
    ELSE jsonb_build_array(jsonb_build_object('field', 'next', 'id', p_n->'next'))
  END;
$function$;

-- Miroir de condNeedsEvent : une feuille qui exige la soirée du scénario.
CREATE OR REPLACE FUNCTION public._crm_cond_needs_event(p_tree jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  i integer;
BEGIN
  IF p_tree IS NULL OR jsonb_typeof(p_tree) <> 'object' THEN RETURN false; END IF;
  IF p_tree ? 'op' THEN
    IF jsonb_typeof(p_tree->'items') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    FOR i IN 0 .. jsonb_array_length(p_tree->'items') - 1 LOOP
      IF public._crm_cond_needs_event(p_tree->'items'->i) THEN RETURN true; END IF;
    END LOOP;
    RETURN false;
  END IF;
  IF p_tree->>'k' IN ('sc_bought', 'sc_entered', 'sc_chance') THEN RETURN true; END IF;
  IF p_tree->>'k' IN ('ev', 'glev') AND jsonb_typeof(p_tree->'v') = 'array' THEN RETURN (p_tree->'v') ? '$event'; END IF;
  RETURN COALESCE(p_tree->>'k' = 'ntgt' AND jsonb_typeof(p_tree->'v') = 'object' AND (p_tree->'v'->>'e') = '$event', false);
END;
$function$;

-- Miroir de condNodeRefs : [{"k", "node"}] des feuilles de messages.
CREATE OR REPLACE FUNCTION public._crm_cond_node_refs(p_tree jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  i integer;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF p_tree IS NULL OR jsonb_typeof(p_tree) <> 'object' THEN RETURN v_out; END IF;
  IF p_tree ? 'op' THEN
    IF jsonb_typeof(p_tree->'items') IS DISTINCT FROM 'array' THEN RETURN v_out; END IF;
    FOR i IN 0 .. jsonb_array_length(p_tree->'items') - 1 LOOP
      v_out := v_out || public._crm_cond_node_refs(p_tree->'items'->i);
    END LOOP;
    RETURN v_out;
  END IF;
  IF p_tree->>'k' IN ('sc_opened', 'sc_clicked', 'sc_sms_delivered') AND jsonb_typeof(p_tree->'v') = 'string' THEN
    RETURN jsonb_build_array(jsonb_build_object('k', p_tree->>'k', 'node', p_tree->>'v'));
  END IF;
  RETURN v_out;
END;
$function$;

-- Les erreurs d'une condition, recodées pour le graphe (« cond_<code> », champ « <préfixe>:<chemin> »).
CREATE OR REPLACE FUNCTION public._crm_scn_cond_into(p_errs jsonb, p_tree jsonb, p_ctx text, p_node text, p_prefix text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  e jsonb;
  v_errs jsonb := p_errs;
BEGIN
  FOR e IN SELECT x FROM jsonb_array_elements(public._crm_cond_errors(p_tree, p_ctx)) x LOOP
    v_errs := public._crm_scn_push(v_errs, 'cond_' || (e->>'code'), p_node, p_prefix || ':' || (e->>'path'));
  END LOOP;
  RETURN v_errs;
END;
$function$;

-- ── 2. Les chemins : messages et rythme (miroir de walk) ────────────────────
-- p_st = {"since": [lo, hi] | null, "pos": {"anchor","frame","lo","hi"} | null,
--         "msgs", "emails", "sms"} ; p_acc = {"errors", "paths", "max_messages",
--         "max_emails", "max_sms", "stop"}. Temps en minutes, 1e9 = sans borne.
CREATE OR REPLACE FUNCTION public._crm_scn_walk(p_nodes jsonb, p_id text, p_st jsonb, p_acc jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  n jsonb := public._crm_scn_node(p_nodes, to_jsonb(p_id));
  s jsonb := p_st;
  acc jsonb := p_acc;
  nx jsonb;
  nxt jsonb;
  v_msgs integer;
  v_m bigint;
  v_lo bigint; v_hi bigint;
  v_to jsonb;
  v_slack bigint;
  v_d jsonb;
  v_inf bigint := 1000000000;
BEGIN
  IF (acc->>'stop')::boolean OR n IS NULL THEN RETURN acc; END IF;
  IF n->>'type' IN ('email', 'sms', 'instagram_dm') THEN
    IF jsonb_typeof(s->'since') = 'array' AND (s->'since'->>1)::bigint < 1200 THEN
      acc := jsonb_set(acc, '{errors}', public._crm_scn_push(acc->'errors', 'too_close', p_id, NULL));
    END IF;
    v_msgs := (s->>'msgs')::integer + 1;
    IF v_msgs > 6 THEN
      acc := jsonb_set(acc, '{errors}', public._crm_scn_push(acc->'errors', 'too_many_messages', p_id, NULL));
    END IF;
    s := jsonb_build_object('since', '[0, 0]'::jsonb, 'pos', s->'pos', 'msgs', v_msgs,
                            'emails', (s->>'emails')::integer + CASE WHEN n->>'type' = 'email' THEN 1 ELSE 0 END,
                            'sms', (s->>'sms')::integer + CASE WHEN n->>'type' = 'sms' THEN 1 ELSE 0 END);
  END IF;
  IF n->>'type' = 'end' THEN
    acc := jsonb_set(acc, '{paths}', to_jsonb((acc->>'paths')::integer + 1));
    IF (acc->>'paths')::integer > 512 THEN
      acc := jsonb_set(acc, '{stop}', 'true'::jsonb);
      RETURN jsonb_set(acc, '{errors}', public._crm_scn_push(acc->'errors', 'too_many_paths', NULL, 'nodes'));
    END IF;
    acc := jsonb_set(acc, '{max_messages}', to_jsonb(GREATEST((acc->>'max_messages')::integer, (s->>'msgs')::integer)));
    acc := jsonb_set(acc, '{max_emails}', to_jsonb(GREATEST((acc->>'max_emails')::integer, (s->>'emails')::integer)));
    RETURN jsonb_set(acc, '{max_sms}', to_jsonb(GREATEST((acc->>'max_sms')::integer, (s->>'sms')::integer)));
  END IF;
  FOR nx IN SELECT x FROM jsonb_array_elements(public._crm_scn_succ(n)) x LOOP
    CONTINUE WHEN jsonb_typeof(nx->'id') IS DISTINCT FROM 'string';
    nxt := s;
    IF n->>'type' = 'wait' THEN
      v_d := NULL;
      -- Une attente illisible ne compte pas (on ne l'invente pas) : le validateur l'a déjà signalée.
      IF n->>'mode' = 'duration' AND public._crm_scn_int(n->'hours', 1, 2160) THEN
        v_m := round(60 * (n->>'hours')::numeric);
        v_d := jsonb_build_array(v_m, v_m);
      ELSIF n->>'mode' = 'until_cond' AND public._crm_scn_int(n->'max_hours', 1, 744) THEN
        v_m := round(60 * (n->>'max_hours')::numeric);
        v_d := CASE WHEN nx->>'field' = 'timeout' THEN jsonb_build_array(v_m, v_m) ELSE jsonb_build_array(0, v_m) END;
      ELSIF n->>'mode' = 'until_event' AND n->>'anchor' IN ('start', 'end', 'sale_open')
            AND (public._crm_scn_int(n->'hours', -720, 720)
                 OR (public._crm_scn_int(n->'days', -60, 60) AND jsonb_typeof(n->'at') = 'string'
                     AND (n->>'at') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')) THEN
        -- Le repère visé : les heures si elles sont lisibles, sinon jour + heure.
        IF public._crm_scn_int(n->'hours', -720, 720) THEN
          v_m := round(60 * (n->>'hours')::numeric);
          v_to := jsonb_build_object('anchor', n->>'anchor', 'frame', 'h', 'lo', v_m, 'hi', v_m);
        ELSE
          v_m := round(1440 * (n->>'days')::numeric) + 60 * split_part(n->>'at', ':', 1)::integer + split_part(n->>'at', ':', 2)::integer;
          v_to := jsonb_build_object('anchor', n->>'anchor', 'frame', 'd', 'lo', v_m, 'hi', v_m);
        END IF;
        IF jsonb_typeof(s->'since') = 'array' THEN
          IF jsonb_typeof(s->'pos') = 'object' AND s->'pos'->>'anchor' = v_to->>'anchor' THEN
            v_slack := CASE WHEN s->'pos'->>'frame' = v_to->>'frame' THEN 0 ELSE 1440 END;
            v_lo := GREATEST(0, (v_to->>'lo')::bigint - (s->'pos'->>'hi')::bigint - v_slack);
            v_hi := GREATEST(0, (v_to->>'hi')::bigint - (s->'pos'->>'lo')::bigint + v_slack);
            nxt := jsonb_set(nxt, '{since}', jsonb_build_array(LEAST(v_inf, (s->'since'->>0)::bigint + v_lo),
                                                                LEAST(v_inf, (s->'since'->>1)::bigint + v_hi)));
          ELSE
            nxt := jsonb_set(nxt, '{since}', jsonb_build_array((s->'since'->>0)::bigint, v_inf));
          END IF;
        END IF;
        nxt := jsonb_set(nxt, '{pos}', v_to);
      END IF;
      IF v_d IS NOT NULL THEN
        IF jsonb_typeof(s->'since') = 'array' THEN
          nxt := jsonb_set(nxt, '{since}', jsonb_build_array(LEAST(v_inf, (s->'since'->>0)::bigint + (v_d->>0)::bigint),
                                                              LEAST(v_inf, (s->'since'->>1)::bigint + (v_d->>1)::bigint)));
        END IF;
        IF jsonb_typeof(s->'pos') = 'object' THEN
          nxt := jsonb_set(nxt, '{pos}', s->'pos' || jsonb_build_object('lo', (s->'pos'->>'lo')::bigint + (v_d->>0)::bigint,
                                                                         'hi', (s->'pos'->>'hi')::bigint + (v_d->>1)::bigint));
        END IF;
      END IF;
    END IF;
    acc := public._crm_scn_walk(p_nodes, nx->>'id', nxt, acc);
  END LOOP;
  RETURN acc;
END;
$function$;

-- Parcours en profondeur (miroir de visit) : couleurs dans p_color, cycles dans les erreurs.
CREATE OR REPLACE FUNCTION public._crm_scn_visit(p_nodes jsonb, p_id text, p_acc jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  acc jsonb := jsonb_set(p_acc, ARRAY['color', p_id], '1'::jsonb);
  n jsonb := COALESCE(public._crm_scn_node(p_nodes, to_jsonb(p_id)), '{"type": "end"}'::jsonb);
  sx jsonb;
  c text;
BEGIN
  FOR sx IN SELECT x FROM jsonb_array_elements(public._crm_scn_succ(n)) x LOOP
    CONTINUE WHEN public._crm_scn_node(p_nodes, sx->'id') IS NULL;
    c := acc->'color'->>(sx->>'id');
    IF c = '1' THEN
      acc := jsonb_set(acc, '{cyclic}', 'true'::jsonb);
      acc := jsonb_set(acc, '{errors}', public._crm_scn_push(acc->'errors', 'cycle', p_id, sx->>'field'));
    ELSIF c IS NULL THEN
      acc := public._crm_scn_visit(p_nodes, sx->>'id', acc);
    END IF;
  END LOOP;
  RETURN jsonb_set(acc, ARRAY['color', p_id], '2'::jsonb);
END;
$function$;

-- ── 3. Le graphe ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._crm_scenario_graph_errors(p_graph jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  g jsonb := p_graph;
  errs jsonb := '[]'::jsonb;
  stats jsonb := '{"paths": 0, "maxMessages": 0, "maxEmails": 0, "maxSms": 0}'::jsonb;
  t jsonb;
  tt text;
  trig_ok boolean := false;
  has_event boolean := false;
  entry jsonb;
  re jsonb;
  gt text;
  nodes jsonb;
  ids text[];
  id text;
  n jsonb;
  sx jsonb;
  ps jsonb;
  ref jsonb;
  v_start text;
  acc jsonb;
  v_init jsonb := NULL;
  by_hours boolean;
  hhmm text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
  ev_trig text[] := ARRAY['event_published', 'before_event', 'after_event', 'ticket_bought', 'click_no_buy', 'chance_high', 'signup_confirmed'];
BEGIN
  IF g IS NULL OR jsonb_typeof(g) <> 'object' OR g->'v' IS DISTINCT FROM '1'::jsonb THEN
    RETURN jsonb_build_object('errors', jsonb_build_array(jsonb_build_object('code', 'bad_version', 'node', NULL, 'field', 'v')), 'stats', stats);
  END IF;

  -- Déclencheur. Un déclencheur illisible ne fait pas pleuvoir les « sans soirée ».
  t := CASE WHEN jsonb_typeof(g->'trigger') = 'object' THEN g->'trigger' END;
  tt := CASE WHEN jsonb_typeof(t->'type') = 'string' THEN t->>'type' END;
  IF t IS NULL OR tt IS NULL THEN
    errs := public._crm_scn_push(errs, 'bad_trigger', NULL, 'trigger');
  ELSIF tt IN ('cart_abandoned', 'shotgun_visit') THEN
    errs := public._crm_scn_push(errs, 'soon', NULL, 'trigger');
  ELSIF tt NOT IN ('event_published', 'before_event', 'after_event', 'ticket_bought', 'segment_joined', 'absence',
                   'click_no_buy', 'signup_confirmed', 'chance_high', 'manual_segment') THEN
    errs := public._crm_scn_push(errs, 'bad_trigger', NULL, 'trigger');
  ELSE
    trig_ok := true;
    has_event := tt = ANY (ev_trig);
    IF tt = 'before_event' AND NOT public._crm_scn_int(t->'days', 1, 60) THEN errs := public._crm_scn_push(errs, 'bad_param', NULL, 'trigger.days'); END IF;
    IF tt = 'after_event' THEN
      IF NOT public._crm_scn_int(t->'hours', 1, 720) THEN errs := public._crm_scn_push(errs, 'bad_param', NULL, 'trigger.hours'); END IF;
      IF NOT COALESCE(t->>'who' IN ('entered', 'absent_buyers', 'all'), false) THEN errs := public._crm_scn_push(errs, 'bad_param', NULL, 'trigger.who'); END IF;
    END IF;
    IF tt = 'absence' AND NOT public._crm_scn_int(t->'days', 14, 730) THEN errs := public._crm_scn_push(errs, 'bad_param', NULL, 'trigger.days'); END IF;
    IF tt = 'click_no_buy' AND NOT public._crm_scn_int(t->'hours', 1, 72) THEN errs := public._crm_scn_push(errs, 'bad_param', NULL, 'trigger.hours'); END IF;
    IF tt = 'ticket_bought' AND jsonb_typeof(t->'first') IS DISTINCT FROM 'boolean' THEN errs := public._crm_scn_push(errs, 'bad_param', NULL, 'trigger.first'); END IF;
    IF tt IN ('segment_joined', 'manual_segment') AND NOT public._crm_scn_uuid(t->'segment_id') THEN errs := public._crm_scn_push(errs, 'bad_param', NULL, 'trigger.segment_id'); END IF;
    IF tt = 'signup_confirmed' AND NOT public._crm_scn_uuid(t->'page_id') THEN errs := public._crm_scn_push(errs, 'bad_param', NULL, 'trigger.page_id'); END IF;
    IF tt IN ('before_event', 'ticket_bought') AND t ? 'series' AND jsonb_typeof(t->'series') <> 'null'
       AND NOT public._crm_scn_str(t->'series', 1, 300) THEN errs := public._crm_scn_push(errs, 'bad_param', NULL, 'trigger.series'); END IF;
    IF tt = 'before_event' AND t ? 'genre' AND jsonb_typeof(t->'genre') <> 'null'
       AND NOT public._crm_scn_str(t->'genre', 1, 60) THEN errs := public._crm_scn_push(errs, 'bad_param', NULL, 'trigger.genre'); END IF;
  END IF;

  -- Entrée.
  entry := CASE WHEN jsonb_typeof(g->'entry') = 'object' THEN g->'entry' END;
  IF entry IS NULL THEN
    errs := public._crm_scn_push(errs, 'bad_entry', NULL, 'entry');
  ELSE
    errs := public._crm_scn_cond_into(errs, entry->'filter', 'entry', NULL, 'entry.filter');
    IF trig_ok AND NOT has_event AND jsonb_typeof(entry->'filter') = 'object' AND (entry->'filter') ? 'op'
       AND public._crm_cond_needs_event(entry->'filter') THEN
      errs := public._crm_scn_push(errs, 'no_event', NULL, 'entry.filter');
    END IF;
    re := CASE WHEN jsonb_typeof(entry->'reentry') = 'object' THEN entry->'reentry' END;
    IF re IS NULL OR NOT COALESCE(re->>'mode' IN ('once', 'per_event', 'every_days'), false) THEN
      errs := public._crm_scn_push(errs, 'bad_reentry', NULL, 'entry.reentry');
    ELSIF re->>'mode' = 'every_days' AND NOT public._crm_scn_int(re->'days', 7, 365) THEN
      errs := public._crm_scn_push(errs, 'bad_reentry', NULL, 'entry.reentry');
    ELSIF re->>'mode' = 'per_event' AND trig_ok AND NOT has_event THEN
      errs := public._crm_scn_push(errs, 'no_event', NULL, 'entry.reentry');
    END IF;
    IF jsonb_typeof(entry->'holdout') IS DISTINCT FROM 'boolean' THEN
      errs := public._crm_scn_push(errs, 'bad_entry', NULL, 'entry.holdout');
    END IF;
  END IF;

  -- Objectif.
  IF g ? 'goal' AND jsonb_typeof(g->'goal') <> 'null' THEN
    gt := CASE WHEN jsonb_typeof(g->'goal') = 'object' AND jsonb_typeof(g->'goal'->'type') = 'string' THEN g->'goal'->>'type' END;
    IF gt IS NULL OR gt NOT IN ('bought_event', 'bought_any', 'entered') THEN
      errs := public._crm_scn_push(errs, 'bad_goal', NULL, 'goal');
    ELSIF gt <> 'bought_any' AND trig_ok AND NOT has_event THEN
      errs := public._crm_scn_push(errs, 'no_event', NULL, 'goal');
    END IF;
  END IF;

  -- Nœuds.
  nodes := CASE WHEN jsonb_typeof(g->'nodes') = 'object' THEN g->'nodes' END;
  SELECT array_agg(k) INTO ids FROM jsonb_object_keys(COALESCE(nodes, '{}'::jsonb)) k;
  IF nodes IS NULL OR ids IS NULL THEN
    errs := public._crm_scn_push(errs, 'no_nodes', NULL, 'nodes');
    RETURN jsonb_build_object('errors', public._crm_scn_sorted(errs), 'stats', stats);
  END IF;
  IF array_length(ids, 1) > 30 THEN errs := public._crm_scn_push(errs, 'too_many_nodes', NULL, 'nodes'); END IF;

  FOREACH id IN ARRAY ids LOOP
    n := public._crm_scn_node(nodes, to_jsonb(id));
    IF id !~ '^[a-z0-9_-]{1,32}$' THEN errs := public._crm_scn_push(errs, 'bad_node_id', id, NULL); END IF;
    IF n IS NULL OR NOT COALESCE(n->>'type' IN ('wait', 'branch', 'split', 'email', 'sms', 'tag', 'notify', 'instagram_dm', 'end')
                                 AND jsonb_typeof(n->'type') = 'string', false) THEN
      errs := public._crm_scn_push(errs, 'bad_node_type', id, 'type');
      CONTINUE;
    END IF;
    IF n->>'type' = 'instagram_dm' THEN errs := public._crm_scn_push(errs, 'soon', id, 'type'); END IF;
    FOR sx IN SELECT x FROM jsonb_array_elements(public._crm_scn_succ(n)) x LOOP
      IF sx->'id' IS NULL OR jsonb_typeof(sx->'id') = 'null' OR sx->'id' = '""'::jsonb THEN
        errs := public._crm_scn_push(errs, 'missing_next', id, sx->>'field');
      ELSIF public._crm_scn_node(nodes, sx->'id') IS NULL THEN
        errs := public._crm_scn_push(errs, 'bad_ref', id, sx->>'field');
      END IF;
    END LOOP;

    CASE n->>'type'
      WHEN 'wait' THEN
        IF n->>'mode' = 'duration' THEN
          IF NOT public._crm_scn_int(n->'hours', 1, 2160) THEN errs := public._crm_scn_push(errs, 'bad_param', id, 'hours'); END IF;
        ELSIF n->>'mode' = 'until_event' THEN
          IF NOT COALESCE(n->>'anchor' IN ('start', 'end', 'sale_open'), false) THEN errs := public._crm_scn_push(errs, 'bad_param', id, 'anchor'); END IF;
          by_hours := n ? 'hours';
          IF (CASE WHEN by_hours THEN NOT public._crm_scn_int(n->'hours', -720, 720) OR n ? 'days' OR n ? 'at'
                  ELSE NOT public._crm_scn_int(n->'days', -60, 60)
                       OR NOT COALESCE(jsonb_typeof(n->'at') = 'string' AND (n->>'at') ~ hhmm, false) END) THEN
            errs := public._crm_scn_push(errs, 'bad_param', id, 'when');
          ELSIF n->>'anchor' = 'start' AND ((by_hours AND (n->>'hours')::numeric > 0) OR (NOT by_hours AND (n->>'days')::numeric > 0)) THEN
            errs := public._crm_scn_push(errs, 'after_start', id, 'when');
          END IF;
          IF trig_ok AND NOT has_event THEN errs := public._crm_scn_push(errs, 'no_event', id, 'anchor'); END IF;
        ELSIF n->>'mode' = 'until_cond' THEN
          IF NOT public._crm_scn_int(n->'max_hours', 1, 744) THEN errs := public._crm_scn_push(errs, 'bad_param', id, 'max_hours'); END IF;
          IF NOT COALESCE(jsonb_typeof(n->'cond') = 'object' AND (n->'cond') ? 'op', false) THEN
            errs := public._crm_scn_push(errs, 'cond_root_not_group', id, 'cond:');
          ELSE
            errs := public._crm_scn_cond_into(errs, n->'cond', 'step', id, 'cond');
          END IF;
        ELSE
          errs := public._crm_scn_push(errs, 'bad_param', id, 'mode');
        END IF;
      WHEN 'branch' THEN
        IF NOT COALESCE(jsonb_typeof(n->'cond') = 'object' AND (n->'cond') ? 'op', false) THEN
          errs := public._crm_scn_push(errs, 'cond_root_not_group', id, 'cond:');
        ELSE
          errs := public._crm_scn_cond_into(errs, n->'cond', 'step', id, 'cond');
        END IF;
      WHEN 'split' THEN
        ps := CASE WHEN jsonb_typeof(n->'paths') = 'array' THEN n->'paths' END;
        IF ps IS NULL OR jsonb_array_length(ps) NOT BETWEEN 2 AND 4
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(ps) x
                       WHERE jsonb_typeof(x) <> 'object' OR NOT public._crm_scn_int(x->'pct', 1, 99))
           OR (SELECT sum(CASE WHEN jsonb_typeof(x) = 'object' AND jsonb_typeof(x->'pct') = 'number' THEN (x->>'pct')::numeric ELSE 0 END)
                 FROM jsonb_array_elements(ps) x) <> 100 THEN
          errs := public._crm_scn_push(errs, 'bad_split', id, 'paths');
        END IF;
      WHEN 'email' THEN
        IF NOT public._crm_scn_uuid(n->'template_id') THEN errs := public._crm_scn_push(errs, 'bad_param', id, 'template_id'); END IF;
        IF n ? 'subject' AND jsonb_typeof(n->'subject') <> 'null'
           AND NOT COALESCE(jsonb_typeof(n->'subject') = 'string' AND length(btrim(n->>'subject')) <= 140, false) THEN
          errs := public._crm_scn_push(errs, 'bad_param', id, 'subject');
        ELSIF jsonb_typeof(n->'subject') = 'string' AND public._crm_scn_has_url(n->>'subject') THEN
          errs := public._crm_scn_push(errs, 'url_in_text', id, 'subject');
        END IF;
        IF NOT COALESCE(n->>'event' IN ('scenario', 'fixed', 'for_person'), false) THEN
          errs := public._crm_scn_push(errs, 'bad_param', id, 'event');
        ELSIF n->>'event' = 'fixed' AND NOT public._crm_scn_uuid(n->'event_id') THEN
          errs := public._crm_scn_push(errs, 'bad_param', id, 'event_id');
        ELSIF n->>'event' = 'scenario' AND trig_ok AND NOT has_event THEN
          errs := public._crm_scn_push(errs, 'no_event', id, 'event');
        END IF;
      WHEN 'sms' THEN
        IF NOT public._crm_scn_str(n->'body', 1, 480) THEN
          errs := public._crm_scn_push(errs, 'bad_param', id, 'body');
        ELSE
          IF public._crm_scn_has_url(n->>'body') THEN errs := public._crm_scn_push(errs, 'url_in_text', id, 'body'); END IF;
          IF strpos(n->>'body', '{{lien}}') > 0 AND n->>'event' = 'none' THEN errs := public._crm_scn_push(errs, 'link_without_event', id, 'body'); END IF;
        END IF;
        IF NOT COALESCE(n->>'event' IN ('scenario', 'fixed', 'for_person', 'none'), false) THEN
          errs := public._crm_scn_push(errs, 'bad_param', id, 'event');
        ELSIF n->>'event' = 'fixed' AND NOT public._crm_scn_uuid(n->'event_id') THEN
          errs := public._crm_scn_push(errs, 'bad_param', id, 'event_id');
        ELSIF n->>'event' = 'scenario' AND trig_ok AND NOT has_event THEN
          errs := public._crm_scn_push(errs, 'no_event', id, 'event');
        END IF;
      WHEN 'tag' THEN
        IF NOT COALESCE(n->>'op' IN ('add', 'remove'), false) THEN errs := public._crm_scn_push(errs, 'bad_param', id, 'op'); END IF;
        IF NOT public._crm_scn_str(n->'tag', 1, 40) THEN errs := public._crm_scn_push(errs, 'bad_param', id, 'tag'); END IF;
      WHEN 'notify' THEN
        IF NOT public._crm_scn_str(n->'label', 1, 80) THEN errs := public._crm_scn_push(errs, 'bad_param', id, 'label'); END IF;
      ELSE NULL;
    END CASE;

    -- Une feuille de message cite un nœud du bon type ; une feuille de la soirée exige un déclencheur qui en donne une.
    IF n->>'type' IN ('branch', 'wait') AND jsonb_typeof(n->'cond') = 'object' AND (n->'cond') ? 'op' THEN
      IF trig_ok AND NOT has_event AND public._crm_cond_needs_event(n->'cond') THEN
        errs := public._crm_scn_push(errs, 'no_event', id, 'cond');
      END IF;
      FOR ref IN SELECT x FROM jsonb_array_elements(public._crm_cond_node_refs(n->'cond')) x LOOP
        IF COALESCE(public._crm_scn_node(nodes, ref->'node')->>'type', '')
           IS DISTINCT FROM (CASE WHEN ref->>'k' = 'sc_sms_delivered' THEN 'sms' ELSE 'email' END) THEN
          errs := public._crm_scn_push(errs, 'bad_node_ref', id, 'cond:' || (ref->>'k'));
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Structure : départ, cycles, orphelins.
  v_start := CASE WHEN jsonb_typeof(g->'start') = 'string' THEN g->>'start' END;
  IF v_start IS NULL OR public._crm_scn_node(nodes, to_jsonb(v_start)) IS NULL THEN
    errs := public._crm_scn_push(errs, 'bad_start', NULL, 'start');
    RETURN jsonb_build_object('errors', public._crm_scn_sorted(errs), 'stats', stats);
  END IF;
  acc := public._crm_scn_visit(nodes, v_start, jsonb_build_object('color', '{}'::jsonb, 'cyclic', false, 'errors', errs));
  errs := acc->'errors';
  FOREACH id IN ARRAY ids LOOP
    IF NOT (acc->'color') ? id THEN errs := public._crm_scn_push(errs, 'orphan', id, NULL); END IF;
  END LOOP;
  IF (acc->>'cyclic')::boolean THEN
    RETURN jsonb_build_object('errors', public._crm_scn_sorted(errs), 'stats', stats);
  END IF;

  -- Chemins. Repère de départ : le jour J-N est sûr, l'heure non.
  IF tt = 'before_event' AND public._crm_scn_int(t->'days', 1, 60) THEN
    v_init := jsonb_build_object('anchor', 'start', 'frame', 'd', 'lo', -1440 * (t->>'days')::bigint, 'hi', -1440 * (t->>'days')::bigint + 1440);
  ELSIF tt = 'after_event' AND public._crm_scn_int(t->'hours', 1, 720) THEN
    v_init := jsonb_build_object('anchor', 'end', 'frame', 'h', 'lo', 60 * (t->>'hours')::bigint, 'hi', 60 * (t->>'hours')::bigint);
  END IF;
  acc := public._crm_scn_walk(nodes, v_start,
           jsonb_build_object('since', NULL, 'pos', v_init, 'msgs', 0, 'emails', 0, 'sms', 0),
           jsonb_build_object('errors', errs, 'paths', 0, 'max_messages', 0, 'max_emails', 0, 'max_sms', 0, 'stop', false));
  RETURN jsonb_build_object(
    'errors', public._crm_scn_sorted(acc->'errors'),
    'stats', jsonb_build_object('paths', (acc->>'paths')::integer, 'maxMessages', (acc->>'max_messages')::integer,
                                'maxEmails', (acc->>'max_emails')::integer, 'maxSms', (acc->>'max_sms')::integer));
END;
$function$;

-- Ordre canonique : le scénario d'abord, puis nœud, champ, code (octets, COLLATE "C").
CREATE OR REPLACE FUNCTION public._crm_scn_sorted(p_errs jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'node') IS NOT NULL, (x->>'node') COLLATE "C",
                                       (x->>'field') IS NOT NULL, (x->>'field') COLLATE "C", (x->>'code') COLLATE "C"), '[]'::jsonb)
    FROM jsonb_array_elements(p_errs) x;
$function$;

DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    '_crm_scn_int(jsonb, bigint, bigint)', '_crm_scn_str(jsonb, integer, integer)', '_crm_scn_uuid(jsonb)',
    '_crm_scn_has_url(text)', '_crm_scn_push(jsonb, text, text, text)', '_crm_scn_node(jsonb, jsonb)',
    '_crm_scn_succ(jsonb)', '_crm_cond_needs_event(jsonb)', '_crm_cond_node_refs(jsonb)',
    '_crm_scn_cond_into(jsonb, jsonb, text, text, text)', '_crm_scn_walk(jsonb, text, jsonb, jsonb)',
    '_crm_scn_visit(jsonb, text, jsonb)', '_crm_scenario_graph_errors(jsonb)', '_crm_scn_sorted(jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END
$grants$;
