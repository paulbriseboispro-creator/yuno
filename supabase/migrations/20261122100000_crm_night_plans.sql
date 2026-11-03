-- Yuno CRM — « Plans de soirée » : le pro accepte les envois de « Qui cibler »,
-- Yuno prépare les e-mails, les programme et les protège (lot 1 de
-- docs/designs/CRM_NIGHT_CAMPAIGN_PLAN.md, décisions D1, D2, D4 de Paul du 03/11).
--
-- Un plan = une ligne crm_night_plans (portée, soirée miroir) + une campagne
-- e-mail CRM ORDINAIRE par audience acceptée (email_campaigns.night_plan_id),
-- programmée : elle se retouche dans le Studio, elle part par le chemin de
-- toujours (cron → send-campaign → enqueue → claim), Yunits, identité, gel,
-- heures calmes et règles Yuno compris. Ce que le plan ajoute, appliqué PAR LA
-- BASE à chaque mise en file d'une campagne du plan (_crm_night_plan_filter) :
--   1. une place pour la soirée = aucun e-mail du plan (revérifié aussi à la
--      sortie de file, claim_campaign_recipients) ;
--   2. au plus `cap` e-mails du plan par personne (2 si la soirée est à moins
--      de 7 jours, 3 sinon) ;
--   3. 36 h entre deux e-mails du plan pour une même personne (20 h pour la
--      dernière ligne droite) ; un e-mail programmé plus tôt compte déjà ;
--   4. un seul témoin pour tout le plan (_crm_holdout_pick('plan:<id>')).
-- Les audiences d'un même moment partent à 15 min d'écart, dans l'ordre
-- conseillé : la règle 3 donne chaque personne à la première qui la contient.
--
-- Trois étapes (demande de Paul du 03/11) : 1. le pro choisit les envois
-- (« Qui cibler ») ; 2. Yuno crée les e-mails EN BROUILLON (plan `setup`) et le
-- pro retouche le design et le texte, dans le Studio ou par son IA branchée
-- (MCP : un brouillon ordinaire, update_email_draft) — un e-mail est « relu »
-- quand il a été retouché ou que le pro l'a gardé tel quel ; 3. il programme
-- (crm_night_plan_schedule) : identité, Yunits, puis chaque e-mail à sa date.
-- Le premier départ a lieu au plus tôt 15 min après la programmation ; les
-- seuils de crm_night_targets comptent 2 h de marge pour la relecture (38 h / 22 h).

SET lock_timeout = '5s';

-- ── Règles (une seule définition) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_night_plan_rules()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'spacing_h', 36, 'last_spacing_h', 20,
    'cap_short', 2, 'cap_long', 3, 'short_days', 7,
    'lead_min', 120, 'stagger_min', 15, 'end_margin_h', 2);
$$;
REVOKE ALL ON FUNCTION public.crm_night_plan_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_plan_rules() TO authenticated, service_role;

-- ── Table ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_night_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key         text NOT NULL,
  venue_id          text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id uuid,
  event_id          uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('setup', 'active', 'paused', 'done', 'stopped')),
  stop_reason       text,
  cap               integer NOT NULL CHECK (cap BETWEEN 1 AND 6),
  config            jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_by       uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_night_plans_live_uq
  ON public.crm_night_plans (scope_key, event_id) WHERE status IN ('setup', 'active', 'paused');
CREATE INDEX IF NOT EXISTS crm_night_plans_scope_idx ON public.crm_night_plans (scope_key, created_at DESC);
ALTER TABLE public.crm_night_plans ENABLE ROW LEVEL SECURITY;
-- Aucune policy : tout passe par les RPC crm_night_plan_*.

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS night_plan_id uuid REFERENCES public.crm_night_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS night_plan_step text;
CREATE INDEX IF NOT EXISTS email_campaigns_night_plan_idx
  ON public.email_campaigns (night_plan_id) WHERE night_plan_id IS NOT NULL;

-- ── Garde : le plan et son audience ne s'écrivent que par les RPC ──────────
-- INVOKER (jamais DEFINER : il se désactiverait). L'audience, les exclusions et
-- la soirée d'un e-mail du plan sont RÉTABLIES en silence pour tout écrivain
-- (Studio, IA par le MCP…) — l'autosave ne doit jamais tomber — sauf les RPC du
-- plan, qui posent `yuno.night_plan_write`. Un client qui change le plan d'un
-- e-mail est refusé.
CREATE OR REPLACE FUNCTION public.guard_crm_night_plan_campaign()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(current_setting('yuno.night_plan_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF current_user IN ('authenticated', 'anon') AND (NEW.night_plan_id IS NOT NULL OR NEW.night_plan_step IS NOT NULL) THEN
      RAISE EXCEPTION 'crm_night_plan_locked' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF current_user IN ('authenticated', 'anon')
     AND (NEW.night_plan_id IS DISTINCT FROM OLD.night_plan_id OR NEW.night_plan_step IS DISTINCT FROM OLD.night_plan_step) THEN
    RAISE EXCEPTION 'crm_night_plan_locked' USING ERRCODE = '42501';
  END IF;
  IF OLD.night_plan_id IS NOT NULL AND NEW.night_plan_id IS NOT NULL THEN
    NEW.audiences_json := OLD.audiences_json;
    NEW.exclusions_json := OLD.exclusions_json;
    NEW.event_id := OLD.event_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_crm_night_plan_campaign ON public.email_campaigns;
CREATE TRIGGER trg_guard_crm_night_plan_campaign
  BEFORE INSERT OR UPDATE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_crm_night_plan_campaign();

-- ── Calendrier : les seuils comptent les 2 h de relecture ───────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.crm_night_targets(text, uuid, uuid)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, 'now() + interval ''20 hours''', ''))) / length('now() + interval ''20 hours''') <> 2
     OR position('v_mid < now() + interval ''36 hours''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'crm_night_targets : repères du calendrier introuvables';
  END IF;
  v_def := replace(v_def, 'now() + interval ''20 hours''', 'now() + interval ''22 hours''');
  v_def := replace(v_def, 'v_mid < now() + interval ''36 hours''', 'v_mid < now() + interval ''38 hours''');
  EXECUTE v_def;
END
$$;

-- ── Les règles du plan, à la mise en file d'une campagne du plan ───────────
CREATE OR REPLACE FUNCTION public._crm_night_plan_filter(p_campaign_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rules jsonb := public.crm_night_plan_rules();
  v_pid   uuid;
  v_step  text;
  v_ev    uuid;
  v_cap   integer;
  v_sp    interval;
  v_n     integer := 0;
  v_ref   timestamptz;
BEGIN
  -- L'écart se mesure depuis le départ de CET e-mail (sa date prévue, ou
  -- maintenant s'il part en retard), pas depuis l'instant de la mise en file.
  SELECT c.night_plan_id, c.night_plan_step, c.event_id, GREATEST(now(), COALESCE(c.scheduled_at, now()))
    INTO v_pid, v_step, v_ev, v_ref
    FROM public.email_campaigns c WHERE c.id = p_campaign_id;
  IF v_pid IS NULL THEN
    RETURN 0;
  END IF;
  SELECT p.cap INTO v_cap FROM public.crm_night_plans p WHERE p.id = v_pid;
  v_cap := COALESCE(v_cap, (v_rules->>'cap_short')::integer);
  v_sp := make_interval(hours => CASE WHEN v_step = 'last_minute'
                                      THEN (v_rules->>'last_spacing_h')::integer
                                      ELSE (v_rules->>'spacing_h')::integer END);

  WITH holders AS (
    SELECT DISTINCT lower(t.buyer_email) AS em
      FROM public.external_tickets t
     WHERE t.event_id = v_ev AND t.status IN ('valid', 'transferred') AND t.buyer_email IS NOT NULL
  ), prev AS (
    SELECT lower(r.email) AS em, count(*)::int AS n,
           max(COALESCE(r.sent_at, c2.scheduled_at, r.created_at)) AS last_at
      FROM public.email_campaign_recipients r
      JOIN public.email_campaigns c2 ON c2.id = r.campaign_id
     WHERE c2.night_plan_id = v_pid AND c2.id <> p_campaign_id
       AND r.status IN ('pending', 'sending', 'sent')
     GROUP BY 1
  ), bad AS (
    SELECT r.id,
           CASE WHEN h.em IS NOT NULL THEN 'policy:plan_holder'
                WHEN pv.n >= v_cap THEN 'policy:plan_cap'
                ELSE 'policy:plan_spacing' END AS reason
      FROM public.email_campaign_recipients r
      LEFT JOIN holders h ON h.em = lower(r.email)
      LEFT JOIN prev pv ON pv.em = lower(r.email)
     WHERE r.campaign_id = p_campaign_id AND r.status = 'pending'
       AND (h.em IS NOT NULL OR pv.n >= v_cap OR pv.last_at > v_ref - v_sp)
  ), upd AS (
    UPDATE public.email_campaign_recipients q
       SET status = 'skipped', error_message = bad.reason
      FROM bad
     WHERE q.id = bad.id
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM upd;

  IF v_n > 0 THEN
    UPDATE public.email_campaigns c
       SET policy_skipped_count = COALESCE(c.policy_skipped_count, 0) + v_n,
           total_recipients = GREATEST(0, COALESCE(c.total_recipients, 0) - v_n)
     WHERE c.id = p_campaign_id;
  END IF;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._crm_night_plan_filter(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_night_plan_filter(uuid) TO service_role;

-- enqueue_campaign_recipients : les règles du plan AVANT le témoin et le
-- débit ; le témoin d'un plan est tiré pour tout le plan.
DO $$
DECLARE
  v_def text;
  m1 text := E'  v_lb text;\nBEGIN';
  m2 text := E'  v_res := public._enqueue_campaign_recipients_core(p_campaign_id);\n';
  m3 text := 'public._crm_holdout_pick(p_campaign_id::text, r.email, v_pct)';
BEGIN
  v_def := pg_get_functiondef('public.enqueue_campaign_recipients(uuid)'::regprocedure);
  IF position(m1 IN v_def) = 0 OR position(m2 IN v_def) = 0 OR position(m3 IN v_def) = 0 THEN
    RAISE EXCEPTION 'enqueue_campaign_recipients : repères introuvables';
  END IF;
  v_def := replace(v_def, m1, E'  v_lb text;\n  v_plan_skip integer := 0;\nBEGIN');
  v_def := replace(v_def, m2, m2 || $r$
  -- Plan de soirée (20261122100000) : place prise, plafond, 36 h.
  v_plan_skip := public._crm_night_plan_filter(p_campaign_id);
  IF v_plan_skip > 0 THEN
    v_res := v_res || jsonb_build_object('plan_skipped', v_plan_skip,
               'queued', GREATEST(0, COALESCE((v_res->>'queued')::integer, 0) - v_plan_skip),
               'total', GREATEST(0, COALESCE((v_res->>'total')::integer, 0) - v_plan_skip),
               'remaining', GREATEST(0, COALESCE((v_res->>'remaining')::integer, 0) - v_plan_skip));
  END IF;
$r$);
  v_def := replace(v_def, m3,
    'public._crm_holdout_pick(COALESCE((SELECT ''plan:'' || pc.night_plan_id::text FROM public.email_campaigns pc WHERE pc.id = p_campaign_id AND pc.night_plan_id IS NOT NULL), p_campaign_id::text), r.email, v_pct)');
  EXECUTE v_def;
END
$$;

-- claim_campaign_recipients : un billet acheté depuis la mise en file.
DO $$
DECLARE
  v_def text;
  m1 text := E'  v_ids uuid[];\n';
  m2 text := E'  RETURN QUERY\n  UPDATE public.email_campaign_recipients r\n     SET status = ''sending'',';
BEGIN
  v_def := pg_get_functiondef('public.claim_campaign_recipients(uuid, integer)'::regprocedure);
  IF position(m1 IN v_def) = 0 OR position(m2 IN v_def) = 0 THEN
    RAISE EXCEPTION 'claim_campaign_recipients : repères introuvables';
  END IF;
  v_def := replace(v_def, m1, m1 || E'  v_hskip integer := 0;\n');
  v_def := replace(v_def, m2, $r$  -- Plan de soirée (20261122100000) : une place prise depuis la mise en file.
  IF EXISTS (SELECT 1 FROM public.email_campaigns ec WHERE ec.id = p_campaign_id AND ec.night_plan_id IS NOT NULL) THEN
    WITH hb AS (
      SELECT r.id FROM public.email_campaign_recipients r
        JOIN public.email_campaigns ec ON ec.id = r.campaign_id
       WHERE r.id = ANY (v_ids) AND r.status = 'pending'
         AND EXISTS (SELECT 1 FROM public.external_tickets t
                      WHERE t.event_id = ec.event_id AND t.status IN ('valid', 'transferred')
                        AND lower(t.buyer_email) = lower(r.email))
    ), hu AS (
      UPDATE public.email_campaign_recipients q
         SET status = 'skipped', error_message = 'policy:plan_holder_after_queue', claimed_at = NULL
        FROM hb WHERE q.id = hb.id
      RETURNING 1
    )
    SELECT count(*) INTO v_hskip FROM hu;
    IF v_hskip > 0 THEN
      UPDATE public.email_campaigns
         SET policy_skipped_count = COALESCE(policy_skipped_count, 0) + v_hskip
       WHERE id = p_campaign_id;
      IF public.crm_scope_key(c.venue_id, c.organizer_user_id) IS NOT NULL THEN
        PERFORM public.crm_yunits_refund(public.crm_scope_key(c.venue_id, c.organizer_user_id), v_hskip,
                                         'email', 'email_campaign', p_campaign_id::text, c.name);
      END IF;
    END IF;
  END IF;

$r$ || m2);
  EXECUTE v_def;
END
$$;

-- ── Préparer un plan (étape 1 → 2) : les brouillons ─────────────────────────
-- p_audiences : les clés acceptées (ordre conseillé recalculé ici).
-- p_contents  : { "<audience>": { name, subject, preheader, blocks, theme,
--                 socialLinks, logoUrl, templateKind, label } } — les modèles
--                 de la Console, construits par le front (aucune IA).
CREATE OR REPLACE FUNCTION public.crm_night_plan_launch(
  p_venue_id text, p_organizer_user_id uuid, p_event_id uuid,
  p_audiences text[], p_contents jsonb, p_config jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key    text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_org    uuid := CASE WHEN p_venue_id IS NULL THEN p_organizer_user_id END;
  v_rules  jsonb := public.crm_night_plan_rules();
  v_demo   boolean := public.is_demo_marketing_scope(p_venue_id, p_organizer_user_id);
  v_plan   jsonb;
  v_start  timestamptz;
  v_days   integer;
  v_cap    integer;
  v_quiet  boolean;
  v_cost   integer := 0;
  v_pid    uuid;
  v_cid    uuid;
  v_at     timestamptz;
  v_prev   text;
  v_k      integer := 0;
  v_c      jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_late   text[] := ARRAY[]::text[];
  a        record;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'support_session');
  END IF;
  IF p_audiences IS NULL OR cardinality(p_audiences) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_audience');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('crm_night_plan:' || v_key || ':' || p_event_id::text));
  SELECT p.id INTO v_pid FROM public.crm_night_plans p
   WHERE p.scope_key = v_key AND p.event_id = p_event_id AND p.status IN ('setup', 'active', 'paused');
  IF v_pid IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'plan_exists', 'plan_id', v_pid);
  END IF;
  PERFORM set_config('yuno.night_plan_write', 'on', true);

  v_plan := public.crm_night_plan(p_venue_id, p_organizer_user_id, p_event_id);
  IF NOT COALESCE((v_plan->>'ok')::boolean, false) THEN
    RETURN v_plan;
  END IF;
  SELECT e.start_at INTO v_start FROM public.events e WHERE e.id = p_event_id;
  v_days := COALESCE((v_plan->>'days_left')::integer, 0);
  v_cap := CASE WHEN v_days < (v_rules->>'short_days')::integer
                THEN (v_rules->>'cap_short')::integer ELSE (v_rules->>'cap_long')::integer END;
  v_quiet := COALESCE((SELECT s.quiet_hours FROM public.crm_email_settings s WHERE s.scope_key = v_key), true);

  DROP TABLE IF EXISTS _npl;
  CREATE TEMP TABLE _npl ON COMMIT DROP AS
  SELECT x->>'key' AS aud, x->>'moment' AS moment, (x->>'send_at')::timestamptz AS at,
         COALESCE((x->>'order')::integer, 99) AS rk, COALESCE((x->>'first_email')::integer, 0) AS fe,
         COALESCE((x->>'email')::integer, 0) AS em
    FROM jsonb_array_elements(COALESCE(v_plan->'steps', '[]'::jsonb)) st
   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(st->'audiences', '[]'::jsonb)) x
   WHERE (x->>'key') = ANY (p_audiences) AND COALESCE((x->>'n')::integer, 0) > 0;

  IF NOT EXISTS (SELECT 1 FROM _npl) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_audience');
  END IF;
  IF EXISTS (SELECT 1 FROM _npl n WHERE jsonb_typeof(p_contents->n.aud->'blocks') IS DISTINCT FROM 'array') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'content_missing',
      'audiences', (SELECT jsonb_agg(n.aud) FROM _npl n WHERE jsonb_typeof(p_contents->n.aud->'blocks') IS DISTINCT FROM 'array'));
  END IF;

  -- Coût au plus : chaque personne une fois, dans sa meilleure audience.
  SELECT COALESCE(sum(n.fe), 0)::int INTO v_cost FROM _npl n;
  v_cost := v_cost * GREATEST(1, COALESCE((public.crm_pricing_config()->'rates'->>'email')::integer, 1));

  INSERT INTO public.crm_night_plans (scope_key, venue_id, organizer_user_id, event_id, status, cap, config, accepted_by)
  VALUES (v_key, p_venue_id, v_org, p_event_id, 'setup', v_cap,
          COALESCE(p_config, '{}'::jsonb) || jsonb_build_object('audiences', to_jsonb(p_audiences), 'days_left', v_days,
                                                                 'demo', v_demo, 'cost', v_cost, 'reviewed', '[]'::jsonb),
          auth.uid())
  RETURNING id INTO v_pid;

  FOR a IN SELECT * FROM _npl ORDER BY rk LOOP
    IF a.moment IS DISTINCT FROM v_prev THEN
      v_k := 0;
      v_prev := a.moment;
    ELSE
      v_k := v_k + 1;
    END IF;
    v_at := GREATEST(a.at, now() + make_interval(mins => (v_rules->>'lead_min')::integer))
            + make_interval(mins => (v_rules->>'stagger_min')::integer * v_k);
    IF v_at > v_start - make_interval(hours => (v_rules->>'end_margin_h')::integer) THEN
      v_late := array_append(v_late, a.aud);
      CONTINUE;
    END IF;
    v_c := p_contents->a.aud;
    INSERT INTO public.email_campaigns (
      name, type, subject, preheader, blocks_json, blocks_version, theme_json, social_links_json, logo_url,
      event_id, audiences_json, audience_type, exclusions_json, template_kind, quiet_hours,
      status, scheduled_at, venue_id, organizer_user_id, created_by, product, night_plan_id, night_plan_step)
    VALUES (
      left(COALESCE(NULLIF(btrim(v_c->>'name'), ''), a.aud), 200), 'promotional',
      left(COALESCE(NULLIF(btrim(v_c->>'subject'), ''), '—'), 200), v_c->>'preheader',
      v_c->'blocks', 2, v_c->'theme', v_c->'socialLinks', v_c->>'logoUrl',
      p_event_id,
      jsonb_build_array(jsonb_build_object('kind', 'crm',
        'def', jsonb_build_object('seg', 'all', 'f', jsonb_build_object('ntgt', jsonb_build_object('e', p_event_id, 'a', a.aud))),
        'label', COALESCE(v_c->>'label', a.aud))),
      'imported_list', jsonb_build_object('excludeEventBuyers', true),
      left(COALESCE(NULLIF(btrim(v_c->>'templateKind'), ''), 'night_plan'), 40), v_quiet,
      'draft', v_at,
      p_venue_id, v_org, auth.uid(), 'crm', v_pid, a.aud)
    RETURNING id INTO v_cid;
    v_out := v_out || jsonb_build_object('id', v_cid, 'audience', a.aud, 'moment', a.moment, 'scheduled_at', v_at);
  END LOOP;

  IF jsonb_array_length(v_out) = 0 THEN
    RAISE EXCEPTION 'crm_night_plan_too_late' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('yuno.night_plan_write', 'off', true);
  RETURN jsonb_build_object('ok', true, 'plan_id', v_pid, 'cap', v_cap, 'demo', v_demo,
                            'campaigns', v_out, 'too_late', to_jsonb(v_late), 'cost', v_cost);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_night_plan_launch(text, uuid, uuid, text[], jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_plan_launch(text, uuid, uuid, text[], jsonb, jsonb) TO authenticated;

-- ── Étape 2 : un e-mail relu (retouché, ou gardé tel quel) ──────────────────
CREATE OR REPLACE FUNCTION public.crm_night_plan_review(
  p_venue_id text, p_organizer_user_id uuid, p_plan_id uuid, p_campaign_id uuid, p_reviewed boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_n   integer;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.crm_night_plans p
     SET config = jsonb_set(p.config, '{reviewed}',
           CASE WHEN p_reviewed
                THEN (SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(p.config->'reviewed', '[]'::jsonb) || to_jsonb(p_campaign_id::text)) x)
                ELSE (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements_text(COALESCE(p.config->'reviewed', '[]'::jsonb)) x WHERE x <> p_campaign_id::text) END),
         updated_at = now()
   WHERE p.id = p_plan_id AND p.scope_key = v_key
     AND EXISTS (SELECT 1 FROM public.email_campaigns c WHERE c.id = p_campaign_id AND c.night_plan_id = p.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n > 0);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_night_plan_review(text, uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_plan_review(text, uuid, uuid, uuid, boolean) TO authenticated;

-- ── Étape 3 : programmer ───────────────────────────────────────────────────
-- Identité d'expéditeur et Yunits vérifiés ici (et de nouveau à chaque départ).
-- Chaque e-mail garde sa date prévue, jamais moins de 15 min après maintenant,
-- dans l'ordre et à 15 min l'un de l'autre ; trop près de la soirée = il reste
-- un brouillon (`too_late`).
CREATE OR REPLACE FUNCTION public.crm_night_plan_schedule(p_venue_id text, p_organizer_user_id uuid, p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key   text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_rules jsonb := public.crm_night_plan_rules();
  p       public.crm_night_plans%ROWTYPE;
  v_ident jsonb;
  v_demo  boolean;
  v_cost  integer;
  v_bal   integer;
  v_start timestamptz;
  v_prev  timestamptz := now();
  v_at    timestamptz;
  v_n     integer := 0;
  v_late  jsonb := '[]'::jsonb;
  c       record;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'support_session');
  END IF;
  SELECT * INTO p FROM public.crm_night_plans WHERE id = p_plan_id AND scope_key = v_key FOR UPDATE;
  IF NOT FOUND OR p.status <> 'setup' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_setup');
  END IF;
  v_demo := COALESCE((p.config->>'demo')::boolean, false);
  IF NOT v_demo THEN
    v_ident := public._crm_email_identity(p_venue_id, p_organizer_user_id);
    IF NOT COALESCE((v_ident->>'ready')::boolean, false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'sender_identity', 'missing', v_ident->'missing');
    END IF;
    v_cost := COALESCE((p.config->>'cost')::integer, 0);
    v_bal := COALESCE(public.crm_yunits_balance(v_key), 0);
    IF v_bal < v_cost THEN
      RETURN jsonb_build_object('ok', false, 'error', 'yunits_short', 'needed', v_cost, 'balance', v_bal);
    END IF;
  END IF;
  SELECT e.start_at INTO v_start FROM public.events e WHERE e.id = p.event_id;

  FOR c IN SELECT ec.id, ec.night_plan_step, ec.scheduled_at FROM public.email_campaigns ec
            WHERE ec.night_plan_id = p.id AND ec.status = 'draft'
            ORDER BY ec.scheduled_at NULLS LAST, ec.created_at LOOP
    v_at := GREATEST(COALESCE(c.scheduled_at, now()), now() + interval '15 minutes',
                     CASE WHEN v_n > 0 THEN v_prev + make_interval(mins => (v_rules->>'stagger_min')::integer) END);
    IF v_at > v_start - make_interval(hours => (v_rules->>'end_margin_h')::integer) THEN
      v_late := v_late || to_jsonb(c.night_plan_step);
      CONTINUE;
    END IF;
    IF NOT v_demo THEN
      UPDATE public.email_campaigns SET status = 'scheduled', scheduled_at = v_at WHERE id = c.id;
    ELSE
      UPDATE public.email_campaigns SET scheduled_at = v_at WHERE id = c.id;
    END IF;
    v_prev := v_at;
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_late');
  END IF;
  UPDATE public.crm_night_plans SET status = 'active', updated_at = now() WHERE id = p.id;
  RETURN jsonb_build_object('ok', true, 'scheduled', v_n, 'too_late', v_late, 'demo', v_demo);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_night_plan_schedule(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_plan_schedule(text, uuid, uuid) TO authenticated;

-- ── Pause, reprise, arrêt ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_night_plan_set_status(
  p_venue_id text, p_organizer_user_id uuid, p_plan_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key   text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_rules jsonb := public.crm_night_plan_rules();
  p       public.crm_night_plans%ROWTYPE;
  v_start timestamptz;
  v_n     integer := 0;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.is_support_session() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'support_session');
  END IF;
  IF p_status NOT IN ('paused', 'active', 'stopped') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_status');
  END IF;
  SELECT * INTO p FROM public.crm_night_plans WHERE id = p_plan_id AND scope_key = v_key FOR UPDATE;
  IF NOT FOUND OR p.status NOT IN ('setup', 'active', 'paused') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_live');
  END IF;
  SELECT e.start_at INTO v_start FROM public.events e WHERE e.id = p.event_id;

  IF p.status = 'setup' THEN
    -- Abandon pendant la préparation : les brouillons du plan s'effacent.
    IF p_status <> 'stopped' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'in_setup');
    END IF;
    DELETE FROM public.email_campaigns c WHERE c.night_plan_id = p.id AND c.status = 'draft';
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSIF p_status IN ('paused', 'stopped') THEN
    UPDATE public.email_campaigns c SET status = 'draft'
     WHERE c.night_plan_id = p.id AND c.status = 'scheduled';
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSIF NOT COALESCE((p.config->>'demo')::boolean, false) THEN
    UPDATE public.email_campaigns c
       SET status = 'scheduled', scheduled_at = GREATEST(c.scheduled_at, now() + interval '15 minutes')
     WHERE c.night_plan_id = p.id AND c.status = 'draft' AND c.scheduled_at IS NOT NULL
       AND GREATEST(c.scheduled_at, now() + interval '15 minutes')
           <= v_start - make_interval(hours => (v_rules->>'end_margin_h')::integer);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  UPDATE public.crm_night_plans
     SET status = p_status, updated_at = now(),
         stop_reason = CASE WHEN p_status = 'stopped' THEN 'by_user' END
   WHERE id = p.id;
  RETURN jsonb_build_object('ok', true, 'status', p_status, 'campaigns', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_night_plan_set_status(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_plan_set_status(text, uuid, uuid, text) TO authenticated;

-- ── Balayage : soirée commencée, annulée, ou e-mail trop tard ──────────────
CREATE OR REPLACE FUNCTION public.crm_night_plan_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rules jsonb := public.crm_night_plan_rules();
  v_late  integer := 0;
  v_done  integer := 0;
  v_stop  integer := 0;
BEGIN
  -- Un e-mail du plan ne part jamais dans les 2 h avant la soirée.
  UPDATE public.email_campaigns c
     SET status = 'draft', paused_reason = 'night_plan_late'
    FROM public.crm_night_plans p JOIN public.events e ON e.id = p.event_id
   WHERE c.night_plan_id = p.id AND c.status = 'scheduled'
     AND c.scheduled_at > e.start_at - make_interval(hours => (v_rules->>'end_margin_h')::integer);
  GET DIAGNOSTICS v_late = ROW_COUNT;

  WITH s AS (
    UPDATE public.crm_night_plans p
       SET status = 'stopped', stop_reason = 'event_cancelled', updated_at = now()
      FROM public.events e
     WHERE e.id = p.event_id AND p.status IN ('setup', 'active', 'paused') AND e.cancelled_at IS NOT NULL
    RETURNING p.id
  ), d AS (
    UPDATE public.email_campaigns c SET status = 'draft', paused_reason = 'night_plan_stopped'
      FROM s WHERE c.night_plan_id = s.id AND c.status = 'scheduled'
    RETURNING 1
  )
  SELECT count(*) INTO v_stop FROM s;

  UPDATE public.crm_night_plans p
     SET status = 'stopped', stop_reason = 'event_started', updated_at = now()
    FROM public.events e
   WHERE e.id = p.event_id AND p.status = 'setup' AND e.start_at <= now();

  UPDATE public.crm_night_plans p
     SET status = 'done', updated_at = now()
    FROM public.events e
   WHERE e.id = p.event_id AND p.status IN ('active', 'paused') AND e.start_at <= now();
  GET DIAGNOSTICS v_done = ROW_COUNT;

  RETURN jsonb_build_object('late', v_late, 'stopped', v_stop, 'done', v_done);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_night_plan_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_night_plan_sweep() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('crm-night-plan-sweep') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm-night-plan-sweep');
  PERFORM cron.schedule('crm-night-plan-sweep', '4,19,34,49 * * * *', 'SELECT public.crm_night_plan_sweep()');
END
$$;

-- Contacté contre témoin : même règle que crm_holdout_overview (test de deux
-- proportions ; acheteurs en plus seulement à partir de 10 personnes par groupe).
CREATE OR REPLACE FUNCTION public._crm_night_plan_measure(p_c jsonb, p_t jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  WITH v AS (
    SELECT COALESCE((p_c->>'n')::numeric, 0) AS n1, COALESCE((p_c->>'buyers')::numeric, 0) AS b1,
           COALESCE((p_t->>'n')::numeric, 0) AS n2, COALESCE((p_t->>'buyers')::numeric, 0) AS b2
  ), q AS (
    SELECT v.*, CASE WHEN n1 > 0 AND n2 > 0 THEN (b1 + b2) / (n1 + n2) END AS pp FROM v
  )
  SELECT jsonb_build_object(
    'z', CASE WHEN n1 >= 10 AND n2 >= 10 AND pp > 0 AND pp < 1
              THEN round(((b1 / n1 - b2 / n2) / sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2)))::numeric, 2) END,
    'extra', CASE WHEN n1 >= 10 AND n2 >= 10 THEN round((n1 * (b1 / n1 - b2 / n2))::numeric, 1) END)
    FROM q;
$$;
REVOKE ALL ON FUNCTION public._crm_night_plan_measure(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_night_plan_measure(jsonb, jsonb) TO authenticated, service_role;

-- ── Le suivi d'un plan ─────────────────────────────────────────────────────
-- Agrégats seulement. « Acheteurs » = personnes qui ont reçu un e-mail du plan
-- puis acheté une place de CETTE soirée (une vente, _crm_ticket_is_sale) ;
-- le témoin = les mêmes personnes tenues à l'écart, comptées pareil.
CREATE OR REPLACE FUNCTION public._crm_night_plan_stats(p_plan_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH p AS (SELECT * FROM public.crm_night_plans WHERE id = p_plan_id),
  camp AS (
    SELECT c.* FROM public.email_campaigns c, p WHERE c.night_plan_id = p.id
  ), rec AS (
    SELECT r.campaign_id, lower(r.email) AS em, r.status, r.error_message,
           COALESCE(r.sent_at, r.created_at) AS t0
      FROM public.email_campaign_recipients r JOIN camp c ON c.id = r.campaign_id
  ), ev AS (
    SELECT e.campaign_id, e.event_type, count(DISTINCT lower(e.recipient_email))::int AS n
      FROM public.email_campaign_events e JOIN camp c ON c.id = e.campaign_id
     WHERE e.event_type IN ('opened', 'clicked')
     GROUP BY 1, 2
  ), people AS (
    SELECT rec.em,
           bool_or(rec.status = 'sent') AS contacted,
           bool_or(rec.status = 'skipped' AND rec.error_message = 'holdout') AND NOT bool_or(rec.status = 'sent') AS control,
           min(rec.t0) FILTER (WHERE rec.status = 'sent' OR rec.error_message = 'holdout') AS t0
      FROM rec GROUP BY rec.em
  ), bought AS (
    SELECT pe.em, pe.contacted, pe.control,
           (SELECT sum(COALESCE(t.price, 0)) FROM public.external_tickets t, p
             WHERE t.event_id = p.event_id AND lower(t.buyer_email) = pe.em
               AND public._crm_ticket_is_sale(t.status, t.deal_channel)
               AND COALESCE(t.purchased_at, t.first_seen_at) > pe.t0) AS amount
      FROM people pe WHERE pe.contacted OR pe.control
  )
  SELECT x || jsonb_build_object('measure', public._crm_night_plan_measure(x->'contacted', x->'control')) FROM (
  SELECT jsonb_build_object(
    'campaigns', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'audience', c.night_plan_step, 'status', c.status,
        'paused_reason', c.paused_reason, 'subject', c.subject, 'ai_author', c.ai_author, 'updated_at', c.updated_at,
        'reviewed', (c.id::text IN (SELECT jsonb_array_elements_text(COALESCE(p.config->'reviewed', '[]'::jsonb)) FROM p)
                     OR c.ai_updated_at IS NOT NULL OR c.updated_at > c.created_at + interval '10 seconds'),
        'edited_by', CASE WHEN c.ai_updated_at IS NOT NULL THEN 'ai'
                          WHEN c.updated_at > c.created_at + interval '10 seconds' THEN 'hand' END,
        'scheduled_at', c.scheduled_at, 'sent_at', c.sent_at,
        'sent', (SELECT count(*) FROM rec WHERE rec.campaign_id = c.id AND rec.status = 'sent'),
        'pending', (SELECT count(*) FROM rec WHERE rec.campaign_id = c.id AND rec.status IN ('pending', 'sending')),
        'holdout', (SELECT count(*) FROM rec WHERE rec.campaign_id = c.id AND rec.status = 'skipped' AND rec.error_message = 'holdout'),
        'protected', (SELECT COALESCE(jsonb_object_agg(x.reason, x.n), '{}'::jsonb) FROM (
            SELECT replace(COALESCE(rec.error_message, rec.status), 'policy:', '') AS reason, count(*)::int AS n
              FROM rec WHERE rec.campaign_id = c.id
               AND (rec.status = 'suppressed' OR (rec.status = 'skipped' AND rec.error_message IS DISTINCT FROM 'holdout'))
             GROUP BY 1) x),
        'opened', COALESCE((SELECT ev.n FROM ev WHERE ev.campaign_id = c.id AND ev.event_type = 'opened'), 0),
        'clicked', COALESCE((SELECT ev.n FROM ev WHERE ev.campaign_id = c.id AND ev.event_type = 'clicked'), 0),
        'buyers', (SELECT count(DISTINCT b.em) FROM bought b
                    JOIN rec ON rec.em = b.em AND rec.campaign_id = c.id AND rec.status = 'sent'
                   WHERE b.amount IS NOT NULL)
      ) ORDER BY c.scheduled_at NULLS LAST, c.created_at) FROM camp c), '[]'::jsonb),
    'contacted', jsonb_build_object(
        'n', (SELECT count(*) FROM bought WHERE contacted),
        'buyers', (SELECT count(*) FROM bought WHERE contacted AND amount IS NOT NULL),
        'revenue', (SELECT COALESCE(sum(amount), 0) FROM bought WHERE contacted)),
    'control', jsonb_build_object(
        'n', (SELECT count(*) FROM bought WHERE control),
        'buyers', (SELECT count(*) FROM bought WHERE control AND amount IS NOT NULL))) AS x) z;
$$;
REVOKE ALL ON FUNCTION public._crm_night_plan_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._crm_night_plan_stats(uuid) TO service_role;

-- Un plan d'une soirée (le vivant, sinon le dernier).
CREATE OR REPLACE FUNCTION public.crm_night_plan_get(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  p     public.crm_night_plans%ROWTYPE;
  e     record;
  v_out jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.crm_night_plans
   WHERE scope_key = v_key AND event_id = p_event_id
   ORDER BY (status IN ('setup', 'active', 'paused')) DESC, created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'plan', NULL);
  END IF;
  SELECT ev.id, ev.title, ev.start_at, ev.image_url AS cover_url INTO e FROM public.events ev WHERE ev.id = p.event_id;
  v_out := jsonb_build_object('ok', true, 'rules', public.crm_night_plan_rules(),
    'holdout_pct', public.crm_holdout_pct(v_key),
    'event', jsonb_build_object('id', e.id, 'title', e.title, 'start_at', e.start_at, 'cover_url', e.cover_url),
    'plan', jsonb_build_object('id', p.id, 'status', p.status, 'stop_reason', p.stop_reason, 'cap', p.cap,
                               'config', p.config, 'created_at', p.created_at, 'updated_at', p.updated_at)
             || public._crm_night_plan_stats(p.id));
  RETURN public._crm_money_gate(v_out, p_venue_id, p_organizer_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_night_plan_get(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_plan_get(text, uuid, uuid) TO authenticated;

-- La page « Plans de soirée » : en cours, à préparer, terminés.
CREATE OR REPLACE FUNCTION public.crm_night_plans_list(p_venue_id text, p_organizer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_out jsonb;
BEGIN
  IF NOT COALESCE(public.crm_scope_allowed(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  WITH nights AS (
    SELECT ev.id, ev.title, ev.start_at, ev.image_url AS cover_url
      FROM public.events ev
     WHERE ev.external_source IS NOT NULL AND ev.cancelled_at IS NULL
       AND ((p_venue_id IS NOT NULL AND ev.venue_id = p_venue_id)
         OR (p_venue_id IS NULL AND p_organizer_user_id IS NOT NULL AND ev.organizer_user_id = p_organizer_user_id))
  ), plans AS (
    SELECT DISTINCT ON (p.event_id) p.*
      FROM public.crm_night_plans p
     WHERE p.scope_key = v_key
     ORDER BY p.event_id, (p.status IN ('setup', 'active', 'paused')) DESC, p.created_at DESC
  ), rows AS (
    SELECT n.*, pl.id AS plan_id, pl.status AS plan_status, pl.created_at AS plan_created,
           CASE WHEN pl.id IS NOT NULL THEN public._crm_night_plan_stats(pl.id) END AS stats,
           (SELECT min(c.scheduled_at) FROM public.email_campaigns c
             WHERE c.night_plan_id = pl.id AND c.status = 'scheduled') AS next_at
      FROM nights n LEFT JOIN plans pl ON pl.event_id = n.id
  )
  SELECT jsonb_build_object('ok', true,
    'live', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'event', jsonb_build_object('id', r.id, 'title', r.title, 'start_at', r.start_at, 'cover_url', r.cover_url),
        'plan_id', r.plan_id, 'status', r.plan_status, 'next_at', r.next_at,
        'contacted', r.stats->'contacted', 'control', r.stats->'control',
        'campaigns', jsonb_array_length(COALESCE(r.stats->'campaigns', '[]'::jsonb)),
        'sent', (SELECT COALESCE(sum((x->>'sent')::int), 0) FROM jsonb_array_elements(r.stats->'campaigns') x))
      ORDER BY r.start_at) FROM rows r WHERE r.plan_status IN ('setup', 'active', 'paused')), '[]'::jsonb),
    'todo', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'event', jsonb_build_object('id', r.id, 'title', r.title, 'start_at', r.start_at, 'cover_url', r.cover_url),
        'days_left', GREATEST(0, (r.start_at::date - now()::date)))
      ORDER BY r.start_at) FROM rows r
      WHERE r.start_at > now() + interval '3 hours' AND (r.plan_status IS NULL OR r.plan_status = 'stopped')), '[]'::jsonb),
    'past', COALESCE((SELECT jsonb_agg(x ORDER BY (x->'event'->>'start_at') DESC) FROM (
        SELECT jsonb_build_object(
          'event', jsonb_build_object('id', r.id, 'title', r.title, 'start_at', r.start_at, 'cover_url', r.cover_url),
          'plan_id', r.plan_id, 'status', r.plan_status,
          'contacted', r.stats->'contacted', 'control', r.stats->'control',
          'sent', (SELECT COALESCE(sum((x->>'sent')::int), 0) FROM jsonb_array_elements(r.stats->'campaigns') x)) AS x
          FROM rows r WHERE r.plan_status = 'done' AND r.start_at > now() - interval '180 days'
         LIMIT 30) z), '[]'::jsonb))
    INTO v_out;
  RETURN public._crm_money_gate(v_out, p_venue_id, p_organizer_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_night_plans_list(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_plans_list(text, uuid) TO authenticated;

-- Détacher un e-mail du plan : il redevient un e-mail ordinaire (le pro
-- retrouve la main sur l'audience ; les règles du plan ne le gardent plus).
CREATE OR REPLACE FUNCTION public.crm_night_plan_detach(p_venue_id text, p_organizer_user_id uuid, p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT COALESCE(public.crm_scope_writable(p_venue_id, p_organizer_user_id), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('yuno.night_plan_write', 'on', true);
  UPDATE public.email_campaigns c SET night_plan_id = NULL, night_plan_step = NULL
   WHERE c.id = p_campaign_id AND c.status IN ('draft', 'scheduled')
     AND c.venue_id IS NOT DISTINCT FROM p_venue_id
     AND (p_venue_id IS NOT NULL OR c.organizer_user_id = p_organizer_user_id)
     AND c.night_plan_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n > 0);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_night_plan_detach(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_night_plan_detach(text, uuid, uuid) TO authenticated;

-- ── « Dernier appel » s'efface sur une soirée dont le plan a sa dernière
-- ligne droite (sinon deux e-mails la veille). Remplacement ciblé, dans la
-- seule branche last_call de collect_email_automations.
DO $$
DECLARE
  v_def  text;
  v_head text;
  v_tail text;
  v_pos  integer;
  m0 text := 'ELSIF a.kind = ''last_call'' THEN';
  m1 text := E'           AND e.start_at > now() + interval ''2 hours''\n';
BEGIN
  v_def := pg_get_functiondef('public.collect_email_automations()'::regprocedure);
  v_pos := position(m0 IN v_def);
  IF v_pos = 0 THEN
    RAISE EXCEPTION 'collect_email_automations : branche last_call introuvable';
  END IF;
  v_head := left(v_def, v_pos - 1);
  v_tail := substr(v_def, v_pos);
  IF position(m1 IN v_tail) = 0 OR position(m1 IN v_tail) > 2500 THEN
    RAISE EXCEPTION 'collect_email_automations : repère de last_call introuvable';
  END IF;
  v_tail := overlay(v_tail PLACING m1 || $r$           -- Plan de soirée (20261122100000) : sa dernière ligne droite tient lieu de dernier appel.
           AND NOT EXISTS (SELECT 1 FROM public.crm_night_plans np
                             JOIN public.email_campaigns nc ON nc.night_plan_id = np.id
                            WHERE np.event_id = e.id AND np.status IN ('active', 'paused', 'done')
                              AND nc.night_plan_step = 'last_minute' AND nc.status IN ('scheduled', 'sending', 'sent'))
$r$ FROM position(m1 IN v_tail) FOR length(m1));
  EXECUTE v_head || v_tail;
END
$$;
