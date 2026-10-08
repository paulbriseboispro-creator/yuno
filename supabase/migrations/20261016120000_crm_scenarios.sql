-- ============================================================================
-- Yuno CRM — Scénarios, lot J2 : tables, versions, RPC, gardes (2026-10-16).
-- Plan : docs/designs/CRM_JOURNEYS_PLAN.md (§ 4-5). Décisions de Paul (08/10) :
-- nom « Scénarios » ; les recettes restent, un scénario copié d'une recette
-- l'éteint à la publication (jamais les deux sur un même sujet) ; publier =
-- les rôles qui allument une recette (crm_scope_writable), JAMAIS en accès
-- assisté.
--
--   crm_scenarios          un scénario : nom, état, brouillon (graphe), version
--                          en ligne, recette copiée (source_kind)
--   crm_scenario_versions  versions IMMUABLES ; les personnes en route finissent
--                          la version qu'elles ont commencée
--   crm_scenario_runs      une inscription (personne × scénario × déclencheur)
--   crm_scenario_steps     registre unique (inscription, nœud, passage)
--   crm_scenario_messages  la campagne enfant d'un nœud (version, nœud, soirée)
--
-- RLS sans policy partout : tout passe par les RPC (lecture crm_scope_allowed,
-- écriture crm_scope_writable, montants derrière _crm_money_gate). Le moteur
-- (lot J3) écrit les inscriptions et le registre.
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_scenarios (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key         text NOT NULL,
  venue_id          text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  -- draft : jamais publié ; active ; paused (par le pro) ; archived.
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  -- Le graphe en cours d'écriture (toujours présent : à la publication il est figé en version).
  draft             jsonb NOT NULL,
  draft_updated_at  timestamptz NOT NULL DEFAULT now(),
  live_version_id   uuid,
  version_no        integer NOT NULL DEFAULT 0,
  -- La recette copiée par « Personnaliser » (CRM_AUTO_KINDS) : publier l'éteint.
  source_kind       text CHECK (source_kind IS NULL OR source_kind IN (
                      'new_event', 'last_call', 'click_no_buy', 'post_event_thanks', 'post_event_missed',
                      'first_return', 'regular_lapse', 'win_back')),
  -- Modèle de départ (lot J4), pour les chiffres « par type de modèle ».
  template          text CHECK (template IS NULL OR template ~ '^[a-z0-9_]{1,40}$'),
  -- État du déclencheur tenu par le moteur (segment : base posée ; inscription
  -- manuelle : faite).
  trigger_state     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Brouillon préparé par une IA connectée (MCP, lot J5) : la connexion et le
  -- nom de l'IA (« Préparé par Claude » à l'écran). L'IA ne publie jamais.
  mcp_grant_id      uuid REFERENCES public.mcp_grants(id) ON DELETE SET NULL,
  ai_author         text,
  ai_updated_at     timestamptz,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  published_at      timestamptz,
  paused_at         timestamptz,
  archived_at       timestamptz,
  CHECK ((venue_id IS NULL) <> (organizer_user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS crm_scenarios_scope ON public.crm_scenarios (scope_key, status);
ALTER TABLE public.crm_scenarios ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_scenario_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id  uuid NOT NULL REFERENCES public.crm_scenarios(id) ON DELETE CASCADE,
  scope_key    text NOT NULL,
  version      integer NOT NULL,
  graph        jsonb NOT NULL,
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_by uuid,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, version)
);
ALTER TABLE public.crm_scenario_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.crm_scenarios DROP CONSTRAINT IF EXISTS crm_scenarios_live_version_fk;
ALTER TABLE public.crm_scenarios ADD CONSTRAINT crm_scenarios_live_version_fk
  FOREIGN KEY (live_version_id) REFERENCES public.crm_scenario_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.crm_scenario_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id   uuid NOT NULL REFERENCES public.crm_scenarios(id) ON DELETE CASCADE,
  version_id    uuid NOT NULL REFERENCES public.crm_scenario_versions(id) ON DELETE CASCADE,
  scope_key     text NOT NULL,
  email         text NOT NULL CHECK (email = lower(email)),
  -- La soirée du scénario (déclencheur), NULL pour un déclencheur sans soirée.
  event_id      uuid,
  -- Règle de retour : 'once', l'id de la soirée, ou la période (« tous les N jours »).
  trigger_key   text NOT NULL,
  entered_at    timestamptz NOT NULL DEFAULT now(),
  -- active ; done (fin du chemin) ; exited (objectif ou sortie forcée).
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'exited')),
  exit_reason   text,
  node_id       text,
  node_since    timestamptz NOT NULL DEFAULT now(),
  -- Prochain passage du moteur pour cette personne.
  due_at        timestamptz NOT NULL DEFAULT now(),
  holdout       boolean NOT NULL DEFAULT false,
  last_message_at timestamptz,
  goal_at       timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, email, trigger_key)
);
CREATE INDEX IF NOT EXISTS crm_scenario_runs_due ON public.crm_scenario_runs (scope_key, due_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS crm_scenario_runs_email ON public.crm_scenario_runs (scope_key, email);
ALTER TABLE public.crm_scenario_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_scenario_steps (
  run_id         uuid NOT NULL REFERENCES public.crm_scenario_runs(id) ON DELETE CASCADE,
  node_id        text NOT NULL,
  pass           integer NOT NULL DEFAULT 1,
  scenario_id    uuid NOT NULL REFERENCES public.crm_scenarios(id) ON DELETE CASCADE,
  version_id     uuid NOT NULL,
  -- passed (nœud franchi) ; sent (message mis en file) ; would_send (démo) ;
  -- holdout (témoin : rien reçu) ; held (reporté, raison) ; expired (raison).
  status         text NOT NULL CHECK (status IN ('passed', 'sent', 'would_send', 'holdout', 'held', 'expired')),
  reason         text,
  campaign_id    uuid,
  sms_campaign_id uuid,
  due_at         timestamptz,
  window_end     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  done_at        timestamptz,
  PRIMARY KEY (run_id, node_id, pass)
);
CREATE INDEX IF NOT EXISTS crm_scenario_steps_scenario ON public.crm_scenario_steps (scenario_id, version_id, node_id);
ALTER TABLE public.crm_scenario_steps ENABLE ROW LEVEL SECURITY;

-- Les campagnes d'un nœud : UNE campagne enfant e-mail par (version, nœud,
-- soirée), remplie au fil des passages ; une campagne SMS programmée par
-- passage du moteur (un SMS programmé part une fois).
CREATE TABLE IF NOT EXISTS public.crm_scenario_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id      uuid NOT NULL REFERENCES public.crm_scenario_versions(id) ON DELETE CASCADE,
  node_id         text NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email', 'sms')),
  -- La soirée liée au message ('00000000-…' = aucune).
  event_key       uuid NOT NULL,
  campaign_id     uuid REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
  sms_campaign_id uuid REFERENCES public.sms_campaigns(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_scenario_messages_email ON public.crm_scenario_messages (version_id, node_id, event_key) WHERE channel = 'email';
CREATE INDEX IF NOT EXISTS crm_scenario_messages_campaign ON public.crm_scenario_messages (campaign_id);
ALTER TABLE public.crm_scenario_messages ENABLE ROW LEVEL SECURITY;

-- Une campagne enfant de scénario (le moteur, lot J3) : hors des listes Campagnes.
ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_child_kind_check;
ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_child_kind_check
  CHECK (child_kind IS NULL OR child_kind IN ('followup', 'resend', 'automation', 'signup', 'scenario'));

-- ── 2. Gardes de table ───────────────────────────────────────────────────────
-- Une version publiée ne change plus (les personnes en route la finissent).
CREATE OR REPLACE FUNCTION public.guard_crm_scenario_version_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.graph IS DISTINCT FROM OLD.graph OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.scenario_id IS DISTINCT FROM OLD.scenario_id THEN
    RAISE EXCEPTION 'scenario_version_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_crm_scenario_version_immutable ON public.crm_scenario_versions;
CREATE TRIGGER trg_crm_scenario_version_immutable BEFORE UPDATE ON public.crm_scenario_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_scenario_version_immutable();

-- « Jamais les deux sur un même sujet » (décision 2) : une recette ne se
-- rallume pas tant qu'un scénario publié qui la copie n'est pas archivé.
-- DEFINER (il lit crm_scenarios, sans policy) ; il ne discrimine pas sur
-- current_user, il ne se désactive donc pas lui-même.
CREATE OR REPLACE FUNCTION public.guard_recipe_vs_scenario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.enabled AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.enabled, false))
     AND (NEW.venue_id IS NOT NULL OR NEW.organizer_user_id IS NOT NULL)
     AND EXISTS (
       SELECT 1 FROM public.crm_scenarios s
        WHERE s.source_kind = NEW.kind AND s.status IN ('active', 'paused')
          AND s.venue_id IS NOT DISTINCT FROM NEW.venue_id
          AND s.organizer_user_id IS NOT DISTINCT FROM NEW.organizer_user_id) THEN
    RAISE EXCEPTION 'scenario_covers_recipe' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_recipe_vs_scenario() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_recipe_vs_scenario ON public.email_automations;
CREATE TRIGGER trg_guard_recipe_vs_scenario BEFORE INSERT OR UPDATE OF enabled ON public.email_automations
  FOR EACH ROW EXECUTE FUNCTION public.guard_recipe_vs_scenario();

-- ── 3. Ce que la base doit confirmer (publication) ──────────────────────────
-- La soirée du scénario est-elle lue par le graphe ?
CREATE OR REPLACE FUNCTION public._crm_scenario_uses_event(p_graph jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT COALESCE(p_graph->'entry'->'reentry'->>'mode', '') = 'per_event'
      OR COALESCE(p_graph->'goal'->>'type', '') IN ('bought_event', 'entered')
      OR public._crm_cond_needs_event(p_graph->'entry'->'filter')
      OR EXISTS (
        SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(p_graph->'nodes') = 'object' THEN p_graph->'nodes' ELSE '{}'::jsonb END) n(id, v)
         WHERE (n.v->>'type' IN ('email', 'sms') AND n.v->>'event' = 'scenario')
            OR (n.v->>'type' = 'wait' AND n.v->>'mode' = 'until_event')
            OR (n.v->>'type' IN ('branch', 'wait') AND public._crm_cond_needs_event(n.v->'cond')));
$function$;

-- Les feuilles `segment` d'une condition (id cités).
CREATE OR REPLACE FUNCTION public._crm_cond_segment_ids(p_tree jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  i integer;
  v_out text[] := '{}';
BEGIN
  IF p_tree IS NULL OR jsonb_typeof(p_tree) <> 'object' THEN RETURN v_out; END IF;
  IF p_tree ? 'op' THEN
    IF jsonb_typeof(p_tree->'items') IS DISTINCT FROM 'array' THEN RETURN v_out; END IF;
    FOR i IN 0 .. jsonb_array_length(p_tree->'items') - 1 LOOP
      v_out := v_out || public._crm_cond_segment_ids(p_tree->'items'->i);
    END LOOP;
    RETURN v_out;
  END IF;
  IF p_tree->>'k' = 'segment' AND jsonb_typeof(p_tree->'v') = 'string' THEN RETURN ARRAY[lower(p_tree->>'v')]; END IF;
  RETURN v_out;
END;
$function$;

-- Les familles citées par `sc_family`, et l'usage de `sc_chance`.
CREATE OR REPLACE FUNCTION public._crm_cond_leaf_values(p_tree jsonb, p_k text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  i integer;
  v_out text[] := '{}';
BEGIN
  IF p_tree IS NULL OR jsonb_typeof(p_tree) <> 'object' THEN RETURN v_out; END IF;
  IF p_tree ? 'op' THEN
    IF jsonb_typeof(p_tree->'items') IS DISTINCT FROM 'array' THEN RETURN v_out; END IF;
    FOR i IN 0 .. jsonb_array_length(p_tree->'items') - 1 LOOP
      v_out := v_out || public._crm_cond_leaf_values(p_tree->'items'->i, p_k);
    END LOOP;
    RETURN v_out;
  END IF;
  IF p_tree->>'k' = p_k THEN
    RETURN ARRAY[CASE WHEN jsonb_typeof(p_tree->'v') = 'string' THEN p_tree->>'v' ELSE (p_tree->'v')::text END];
  END IF;
  RETURN v_out;
END;
$function$;

-- Contrôles qui lisent la base : {"errors": [...], "warnings": [...]}, même
-- forme que _crm_scenario_graph_errors ({code, node, field}).
CREATE OR REPLACE FUNCTION public._crm_scenario_content(p_venue_id text, p_organizer_user_id uuid, p_graph jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key   text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  errs    jsonb := '[]'::jsonb;
  warns   jsonb := '[]'::jsonb;
  t       jsonb := p_graph->'trigger';
  n       record;
  v_seg   text;
  v_fam   text;
  v_page_event uuid;
  v_sms   boolean := false;
  v_ready boolean;
  v_score text;
BEGIN
  -- Déclencheur : segment et page du compte.
  IF t->>'type' IN ('segment_joined', 'manual_segment') AND public._crm_scn_uuid(t->'segment_id')
     AND NOT EXISTS (SELECT 1 FROM public.crm_segments s WHERE s.id = (t->>'segment_id')::uuid AND s.scope_key = v_key) THEN
    errs := public._crm_scn_push(errs, 'unknown_segment', NULL, 'trigger.segment_id');
  END IF;
  IF t->>'type' = 'signup_confirmed' AND public._crm_scn_uuid(t->'page_id') THEN
    SELECT pg.event_id INTO v_page_event FROM public.crm_signup_pages pg
     WHERE pg.id = (t->>'page_id')::uuid
       AND pg.venue_id IS NOT DISTINCT FROM p_venue_id AND pg.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
    IF NOT FOUND THEN
      errs := public._crm_scn_push(errs, 'unknown_page', NULL, 'trigger.page_id');
    ELSIF v_page_event IS NULL AND public._crm_scenario_uses_event(p_graph) THEN
      errs := public._crm_scn_push(errs, 'page_without_event', NULL, 'trigger.page_id');
    END IF;
  END IF;

  -- Segments cités par le filtre d'entrée.
  FOREACH v_seg IN ARRAY public._crm_cond_segment_ids(p_graph->'entry'->'filter') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.crm_segments s WHERE s.id::text = v_seg AND s.scope_key = v_key) THEN
      errs := public._crm_scn_push(errs, 'unknown_segment', NULL, 'entry.filter');
    END IF;
  END LOOP;

  FOR n IN SELECT x.id, x.v FROM jsonb_each(CASE WHEN jsonb_typeof(p_graph->'nodes') = 'object' THEN p_graph->'nodes' ELSE '{}'::jsonb END) x(id, v) LOOP
    IF n.v->>'type' = 'email' AND public._crm_scn_uuid(n.v->'template_id')
       AND NOT EXISTS (SELECT 1 FROM public.email_campaign_templates tp
                        WHERE tp.id = (n.v->>'template_id')::uuid
                          AND tp.venue_id IS NOT DISTINCT FROM p_venue_id
                          AND tp.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id) THEN
      errs := public._crm_scn_push(errs, 'unknown_template', n.id, 'template_id');
    END IF;
    IF n.v->>'type' IN ('email', 'sms') AND n.v->>'event' = 'fixed' AND public._crm_scn_uuid(n.v->'event_id') THEN
      IF NOT EXISTS (SELECT 1 FROM public.events e
                      WHERE e.id = (n.v->>'event_id')::uuid AND e.external_source IS NOT NULL
                        AND ((p_venue_id IS NOT NULL AND e.venue_id = p_venue_id)
                          OR (p_organizer_user_id IS NOT NULL AND e.organizer_user_id = p_organizer_user_id))) THEN
        errs := public._crm_scn_push(errs, 'unknown_event', n.id, 'event_id');
      ELSIF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = (n.v->>'event_id')::uuid AND e.start_at > now()) THEN
        errs := public._crm_scn_push(errs, 'event_past', n.id, 'event_id');
      END IF;
    END IF;
    IF n.v->>'type' = 'sms' THEN v_sms := true; END IF;
    IF n.v->>'type' IN ('branch', 'wait') THEN
      FOREACH v_seg IN ARRAY public._crm_cond_segment_ids(n.v->'cond') LOOP
        IF NOT EXISTS (SELECT 1 FROM public.crm_segments s WHERE s.id::text = v_seg AND s.scope_key = v_key) THEN
          errs := public._crm_scn_push(errs, 'unknown_segment', n.id, 'cond');
        END IF;
      END LOOP;
      -- Une famille qui n'est pas confirmée sur le compte ne retient personne.
      FOREACH v_fam IN ARRAY public._crm_cond_leaf_values(n.v->'cond', 'sc_family') LOOP
        IF NOT public._crm_family_confirmed(v_key, v_fam) THEN
          warns := public._crm_scn_push(warns, 'family_not_confirmed', n.id, 'cond:' || v_fam);
        END IF;
      END LOOP;
      IF cardinality(public._crm_cond_leaf_values(n.v->'cond', 'sc_chance')) > 0 THEN
        SELECT m.status INTO v_score FROM public.crm_score_model m WHERE m.scope_key = v_key;
        IF COALESCE(v_score, '') <> 'ok' THEN warns := public._crm_scn_push(warns, 'chance_unavailable', n.id, 'cond'); END IF;
      END IF;
    END IF;
  END LOOP;
  FOREACH v_fam IN ARRAY public._crm_cond_leaf_values(p_graph->'entry'->'filter', 'sc_family') LOOP
    IF NOT public._crm_family_confirmed(v_key, v_fam) THEN
      warns := public._crm_scn_push(warns, 'family_not_confirmed', NULL, 'entry.filter:' || v_fam);
    END IF;
  END LOOP;
  IF cardinality(public._crm_cond_leaf_values(p_graph->'entry'->'filter', 'sc_chance')) > 0 THEN
    SELECT m.status INTO v_score FROM public.crm_score_model m WHERE m.scope_key = v_key;
    IF COALESCE(v_score, '') <> 'ok' THEN warns := public._crm_scn_push(warns, 'chance_unavailable', NULL, 'entry.filter'); END IF;
  END IF;

  -- Un SMS exige l'identité légale de l'expéditeur.
  IF v_sms THEN
    v_ready := COALESCE((public.get_sms_sender_readiness(p_venue_id, p_organizer_user_id)->>'identity_ok')::boolean, false);
    IF NOT v_ready THEN errs := public._crm_scn_push(errs, 'sms_identity', NULL, 'sms'); END IF;
  END IF;
  RETURN jsonb_build_object('errors', public._crm_scn_sorted(errs), 'warnings', public._crm_scn_sorted(warns));
END;
$function$;

-- ── 4. Lecture ──────────────────────────────────────────────────────────────
-- L'état affiché : le gel d'envoi et le compte en pause mettent un scénario
-- actif EN PAUSE, jamais en erreur.
CREATE OR REPLACE FUNCTION public._crm_scenario_state(p_status text, p_scope text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_status <> 'active' THEN p_status
    WHEN EXISTS (SELECT 1 FROM public.crm_settings cs WHERE cs.scope_key = p_scope AND cs.sending_frozen_at IS NOT NULL) THEN 'frozen'
    WHEN public.crm_effective_plan(p_scope) = 'paused' THEN 'plan_paused'
    ELSE 'active' END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_scenarios(p_venue_id text, p_organizer_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'can_edit', COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false),
    'can_publish', COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) AND NOT public.is_support_session(),
    'scenarios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'status', s.status,
               'state', public._crm_scenario_state(s.status, v_key),
               'trigger', s.draft->'trigger'->>'type',
               'source_kind', s.source_kind, 'template', s.template,
               'ai_author', s.ai_author, 'ai_updated_at', s.ai_updated_at,
               'version', s.version_no,
               'has_changes', s.live_version_id IS NOT NULL AND s.draft IS DISTINCT FROM v.graph,
               'published_at', s.published_at, 'updated_at', s.updated_at,
               'entered', COALESCE(r.entered, 0), 'active', COALESCE(r.active, 0),
               'goal', COALESCE(r.goal, 0), 'holdout', COALESCE(r.holdout, 0),
               'goal_holdout', COALESCE(r.goal_holdout, 0),
               -- Le témoin, même règle que crm_scenario_report (mesure close).
               'measure', public._crm_scenario_holdout(s.id))
             ORDER BY (s.status = 'archived'), s.updated_at DESC)
        FROM public.crm_scenarios s
        LEFT JOIN public.crm_scenario_versions v ON v.id = s.live_version_id
        LEFT JOIN LATERAL (
          SELECT count(*) AS entered,
                 count(*) FILTER (WHERE x.status = 'active') AS active,
                 count(*) FILTER (WHERE x.goal_at IS NOT NULL AND NOT x.holdout) AS goal,
                 count(*) FILTER (WHERE x.holdout) AS holdout,
                 count(*) FILTER (WHERE x.goal_at IS NOT NULL AND x.holdout) AS goal_holdout
            FROM public.crm_scenario_runs x WHERE x.scenario_id = s.id
        ) r ON true
       WHERE s.scope_key = v_key), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_scenario(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  s public.crm_scenarios%ROWTYPE;
  v_live jsonb;
  v_check jsonb;
  v_content jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.crm_scenarios x WHERE x.id = p_id AND x.scope_key = v_key;
  IF s.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT jsonb_build_object('id', v.id, 'version', v.version, 'graph', v.graph, 'published_at', v.published_at)
    INTO v_live FROM public.crm_scenario_versions v WHERE v.id = s.live_version_id;
  v_check := public._crm_scenario_graph_errors(s.draft);
  v_content := public._crm_scenario_content(p_venue_id, p_organizer_user_id, s.draft);
  RETURN jsonb_build_object(
    'id', s.id, 'name', s.name, 'status', s.status, 'state', public._crm_scenario_state(s.status, v_key),
    'draft', s.draft, 'draft_updated_at', s.draft_updated_at, 'version', s.version_no,
    'source_kind', s.source_kind, 'template', s.template,
    'ai_author', s.ai_author, 'ai_updated_at', s.ai_updated_at,
    'live', v_live, 'has_changes', v_live IS NOT NULL AND s.draft IS DISTINCT FROM v_live->'graph',
    'published_at', s.published_at, 'paused_at', s.paused_at, 'archived_at', s.archived_at,
    'errors', public._crm_scn_sorted((v_check->'errors') || (v_content->'errors')),
    'warnings', v_content->'warnings', 'stats', v_check->'stats',
    'rates', jsonb_build_object('email', 1, 'sms', public.crm_sms_rates()),
    'can_edit', COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false),
    'can_publish', COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) AND NOT public.is_support_session());
END;
$function$;

-- ── 5. Écriture ─────────────────────────────────────────────────────────────
-- Créer (p_id NULL) ou modifier le brouillon. Un brouillon accepte un graphe
-- incomplet (la validation bloque la PUBLICATION, pas l'écriture) mais jamais
-- un objet qui n'est pas un graphe, ni plus de 64 Ko. Concurrence : p_expected
-- = draft_updated_at lu ; s'il a changé, `draft_changed`.
CREATE OR REPLACE FUNCTION public.crm_scenario_save(p_venue_id text, p_organizer_user_id uuid, p_id uuid,
                                                    p_name text, p_graph jsonb, p_expected timestamptz DEFAULT NULL,
                                                    p_source_kind text DEFAULT NULL, p_template text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  s public.crm_scenarios%ROWTYPE;
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_graph IS NULL OR jsonb_typeof(p_graph) <> 'object' OR p_graph->'v' IS DISTINCT FROM '1'::jsonb THEN
    RAISE EXCEPTION 'bad_graph' USING ERRCODE = '22023';
  END IF;
  IF length(p_graph::text) > 65536 THEN RAISE EXCEPTION 'graph_too_large' USING ERRCODE = '22023'; END IF;
  IF v_name IS NOT NULL AND length(v_name) > 80 THEN RAISE EXCEPTION 'bad_name' USING ERRCODE = '22023'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.crm_scenarios (scope_key, venue_id, organizer_user_id, name, draft, source_kind, template, created_by)
    VALUES (v_key, p_venue_id, p_organizer_user_id, COALESCE(v_name, 'Scénario'), p_graph, p_source_kind, p_template, auth.uid())
    RETURNING * INTO s;
  ELSE
    SELECT * INTO s FROM public.crm_scenarios x WHERE x.id = p_id AND x.scope_key = v_key FOR UPDATE;
    IF s.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    IF s.status = 'archived' THEN RAISE EXCEPTION 'archived' USING ERRCODE = 'P0001'; END IF;
    IF p_expected IS NOT NULL AND s.draft_updated_at IS DISTINCT FROM p_expected THEN
      RAISE EXCEPTION 'draft_changed' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.crm_scenarios x
       SET name = COALESCE(v_name, x.name), draft = p_graph, draft_updated_at = clock_timestamp(), updated_at = now()
     WHERE x.id = s.id
    RETURNING * INTO s;
  END IF;
  RETURN jsonb_build_object('id', s.id, 'draft_updated_at', s.draft_updated_at, 'status', s.status);
END;
$function$;

-- Publier : valider (forme + base), figer une version, mettre en ligne,
-- éteindre la recette copiée. Jamais en accès assisté (décision 4).
CREATE OR REPLACE FUNCTION public.crm_scenario_publish(p_venue_id text, p_organizer_user_id uuid, p_id uuid,
                                                       p_expected timestamptz DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  s public.crm_scenarios%ROWTYPE;
  v_check jsonb;
  v_content jsonb;
  v_errs jsonb;
  v_ver uuid;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM public.crm_scenarios x WHERE x.id = p_id AND x.scope_key = v_key FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.status = 'archived' THEN RAISE EXCEPTION 'archived' USING ERRCODE = 'P0001'; END IF;
  IF p_expected IS NOT NULL AND s.draft_updated_at IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'draft_changed' USING ERRCODE = 'P0001';
  END IF;

  v_check := public._crm_scenario_graph_errors(s.draft);
  v_content := public._crm_scenario_content(p_venue_id, p_organizer_user_id, s.draft);
  v_errs := public._crm_scn_sorted((v_check->'errors') || (v_content->'errors'));
  IF jsonb_array_length(v_errs) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_errs, 'warnings', v_content->'warnings');
  END IF;

  INSERT INTO public.crm_scenario_versions (scenario_id, scope_key, version, graph, stats, published_by)
  VALUES (s.id, v_key, s.version_no + 1, s.draft, v_check->'stats', auth.uid())
  RETURNING id INTO v_ver;
  UPDATE public.crm_scenarios x
     SET live_version_id = v_ver, version_no = s.version_no + 1, status = 'active',
         published_at = now(), paused_at = NULL, updated_at = now()
   WHERE x.id = s.id;
  -- La recette copiée s'éteint (« jamais les deux sur un même sujet »).
  IF s.source_kind IS NOT NULL THEN
    UPDATE public.email_automations a SET enabled = false
     WHERE a.kind = s.source_kind AND a.enabled
       AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'version_id', v_ver, 'version', s.version_no + 1, 'warnings', v_content->'warnings');
END;
$function$;

-- Mettre en pause, reprendre, archiver. Reprendre vaut publier : jamais en
-- accès assisté ; mettre en pause ou archiver arrête des envois : permis.
-- Archiver fait sortir les personnes en route (« archived »).
CREATE OR REPLACE FUNCTION public.crm_scenario_set_status(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  s public.crm_scenarios%ROWTYPE;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('active', 'paused', 'archived') THEN RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM public.crm_scenarios x WHERE x.id = p_id AND x.scope_key = v_key FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.status = 'archived' THEN RAISE EXCEPTION 'archived' USING ERRCODE = 'P0001'; END IF;
  IF p_status = 'active' THEN
    IF public.is_support_session() THEN RAISE EXCEPTION 'support_session' USING ERRCODE = '42501'; END IF;
    IF s.live_version_id IS NULL THEN RAISE EXCEPTION 'never_published' USING ERRCODE = 'P0001'; END IF;
    IF s.source_kind IS NOT NULL THEN
      UPDATE public.email_automations a SET enabled = false
       WHERE a.kind = s.source_kind AND a.enabled
         AND a.venue_id IS NOT DISTINCT FROM p_venue_id AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;
    END IF;
  ELSIF p_status = 'paused' AND s.status = 'draft' THEN
    RAISE EXCEPTION 'never_published' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.crm_scenarios x
     SET status = p_status, updated_at = now(),
         paused_at = CASE WHEN p_status = 'paused' THEN now() ELSE NULL END,
         archived_at = CASE WHEN p_status = 'archived' THEN now() END
   WHERE x.id = s.id;
  IF p_status = 'archived' THEN
    UPDATE public.crm_scenario_runs r SET status = 'exited', exit_reason = 'archived', updated_at = now()
     WHERE r.scenario_id = s.id AND r.status = 'active';
  END IF;
  RETURN jsonb_build_object('id', s.id, 'status', p_status);
END;
$function$;

-- Supprimer : un brouillon jamais publié seulement (un scénario publié garde
-- ses inscriptions et ses chiffres : on l'archive).
CREATE OR REPLACE FUNCTION public.crm_scenario_delete(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  s public.crm_scenarios%ROWTYPE;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.crm_scenarios x WHERE x.id = p_id AND x.scope_key = v_key FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.live_version_id IS NOT NULL OR s.version_no > 0 THEN RAISE EXCEPTION 'published' USING ERRCODE = 'P0001'; END IF;
  DELETE FROM public.crm_scenarios x WHERE x.id = s.id;
  RETURN jsonb_build_object('deleted', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_scenario_duplicate(p_venue_id text, p_organizer_user_id uuid, p_id uuid, p_name text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  s public.crm_scenarios%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.crm_scenarios x WHERE x.id = p_id AND x.scope_key = v_key;
  IF s.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  -- Une copie n'est jamais « la recette » : elle ne l'éteint pas.
  INSERT INTO public.crm_scenarios (scope_key, venue_id, organizer_user_id, name, draft, template, created_by)
  VALUES (v_key, p_venue_id, p_organizer_user_id,
          left(COALESCE(NULLIF(btrim(COALESCE(p_name, '')), ''), s.name || ' (copie)'), 80), s.draft, s.template, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$function$;

-- ── 6. Les chiffres d'un scénario ───────────────────────────────────────────
-- Témoin : intention de contacter contre témoin, sur les inscriptions dont la
-- mesure est close (sorties, finies, ou entrées il y a plus de 30 jours). Même
-- formule que crm_holdout_overview : ≈ N acheteurs en plus et z seulement à
-- partir de 10 personnes par groupe ; le verdict (|z| ≥ 2) est rendu par
-- l'écran (holdoutVerdict).
CREATE OR REPLACE FUNCTION public._crm_scenario_holdout(p_scenario uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH r AS (
    SELECT x.holdout, x.goal_at IS NOT NULL AS goal,
           (x.status <> 'active' OR x.entered_at < now() - interval '30 days') AS settled
      FROM public.crm_scenario_runs x WHERE x.scenario_id = p_scenario
  ), g AS (
    SELECT count(*) FILTER (WHERE NOT holdout AND settled) AS n_c, count(*) FILTER (WHERE NOT holdout AND settled AND goal) AS b_c,
           count(*) FILTER (WHERE holdout AND settled) AS n_h, count(*) FILTER (WHERE holdout AND settled AND goal) AS b_h,
           bool_and(settled) AS done
      FROM r
  )
  SELECT jsonb_build_object(
           'done', COALESCE(g.done, false),
           'contacted', jsonb_build_object('n', g.n_c, 'buyers', g.b_c),
           'control', jsonb_build_object('n', g.n_h, 'buyers', g.b_h),
           'extra', CASE WHEN g.n_c >= 10 AND g.n_h >= 10
                         THEN round(g.n_c * (g.b_c::numeric / g.n_c - g.b_h::numeric / g.n_h), 1) END,
           'z', CASE WHEN g.n_c >= 10 AND g.n_h >= 10 AND (g.b_c + g.b_h) > 0 AND (g.b_c + g.b_h) < (g.n_c + g.n_h) THEN round((
                  (g.b_c::numeric / g.n_c - g.b_h::numeric / g.n_h)
                  / sqrt(((g.b_c + g.b_h)::numeric / (g.n_c + g.n_h)) * (1 - (g.b_c + g.b_h)::numeric / (g.n_c + g.n_h))
                         * (1.0 / g.n_c + 1.0 / g.n_h)))::numeric, 2) END)
    FROM g;
$function$;

-- Le rapport :
-- Par nœud : entrés, passés, envoyés (« aurait envoyé » pour la démo),
-- ouverts, cliqués, objectif atteint après le nœud, reportés et expirés par
-- raison. Par scénario : témoin (même règle que crm_holdout_overview : ≈ N
-- acheteurs en plus seulement si 10 personnes par groupe ; le verdict |z| ≥ 2
-- est rendu par l'écran, holdoutVerdict), CA attribué par la règle
-- d'attribution existante (_crm_email_attrib : un clic dans les 7 jours avant
-- l'achat, le dernier clic gagne), derrière _crm_money_gate.
CREATE OR REPLACE FUNCTION public.crm_scenario_report(p_venue_id text, p_organizer_user_id uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  s public.crm_scenarios%ROWTYPE;
  v_nodes jsonb;
  v_hold jsonb;
  v_money jsonb;
  v_reasons jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.crm_scenarios x WHERE x.id = p_id AND x.scope_key = v_key;
  IF s.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;

  WITH st AS (
    SELECT st.*, r.email, r.holdout, r.goal_at
      FROM public.crm_scenario_steps st
      JOIN public.crm_scenario_runs r ON r.id = st.run_id
     WHERE st.scenario_id = s.id
  ), ev AS (
    SELECT st.node_id,
           count(DISTINCT st.email) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.email_campaign_events e
              WHERE e.campaign_id = st.campaign_id AND lower(e.recipient_email) = st.email
                AND e.event_type IN ('opened', 'clicked'))) AS opened,
           count(DISTINCT st.email) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.email_campaign_events e
              WHERE e.campaign_id = st.campaign_id AND lower(e.recipient_email) = st.email
                AND e.event_type = 'clicked')) AS clicked
      FROM st WHERE st.status = 'sent' AND st.campaign_id IS NOT NULL
     GROUP BY st.node_id
  ), agg AS (
    SELECT st.node_id,
           count(DISTINCT st.run_id) AS entered,
           count(DISTINCT st.run_id) FILTER (WHERE st.status IN ('passed', 'sent', 'would_send', 'holdout')) AS passed,
           count(DISTINCT st.run_id) FILTER (WHERE st.status = 'sent') AS sent,
           count(DISTINCT st.run_id) FILTER (WHERE st.status = 'would_send') AS would_send,
           count(DISTINCT st.run_id) FILTER (WHERE st.status = 'holdout') AS holdout,
           count(DISTINCT st.run_id) FILTER (WHERE st.goal_at IS NOT NULL AND st.goal_at >= st.created_at AND NOT st.holdout) AS goal,
           count(DISTINCT st.run_id) FILTER (WHERE st.status = 'held') AS held
      FROM st GROUP BY st.node_id
  ), rsn AS (
    SELECT st.node_id, jsonb_object_agg(st.k, st.n) AS reasons
      FROM (SELECT x.node_id, x.status || ':' || COALESCE(x.reason, '') AS k, count(*) AS n
              FROM st x WHERE x.status IN ('held', 'expired') GROUP BY 1, 2) st
     GROUP BY st.node_id
  )
  SELECT COALESCE(jsonb_object_agg(a.node_id, jsonb_build_object(
           'entered', a.entered, 'passed', a.passed, 'sent', a.sent, 'would_send', a.would_send,
           'holdout', a.holdout, 'goal', a.goal, 'held', a.held,
           'opened', COALESCE(e.opened, 0), 'clicked', COALESCE(e.clicked, 0),
           'reasons', COALESCE(z.reasons, '{}'::jsonb))), '{}'::jsonb)
    INTO v_nodes
    FROM agg a LEFT JOIN ev e ON e.node_id = a.node_id LEFT JOIN rsn z ON z.node_id = a.node_id;

  v_hold := public._crm_scenario_holdout(s.id);

  -- CA attribué : la règle d'attribution existante, sur les campagnes du scénario.
  PERFORM public._crm_email_attrib(p_venue_id, p_organizer_user_id);
  SELECT jsonb_build_object('purchases', count(*), 'revenue', COALESCE(round(sum(a.amount), 2), 0))
    INTO v_money
    FROM _cma a
   WHERE a.campaign_id IN (SELECT m.campaign_id FROM public.crm_scenario_messages m
                             JOIN public.crm_scenario_versions v ON v.id = m.version_id
                            WHERE v.scenario_id = s.id AND m.campaign_id IS NOT NULL);

  SELECT COALESCE(jsonb_object_agg(x.k, x.n), '{}'::jsonb) INTO v_reasons
    FROM (SELECT r.exit_reason AS k, count(*) AS n FROM public.crm_scenario_runs r
           WHERE r.scenario_id = s.id AND r.exit_reason IS NOT NULL GROUP BY 1) x;

  RETURN public._crm_money_gate(jsonb_build_object(
    'id', s.id, 'state', public._crm_scenario_state(s.status, v_key),
    'nodes', v_nodes, 'holdout', v_hold, 'exits', v_reasons,
    'attributed', v_money,
    'holdout_pct', public.crm_holdout_pct(v_key)), p_venue_id, p_organizer_user_id);
END;
$function$;

-- ── 7. Droits ───────────────────────────────────────────────────────────────
DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    '_crm_scenario_uses_event(jsonb)', '_crm_cond_segment_ids(jsonb)', '_crm_cond_leaf_values(jsonb, text)',
    '_crm_scenario_content(text, uuid, jsonb)', '_crm_scenario_state(text, text)', '_crm_scenario_holdout(uuid)',
    'guard_crm_scenario_version_immutable()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'crm_scenarios(text, uuid)', 'crm_scenario(text, uuid, uuid)',
    'crm_scenario_save(text, uuid, uuid, text, jsonb, timestamptz, text, text)',
    'crm_scenario_publish(text, uuid, uuid, timestamptz)', 'crm_scenario_set_status(text, uuid, uuid, text)',
    'crm_scenario_delete(text, uuid, uuid)', 'crm_scenario_duplicate(text, uuid, uuid, text)',
    'crm_scenario_report(text, uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END
$grants$;
