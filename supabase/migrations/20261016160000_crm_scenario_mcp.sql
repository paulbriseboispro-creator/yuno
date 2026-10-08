-- ============================================================================
-- Yuno CRM — Scénarios, lot J5 : le connecteur IA (MCP) (2026-10-16).
-- Plan : docs/designs/CRM_JOURNEYS_PLAN.md.
--
-- Lecture, pour toute connexion dont un espace a Yuno CRM (des agrégats, jamais
-- une personne) : list_scenarios, get_scenario_report, get_scenario_kit.
-- Écriture : des BROUILLONS de scénarios seulement (create_scenario_draft,
-- update_scenario_draft), derrière un droit propre accordé au consentement
-- (mcp_grants.can_scenarios, comme can_draft / can_pages). Une IA ne publie,
-- ne reprend, n'archive ni ne supprime jamais un scénario : crm_scenario_save
-- est la seule écriture, faite au nom de la personne (claims posés par
-- mcp_write), avec ses gardes (crm_scope_writable).
--
-- Fonctions reprises de leur dernière version (= prod, vérifié par
-- scripts/crm-bench/same-as-prod.mjs --before 20261016100000) :
--   mcp_approve_authorization, mcp_session, mcp_my_connections, mcp_write
--     ← 20261009160000_mcp_signup_page_design.sql
--   mcp_call, _mcp_needs_temp(text, text) ← 20261011100000_crm_mcp_reads.sql
-- Seuls changent le droit aux scénarios, leur routage et leurs débits.
-- ============================================================================

SET lock_timeout = '5s';

ALTER TABLE public.mcp_grants ADD COLUMN IF NOT EXISTS can_scenarios boolean NOT NULL DEFAULT false;

-- Un paramètre de plus = DROP + CREATE : une surcharge rendrait ambigu l'appel
-- à arguments nommés des bundles en cache (erreur 300). Les anciens bundles
-- gardent p_scenarios = false.
DROP FUNCTION IF EXISTS public.mcp_approve_authorization(uuid, text[], text, boolean, boolean);

CREATE OR REPLACE FUNCTION public.mcp_approve_authorization(p_request_id uuid, p_spaces text[], p_level text, p_drafts boolean DEFAULT false, p_pages boolean DEFAULT false, p_scenarios boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  r       public.mcp_authorization_requests%ROWTYPE;
  c       public.mcp_clients%ROWTYPE;
  v_grant uuid;
  v_code  text;
  v_bad   text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  -- Une IA ne se connecte jamais pendant un accès assisté : c'est au pro de
  -- décider qui lit ses chiffres, pas au support qui travaille dans son compte.
  IF public.is_support_session() THEN RETURN jsonb_build_object('ok', false, 'error', 'support_session'); END IF;
  IF p_level NOT IN ('analytics', 'customers') THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_level'); END IF;
  IF p_spaces IS NULL OR cardinality(p_spaces) NOT BETWEEN 1 AND 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_space');
  END IF;

  SELECT * INTO r FROM public.mcp_authorization_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'pending' OR r.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  SELECT x INTO v_bad FROM unnest(p_spaces) x
   WHERE NOT EXISTS (SELECT 1 FROM public._mcp_user_spaces(v_uid) s
                      WHERE s.space_key = x AND (p_level = 'analytics' OR s.customers))
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', CASE WHEN p_level = 'customers' THEN 'customers_not_allowed' ELSE 'forbidden_space' END, 'space', v_bad);
  END IF;

  SELECT * INTO c FROM public.mcp_clients WHERE id = r.client_id;

  -- Une nouvelle connexion de la MÊME IA remplace la précédente : jamais deux
  -- accès parallèles oubliés.
  UPDATE public.mcp_grants SET revoked_at = now(), revoked_by = v_uid, revoked_reason = 'replaced'
   WHERE user_id = v_uid AND client_id = r.client_id AND revoked_at IS NULL;
  UPDATE public.mcp_tokens t SET revoked_at = now()
    FROM public.mcp_grants g
   WHERE t.grant_id = g.id AND g.user_id = v_uid AND g.client_id = r.client_id
     AND g.revoked_reason = 'replaced' AND t.revoked_at IS NULL;

  -- Brouillons d'e-mails, pages d'inscription et brouillons de scénarios :
  -- accordés seulement quand l'écran de consentement les a annoncés (il passe
  -- p_drafts, p_pages et p_scenarios à true). Le droit d'écrire dans CHAQUE espace reste celui de la
  -- Console, revérifié à chaque écriture (mcp_write).
  INSERT INTO public.mcp_grants (user_id, client_id, client_name, spaces, level, can_draft, can_pages, can_scenarios)
  VALUES (v_uid, r.client_id, c.client_name, (SELECT array_agg(DISTINCT x) FROM unnest(p_spaces) x), p_level,
          coalesce(p_drafts, false), coalesce(p_pages, false), coalesce(p_scenarios, false))
  RETURNING id INTO v_grant;

  v_code := 'yuno_mcp_ac_' || public._mcp_random(32);
  INSERT INTO public.mcp_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource)
  VALUES (public._mcp_sha256(v_code), v_grant, r.client_id, r.redirect_uri, r.code_challenge, r.resource);

  UPDATE public.mcp_authorization_requests
     SET status = 'approved', user_id = v_uid, grant_id = v_grant, decided_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'grant_id', v_grant, 'redirect_uri', r.redirect_uri,
    'params', jsonb_strip_nulls(jsonb_build_object('code', v_code, 'state', r.state, 'iss', 'https://yunoapp.eu')));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mcp_session(p_access_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  RETURN jsonb_build_object(
    'ok', true, 'grant_id', a.grant_id, 'level', a.level, 'client_name', a.client_name,
    'drafts', coalesce((SELECT g.can_draft FROM public.mcp_grants g WHERE g.id = a.grant_id), false),
    'pages', coalesce((SELECT g.can_pages FROM public.mcp_grants g WHERE g.id = a.grant_id), false),
    'scenarios', coalesce((SELECT g.can_scenarios FROM public.mcp_grants g WHERE g.id = a.grant_id), false),
    'first_name', (SELECT nullif(btrim(first_name), '') FROM public.profiles WHERE id = a.user_id),
    'language', (SELECT preferred_language FROM public.profiles WHERE id = a.user_id),
    'spaces', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'key', s.space_key, 'kind', s.kind, 'name', s.name, 'product', s.product,
        'timezone', s.timezone, 'role', s.role, 'money', s.money,
        'customers', s.customers AND a.level = 'customers',
        'crm', coalesce(public.crm_scope_has_crm(public.crm_scope_key(
                 CASE WHEN s.kind = 'venue' THEN s.space_id END, CASE WHEN s.kind = 'organizer' THEN s.space_id::uuid END)), false)) ORDER BY array_position(a.spaces, s.space_key))
      FROM (SELECT DISTINCT ON (space_key) * FROM public._mcp_user_spaces(a.user_id) ORDER BY space_key, role) s
      WHERE s.space_key = ANY (a.spaces)), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mcp_my_connections()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owned text[];
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  SELECT coalesce(array_agg(space_key), '{}') INTO v_owned
    FROM public._mcp_user_spaces(v_uid) WHERE role IN ('owner', 'founder');
  RETURN jsonb_build_object('ok', true, 'connections', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', g.id, 'client_name', g.client_name, 'level', g.level, 'can_draft', g.can_draft, 'can_pages', g.can_pages, 'can_scenarios', g.can_scenarios,
      'created_at', g.created_at, 'last_used_at', g.last_used_at, 'calls_count', g.calls_count,
      'revoked_at', g.revoked_at, 'revoked_reason', g.revoked_reason,
      'mine', g.user_id = v_uid,
      'drafts_created', (SELECT count(*) FROM public.email_campaigns ec WHERE ec.mcp_grant_id = g.id),
      'pages_created', (SELECT count(*) FROM public.crm_signup_pages sp WHERE sp.mcp_grant_id = g.id),
      'scenarios_created', (SELECT count(*) FROM public.crm_scenarios sc WHERE sc.mcp_grant_id = g.id),
      'person', CASE WHEN g.user_id = v_uid THEN NULL ELSE
                  (SELECT coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.email)
                     FROM public.profiles p WHERE p.id = g.user_id) END,
      'spaces', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', x,
                    'name', coalesce((SELECT v.name FROM public.venues v WHERE 'venue:' || v.id = x),
                                     (SELECT op.display_name FROM public.organizer_profiles op WHERE 'org:' || op.user_id = x), x))), '[]'::jsonb)
                   FROM unnest(g.spaces) x)
    ) ORDER BY g.revoked_at IS NOT NULL, coalesce(g.last_used_at, g.created_at) DESC)
    FROM public.mcp_grants g
    WHERE (g.user_id = v_uid OR g.spaces && v_owned)
      AND (g.revoked_at IS NULL OR g.revoked_at > now() - interval '30 days')), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_needs_temp(p_tool text, p_product text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT public._mcp_needs_temp(p_tool)
      -- Rapport d'un scénario : l'attribution des e-mails passe par une table temporaire.
      OR p_tool = 'get_scenario_report'
      OR (p_product = 'crm' AND p_tool IN ('get_sales_overview', 'get_sales_trends', 'get_purchase_behavior',
            'get_audience_overview', 'get_customer_segments', 'get_web_traffic', 'get_recommendations',
            'list_customers_by_segment', 'get_event_targets'))
$function$;

-- ── Lectures ────────────────────────────────────────────────────────────────
-- Un scénario se désigne par son id, ou par une partie de son nom (le plus
-- récemment modifié gagne).
CREATE OR REPLACE FUNCTION public._mcp_scenario_pick(p_key text, p_ref text)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT s.id FROM public.crm_scenarios s
   WHERE s.scope_key = p_key
     AND (CASE WHEN btrim(coalesce(p_ref, '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               THEN s.id = btrim(p_ref)::uuid
               ELSE length(btrim(coalesce(p_ref, ''))) >= 2 AND s.name ILIKE '%' || replace(replace(btrim(p_ref), '%', ''), '_', '') || '%' END)
   ORDER BY (s.status = 'archived'), s.updated_at DESC
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public._mcp_scenario_tool(p_tool text, p_kind text, p_space_id text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org   uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_key   text := public.crm_scope_key(v_venue, v_org);
  v_id    uuid;
  v_list  jsonb;
  v_det   jsonb;
  v_rep   jsonb;
BEGIN
  IF NOT coalesce(public.crm_scope_allowed(v_venue, v_org), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF NOT coalesce(public.crm_scope_has_crm(v_key), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'crm_not_active');
  END IF;

  IF p_tool = 'list_scenarios' THEN
    v_list := public.crm_scenarios(v_venue, v_org);
    RETURN jsonb_build_object('ok', true,
      'can_edit', v_list->'can_edit',
      'scenarios', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', x->'id', 'name', x->'name', 'status', x->'status', 'state', x->'state', 'trigger', x->'trigger',
                 'version', x->'version', 'has_unpublished_changes', x->'has_changes', 'published_at', x->'published_at',
                 'updated_at', x->'updated_at', 'entered', x->'entered', 'on_their_way', x->'active', 'reached_goal', x->'goal',
                 'not_contacted', x->'holdout', 'not_contacted_reached_goal', x->'goal_holdout', 'holdout_measure', x->'measure',
                 'prepared_by_ai', x->'ai_author'))
          FROM jsonb_array_elements(v_list->'scenarios') x), '[]'::jsonb));

  ELSIF p_tool = 'get_scenario_report' THEN
    v_id := public._mcp_scenario_pick(v_key, p_args->>'scenario');
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'scenario_not_found'); END IF;
    v_det := public.crm_scenario(v_venue, v_org, v_id);
    IF coalesce((v_det->>'version')::integer, 0) > 0 THEN
      v_rep := public.crm_scenario_report(v_venue, v_org, v_id);
    END IF;
    RETURN jsonb_build_object('ok', true,
      'scenario', jsonb_build_object(
        'id', v_det->'id', 'name', v_det->'name', 'status', v_det->'status', 'state', v_det->'state',
        'version', v_det->'version', 'has_unpublished_changes', v_det->'has_changes',
        'published_at', v_det->'published_at', 'prepared_by_ai', v_det->'ai_author',
        'draft', v_det->'draft', 'live', v_det->'live'->'graph',
        'errors', v_det->'errors', 'warnings', v_det->'warnings', 'stats', v_det->'stats'),
      'report', v_rep,
      'url', 'https://crm.yunoapp.eu/crm/automations/scenarios/' || v_id);

  ELSIF p_tool = 'get_scenario_kit' THEN
    RETURN jsonb_build_object('ok', true,
      'can_edit', coalesce(public.crm_scope_writable(v_venue, v_org), false),
      'email_templates', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'subject', t.subject) ORDER BY t.updated_at DESC)
          FROM (SELECT * FROM public.email_campaign_templates t
                 WHERE t.venue_id IS NOT DISTINCT FROM v_venue AND t.organizer_user_id IS NOT DISTINCT FROM v_org
                 ORDER BY t.updated_at DESC LIMIT 60) t), '[]'::jsonb),
      'segments', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) ORDER BY g.name)
          FROM public.crm_segments g WHERE g.scope_key = v_key), '[]'::jsonb),
      'signup_pages', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'status', p.status, 'has_night', p.event_id IS NOT NULL) ORDER BY p.updated_at DESC)
          FROM public.crm_signup_pages p
         WHERE p.venue_id IS NOT DISTINCT FROM v_venue AND p.organizer_user_id IS NOT DISTINCT FROM v_org), '[]'::jsonb),
      'upcoming_nights', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at) ORDER BY e.start_at)
          FROM (SELECT e.id, e.title, e.start_at FROM public.events e
                 WHERE e.external_source IS NOT NULL AND e.cancelled_at IS NULL AND e.start_at > now()
                   AND ((v_venue IS NOT NULL AND e.venue_id = v_venue) OR (v_org IS NOT NULL AND e.organizer_user_id = v_org))
                 ORDER BY e.start_at LIMIT 12) e), '[]'::jsonb),
      -- Familles « ce qui fait venir » confirmées sur le compte : seules elles
      -- retiennent quelqu'un dans une condition sc_family.
      'confirmed_families', coalesce((
        SELECT jsonb_agg(f) FROM unnest(ARRAY['artist','genre','format','slot','weekday','place','series','early','launch',
                                              'last_minute','door','group','table','discovery','passing','invited','group_first',
                                              'brought','channel']) f
         WHERE public._crm_family_confirmed(v_key, f)), '[]'::jsonb),
      'chances_available', coalesce((SELECT m.status = 'ok' FROM public.crm_score_model m WHERE m.scope_key = v_key), false),
      'sms_sender_ready', coalesce((public.get_sms_sender_readiness(v_venue, v_org)->>'identity_ok')::boolean, false),
      'holdout_pct', public.crm_holdout_pct(v_key),
      'yunits', jsonb_build_object('email', greatest(1, coalesce((public.crm_pricing_config()->'rates'->>'email')::integer, 1)),
                                   'sms', public.crm_sms_rates()),
      'console_url', 'https://crm.yunoapp.eu/crm/automations?tab=scenarios');
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
END;
$function$;

-- ── Écriture : un brouillon, jamais plus ────────────────────────────────────
-- create_scenario_draft : name, graph. update_scenario_draft : scenario (id),
-- name et / ou graph (le graphe entier, comme l'éditeur l'enregistre). Un
-- scénario en ligne garde sa version en ligne : le brouillon modifié attend
-- que le pro publie. Les claims de la personne sont posés par mcp_write.
CREATE OR REPLACE FUNCTION public._mcp_scenario_write(p_tool text, p_kind text, p_space_id text, p_args jsonb,
                                                     p_uid uuid, p_grant uuid, p_client_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_venue text := CASE WHEN p_kind = 'venue' THEN p_space_id END;
  v_org   uuid := CASE WHEN p_kind = 'organizer' THEN p_space_id::uuid END;
  v_key   text := public.crm_scope_key(v_venue, v_org);
  v_graph jsonb := p_args->'graph';
  v_name  text := nullif(btrim(coalesce(p_args->>'name', '')), '');
  v_id    uuid;
  v_cur   public.crm_scenarios%ROWTYPE;
  v_saved jsonb;
  v_det   jsonb;
BEGIN
  IF NOT coalesce(public.crm_scope_has_crm(v_key), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'crm_not_active');
  END IF;
  IF NOT public._mcp_space_can_draft(p_uid, v_venue, v_org, 'crm') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'write_forbidden');
  END IF;
  IF v_name IS NOT NULL AND length(v_name) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_name');
  END IF;
  IF v_graph IS NOT NULL AND (jsonb_typeof(v_graph) <> 'object' OR v_graph->'v' IS DISTINCT FROM '1'::jsonb) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_graph');
  END IF;
  IF v_graph IS NOT NULL AND length(v_graph::text) > 65536 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'graph_too_large');
  END IF;

  IF p_tool = 'create_scenario_draft' THEN
    IF v_graph IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'graph_required'); END IF;
    v_saved := public.crm_scenario_save(v_venue, v_org, NULL, coalesce(v_name, 'Scénario'), v_graph, NULL, NULL,
                                        CASE WHEN p_args->>'template' ~ '^[a-z0-9_]{1,40}$' THEN p_args->>'template' END);
    v_id := (v_saved->>'id')::uuid;
    UPDATE public.crm_scenarios SET mcp_grant_id = p_grant, ai_author = left(p_client_name, 80), ai_updated_at = now()
     WHERE id = v_id;
  ELSE
    v_id := public._mcp_scenario_pick(v_key, p_args->>'scenario');
    IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'scenario_not_found'); END IF;
    SELECT * INTO v_cur FROM public.crm_scenarios WHERE id = v_id;
    IF v_cur.status = 'archived' THEN RETURN jsonb_build_object('ok', false, 'error', 'scenario_archived'); END IF;
    IF v_graph IS NULL AND v_name IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'nothing_to_change'); END IF;
    v_saved := public.crm_scenario_save(v_venue, v_org, v_id, v_name, coalesce(v_graph, v_cur.draft), NULL);
    UPDATE public.crm_scenarios SET ai_author = left(p_client_name, 80), ai_updated_at = now() WHERE id = v_id;
  END IF;

  v_det := public.crm_scenario(v_venue, v_org, v_id);
  RETURN jsonb_build_object('ok', true,
    'scenario_id', v_id, 'name', v_det->'name', 'status', v_det->'status', 'version', v_det->'version',
    'has_unpublished_changes', v_det->'has_changes',
    'errors', v_det->'errors', 'warnings', v_det->'warnings', 'stats', v_det->'stats',
    'url', 'https://crm.yunoapp.eu/crm/automations/scenarios/' || v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mcp_call(p_access_hash text, p_tool text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a        record;
  s        record;
  v_args   jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_space  text;
  v_call   bigint;
  v_res    jsonb;
  v_min    integer;
  v_day    integer;
  v_cust   integer;
  v_has_space boolean;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;

  IF p_tool IS NULL OR p_tool !~ '^[a-z_]{3,40}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END IF;

  -- Espace : celui demandé, sinon celui où la personne a le plus de droits
  -- (propriétaire / fondateur, puis admin, puis manager), Yuno Suite avant
  -- Yuno CRM, club avant organisation, puis par nom. `a.spaces` est trié par
  -- clé : son premier élément n'avait aucun sens pour la personne.
  v_space := nullif(btrim(coalesce(v_args->>'space', '')), '');
  -- Une IA passe parfois le NOM de l'espace (« Organisateur Démo ») au lieu de
  -- sa clé : on le reconnaît plutôt que de répondre « espace hors connexion ».
  IF v_space IS NOT NULL AND NOT (v_space = ANY (a.spaces)) THEN
    SELECT u.space_key INTO v_space
      FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces) AND lower(u.name) = lower(v_space)
     LIMIT 1;
    v_space := coalesce(v_space, nullif(btrim(v_args->>'space'), ''));
  END IF;
  IF v_space IS NULL THEN
    SELECT u.space_key INTO v_space
      FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces)
     ORDER BY CASE WHEN u.role IN ('owner', 'founder') THEN 0 WHEN u.role = 'admin' THEN 1 WHEN u.role = 'manager' THEN 2 ELSE 3 END,
              (u.product = 'crm'), (u.kind <> 'venue'), u.name
     LIMIT 1;
    v_space := coalesce(v_space, a.spaces[1]);
  END IF;
  SELECT * INTO s FROM public._mcp_user_spaces(a.user_id) u
   WHERE u.space_key = v_space AND v_space = ANY (a.spaces)
   ORDER BY (u.role = 'owner' OR u.role = 'founder') DESC LIMIT 1;
  v_has_space := FOUND;

  -- Débits : 60 appels / minute, 3 000 / jour, 100 lectures de fiches / jour.
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute'),
         count(*),
         count(*) FILTER (WHERE public._mcp_customer_tool(tool) AND status = 'ok')
    INTO v_min, v_day, v_cust
    FROM public.mcp_tool_calls
   WHERE grant_id = a.grant_id AND created_at > now() - interval '1 day';

  IF NOT v_has_space THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'denied', 'space_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'space_not_allowed',
      'spaces', to_jsonb(a.spaces));
  END IF;

  IF v_min >= 60 OR v_day >= 3000 OR (public._mcp_customer_tool(p_tool) AND v_cust >= 100) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'rate_limited', NULL);
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  IF public._mcp_customer_tool(p_tool) AND NOT (a.level = 'customers' AND s.customers) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_args - 'space', 'denied', 'customers_level_required');
    RETURN jsonb_build_object('ok', false, 'error', 'customers_level_required');
  END IF;

  INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args)
  VALUES (a.grant_id, a.user_id, p_tool, v_space,
          CASE WHEN length((v_args - 'space')::text) <= 2000 THEN v_args - 'space' ELSE jsonb_build_object('truncated', true) END)
  RETURNING id INTO v_call;
  UPDATE public.mcp_grants SET last_used_at = now(), calls_count = calls_count + 1 WHERE id = a.grant_id;

  BEGIN
    -- La personne, et elle seule : auth.uid(), auth.role(), auth.jwt() la
    -- désignent pour toutes les RPC appelées ensuite. Les deux formes de claims
    -- sont posées (la forme « claim.x » est lue en priorité par auth.uid()).
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', a.user_id, 'role', 'authenticated', 'aud', 'authenticated', 'yuno_mcp_grant', a.grant_id)::text, true);
    PERFORM set_config('request.jwt.claim.sub', a.user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.session_id', '', true);
    IF NOT public._mcp_needs_temp(p_tool, s.product) THEN
      PERFORM set_config('transaction_read_only', 'on', true);
    END IF;

    IF p_tool IN ('get_email_design_kit', 'list_email_audiences', 'get_email_draft', 'list_email_images') THEN
      v_res := public._mcp_email_tool(p_tool, s.kind, s.space_id, s.product, s.timezone, v_args, a.user_id);
    ELSIF p_tool IN ('get_signup_page_kit', 'get_signup_page') THEN
      v_res := public._mcp_signup_tool(p_tool, s.kind, s.space_id, s.product, s.timezone, v_args, a.user_id);
    ELSIF p_tool IN ('list_scenarios', 'get_scenario_report', 'get_scenario_kit') THEN
      v_res := public._mcp_scenario_tool(p_tool, s.kind, s.space_id, v_args);
    ELSE
      v_res := public._mcp_tool(p_tool, s.kind, s.space_id, s.product, s.timezone, v_args, a.level);
    END IF;
    v_res := public._mcp_redact(v_res, NOT public._mcp_customer_tool(p_tool));
  EXCEPTION WHEN others THEN
    -- Sous-transaction annulée : claims et lecture seule tombent avec elle, on
    -- peut noter l'échec.
    UPDATE public.mcp_tool_calls SET status = 'error', error = left(SQLSTATE || ' ' || SQLERRM, 300) WHERE id = v_call;
    RETURN jsonb_build_object('ok', false, 'error', 'internal', 'call_id', v_call,
      'message', CASE WHEN SQLSTATE IN ('22P02', '22007', '22008', '22023') THEN 'invalid argument' ELSE 'query failed' END);
  END;

  RETURN jsonb_build_object('ok', coalesce((v_res->>'ok')::boolean, true), 'call_id', v_call,
    'space', jsonb_build_object('key', s.space_key, 'name', s.name, 'kind', s.kind, 'product', s.product),
    'result', v_res);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mcp_write(p_access_hash text, p_tool text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a          record;
  s          record;
  v_args     jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_space    text;
  v_call     bigint;
  v_res      jsonb;
  v_min      integer;
  v_day      integer;
  v_creates  integer;
  v_updates  integer;
  v_images   integer;
  v_can      boolean;
  v_pages    boolean;
  v_page_creates integer;
  v_page_updates integer;
  v_is_page  boolean := p_tool IN ('create_signup_page', 'update_signup_page');
  v_is_scn   boolean := p_tool IN ('create_scenario_draft', 'update_scenario_draft');
  v_scn      boolean;
  v_scn_creates integer;
  v_scn_updates integer;
  v_has_space boolean;
  v_summary  jsonb;
BEGIN
  SELECT * INTO a FROM public._mcp_access(p_access_hash);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthorized'); END IF;
  IF p_tool NOT IN ('create_email_draft', 'update_email_draft', 'add_email_image', 'create_signup_page', 'update_signup_page',
                    'create_scenario_draft', 'update_scenario_draft') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_tool');
  END IF;

  -- Même choix d'espace que mcp_call.
  v_space := nullif(btrim(coalesce(v_args->>'space', '')), '');
  IF v_space IS NOT NULL AND NOT (v_space = ANY (a.spaces)) THEN
    SELECT u.space_key INTO v_space FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces) AND lower(u.name) = lower(v_space) LIMIT 1;
    v_space := coalesce(v_space, nullif(btrim(v_args->>'space'), ''));
  END IF;
  IF v_space IS NULL THEN
    SELECT u.space_key INTO v_space FROM public._mcp_user_spaces(a.user_id) u
     WHERE u.space_key = ANY (a.spaces)
     ORDER BY CASE WHEN u.role IN ('owner', 'founder') THEN 0 WHEN u.role = 'admin' THEN 1 WHEN u.role = 'manager' THEN 2 ELSE 3 END,
              (u.product = 'crm'), (u.kind <> 'venue'), u.name
     LIMIT 1;
    v_space := coalesce(v_space, a.spaces[1]);
  END IF;
  SELECT * INTO s FROM public._mcp_user_spaces(a.user_id) u
   WHERE u.space_key = v_space AND v_space = ANY (a.spaces)
   ORDER BY (u.role = 'owner' OR u.role = 'founder') DESC LIMIT 1;
  v_has_space := FOUND;

  -- Journal : un résumé, jamais le HTML entier.
  v_summary := jsonb_strip_nulls(jsonb_build_object(
    'draft_id', v_args->>'draft_id', 'product', v_args->>'product', 'event', left(v_args->>'event', 120),
    'name', left(v_args->>'name', 120), 'subject', left(v_args->>'subject', 160),
    'audience', CASE WHEN jsonb_typeof(v_args->'audience') = 'array' THEN v_args->'audience' END,
    'sections', CASE WHEN jsonb_typeof(v_args->'blocks') = 'array' THEN jsonb_array_length(v_args->'blocks') END,
    'bytes', CASE WHEN v_args ? 'blocks' THEN length((v_args->'blocks')::text) END,
    'language', v_args->>'language', 'image', CASE WHEN p_tool = 'add_email_image' THEN left(coalesce(v_args->>'name', v_args->>'source'), 80) END,
    'page_id', v_args->>'page_id', 'kind', v_args->>'kind', 'title', left(v_args->>'title', 120),
    'design', CASE WHEN v_args ? 'custom_design' THEN coalesce(jsonb_typeof(v_args->'custom_design'), 'null') END,
    'page_sections', CASE WHEN jsonb_typeof(v_args->'custom_design'->'sections') = 'array' THEN jsonb_array_length(v_args->'custom_design'->'sections') END,
    'page_bytes', CASE WHEN v_args ? 'custom_design' THEN length((v_args->'custom_design')::text) END,
    'scenario_id', v_args->>'scenario_id',
    'scenario_nodes', CASE WHEN jsonb_typeof(v_args->'graph'->'nodes') = 'object' THEN (SELECT count(*) FROM jsonb_object_keys(v_args->'graph'->'nodes')) END,
    'scenario_trigger', left(v_args->'graph'->'trigger'->>'type', 40)));

  -- Chaque famille d'écriture a SA permission, accordée par un écran de
  -- consentement qui l'annonce : brouillons d'e-mails (can_draft), pages
  -- d'inscription (can_pages). Une image sert aux deux.
  SELECT g.can_draft, g.can_pages, g.can_scenarios INTO v_can, v_pages, v_scn FROM public.mcp_grants g WHERE g.id = a.grant_id;
  -- Brouillons de scénarios (lot J5 des Scénarios) : leur propre permission.
  IF v_is_scn AND NOT coalesce(v_scn, false) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'denied', 'scenarios_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'scenarios_not_allowed');
  END IF;
  IF v_is_page AND NOT coalesce(v_pages, false) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'denied', 'pages_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'pages_not_allowed');
  END IF;
  IF NOT v_is_page AND NOT v_is_scn AND NOT (coalesce(v_can, false) OR (p_tool = 'add_email_image' AND coalesce(v_pages, false))) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'denied', 'drafts_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'drafts_not_allowed');
  END IF;
  IF NOT v_has_space THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'denied', 'space_not_allowed');
    RETURN jsonb_build_object('ok', false, 'error', 'space_not_allowed', 'spaces', to_jsonb(a.spaces));
  END IF;

  -- Débits : 60 appels / minute et 3 000 / jour (comme mcp_call), 30
  -- brouillons créés et 200 modifications par jour et par connexion ; 20
  -- pages d'inscription créées et 200 modifications ; 20 brouillons de
  -- scénarios créés et 200 modifications.
  SELECT count(*) FILTER (WHERE created_at > now() - interval '1 minute'),
         count(*),
         count(*) FILTER (WHERE tool = 'create_email_draft' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'update_email_draft' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'add_email_image' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'create_signup_page' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'update_signup_page' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'create_scenario_draft' AND status = 'ok'),
         count(*) FILTER (WHERE tool = 'update_scenario_draft' AND status = 'ok')
    INTO v_min, v_day, v_creates, v_updates, v_images, v_page_creates, v_page_updates, v_scn_creates, v_scn_updates
    FROM public.mcp_tool_calls
   WHERE grant_id = a.grant_id AND created_at > now() - interval '1 day';
  IF v_min >= 60 OR v_day >= 3000
     OR (p_tool = 'create_email_draft' AND v_creates >= 30)
     OR (p_tool = 'update_email_draft' AND v_updates >= 200)
     OR (p_tool = 'add_email_image' AND v_images >= 60)
     OR (p_tool = 'create_signup_page' AND v_page_creates >= 20)
     OR (p_tool = 'update_signup_page' AND v_page_updates >= 200)
     OR (p_tool = 'create_scenario_draft' AND v_scn_creates >= 20)
     OR (p_tool = 'update_scenario_draft' AND v_scn_updates >= 200) THEN
    INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args, status, error)
    VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary, 'rate_limited', NULL);
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  INSERT INTO public.mcp_tool_calls (grant_id, user_id, tool, space_key, args)
  VALUES (a.grant_id, a.user_id, p_tool, v_space, v_summary)
  RETURNING id INTO v_call;
  UPDATE public.mcp_grants SET last_used_at = now(), calls_count = calls_count + 1 WHERE id = a.grant_id;

  BEGIN
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'sub', a.user_id, 'role', 'authenticated', 'aud', 'authenticated', 'yuno_mcp_grant', a.grant_id)::text, true);
    PERFORM set_config('request.jwt.claim.sub', a.user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.session_id', '', true);
    v_res := CASE
      WHEN p_tool = 'add_email_image'
        THEN public._mcp_email_image_add(s.kind, s.space_id, s.product, v_args, a.user_id, a.grant_id)
      WHEN v_is_page
        THEN public._mcp_signup_write(p_tool, s.kind, s.space_id, s.product, v_args, a.user_id, a.grant_id, a.client_name)
      WHEN v_is_scn
        THEN public._mcp_scenario_write(p_tool, s.kind, s.space_id, v_args, a.user_id, a.grant_id, a.client_name)
      ELSE public._mcp_email_write(p_tool, s.kind, s.space_id, s.product, v_args, a.user_id, a.grant_id, a.client_name) END;
  EXCEPTION WHEN others THEN
    UPDATE public.mcp_tool_calls SET status = 'error', error = left(SQLSTATE || ' ' || SQLERRM, 300) WHERE id = v_call;
    RETURN jsonb_build_object('ok', false, 'error',
      CASE WHEN SQLERRM LIKE '%crm_plan_ab_resend%' THEN 'ab_not_in_plan'
           WHEN SQLERRM LIKE '%crm_send_frozen%' OR SQLERRM LIKE '%sending_frozen%' THEN 'sending_frozen'
           WHEN SQLSTATE IN ('22P02', '22007', '22008', '22023') THEN 'invalid_args'
           ELSE 'internal' END,
      'call_id', v_call);
  END;

  IF NOT coalesce((v_res->>'ok')::boolean, false) THEN
    UPDATE public.mcp_tool_calls SET status = 'error', error = left(coalesce(v_res->>'error', 'error'), 300) WHERE id = v_call;
  END IF;
  RETURN jsonb_build_object('ok', coalesce((v_res->>'ok')::boolean, false), 'call_id', v_call,
    'space', jsonb_build_object('key', s.space_key, 'name', s.name, 'kind', s.kind, 'product', s.product),
    'result', v_res);
END;
$function$;

-- ── Droits ─────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.mcp_approve_authorization(uuid, text[], text, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_approve_authorization(uuid, text[], text, boolean, boolean, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_session(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_session(text) TO service_role;
REVOKE ALL ON FUNCTION public.mcp_my_connections() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_my_connections() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.mcp_call(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_call(text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.mcp_write(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_write(text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public._mcp_needs_temp(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_scenario_pick(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_scenario_tool(text, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._mcp_scenario_write(text, text, text, jsonb, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
