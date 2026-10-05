-- ============================================================================
-- Yuno CRM — Admin CRM, lot 3 : Vente, Acquisition, Produit et valeur.
--
-- · crm_prospects (+ crm_prospect_events) : le pipeline commercial du fondateur
--   (qui il a approché, où ça en est, la prochaine action). RLS sans policy :
--   tout passe par les RPC `crm_admin_prospect*`, réservées au super admin.
--   Les colonnes Essai et Payant du pipeline ne sont PAS saisies : elles se
--   lisent dans les comptes réels (crm_admin_pipeline).
-- · crm_admin_acquisition(démo, jours) : l'entonnoir RÉEL des inscriptions
--   (pro_signups, produit CRM), les parcours un par un, les sources et ce
--   qu'elles amènent en payants. Les visites de la landing, la profondeur de
--   lecture et les tests A/B n'existent pas en base : ils ne sont pas rendus.
-- · crm_admin_product(démo) : qui utilise quoi (sur les comptes réels), délais
--   avant la première valeur, demandes de fonctionnalités (liste d'attente).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.crm_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  contact text,
  phone text,
  email text,
  city text,
  kind text NOT NULL DEFAULT 'club' CHECK (kind IN ('club', 'organizer', 'association')),
  source text,
  stage text NOT NULL DEFAULT 'prospect' CHECK (stage IN ('prospect', 'contacted', 'demo', 'lost')),
  next_action text,
  next_at date,
  loss_reason text,
  note text,
  opposed boolean NOT NULL DEFAULT false,
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_prospects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_prospects FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.crm_prospect_events (
  id bigserial PRIMARY KEY,
  prospect_id uuid NOT NULL REFERENCES public.crm_prospects(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  by_user uuid,
  kind text NOT NULL CHECK (kind IN ('created', 'stage', 'exchange')),
  text text NOT NULL
);
ALTER TABLE public.crm_prospect_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_prospect_events FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS crm_prospect_events_idx ON public.crm_prospect_events (prospect_id, at DESC);

-- Le pipeline : prospects saisis + comptes réels (essai, payant, perdu).
CREATE OR REPLACE FUNCTION public.crm_admin_pipeline(p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM public._crm_admin_gate();
  v_rows := public._crm_admin_rows(p_include_demo);
  RETURN jsonb_build_object(
    'at', now(),
    'prospects', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'contact', p.contact, 'phone', p.phone, 'email', p.email, 'city', p.city, 'kind', p.kind,
        'source', p.source, 'stage', p.stage, 'next_action', p.next_action, 'next_at', p.next_at, 'loss_reason', p.loss_reason,
        'note', p.note, 'opposed', p.opposed, 'stage_changed_at', p.stage_changed_at, 'created_at', p.created_at,
        'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'text', e.text) ORDER BY e.at DESC)
                              FROM (SELECT * FROM public.crm_prospect_events WHERE prospect_id = p.id ORDER BY at DESC LIMIT 12) e), '[]'::jsonb))
        ORDER BY p.updated_at DESC) FROM public.crm_prospects p), '[]'::jsonb),
    'accounts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r->>'id', 'name', r->>'name', 'city', r->>'city', 'state', r->>'state',
        'mrr', r->'mrr', 'trial_left', r->'trial_left', 'type', r->>'type') ORDER BY r->>'name') FROM jsonb_array_elements(v_rows) r), '[]'::jsonb),
    'price', (public.crm_pricing_config()->>'price_month')::numeric);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_pipeline(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_pipeline(boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_prospect_save(p_id uuid, p_patch jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_old public.crm_prospects%ROWTYPE;
  v_stage text;
BEGIN
  PERFORM public._crm_admin_gate();
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'bad_patch' USING ERRCODE = '22023'; END IF;
  IF v_id IS NULL THEN
    IF length(trim(COALESCE(p_patch->>'name', ''))) = 0 THEN RAISE EXCEPTION 'name_required' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.crm_prospects (name, contact, phone, email, city, kind, source, stage, next_action, next_at, note, created_by)
    VALUES (left(trim(p_patch->>'name'), 120), left(p_patch->>'contact', 120), left(p_patch->>'phone', 40), left(p_patch->>'email', 160), left(p_patch->>'city', 80),
            COALESCE(NULLIF(p_patch->>'kind', ''), 'club'), left(p_patch->>'source', 80), COALESCE(NULLIF(p_patch->>'stage', ''), 'prospect'),
            left(p_patch->>'next_action', 200), NULLIF(p_patch->>'next_at', '')::date, left(p_patch->>'note', 2000), auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO public.crm_prospect_events (prospect_id, by_user, kind, text) VALUES (v_id, auth.uid(), 'created', 'created');
    RETURN v_id;
  END IF;
  SELECT * INTO v_old FROM public.crm_prospects WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  v_stage := COALESCE(NULLIF(p_patch->>'stage', ''), v_old.stage);
  IF v_stage = 'lost' AND length(trim(COALESCE(p_patch->>'loss_reason', v_old.loss_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'loss_reason_required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.crm_prospects SET
      name = COALESCE(left(NULLIF(trim(p_patch->>'name'), ''), 120), name),
      contact = CASE WHEN p_patch ? 'contact' THEN left(p_patch->>'contact', 120) ELSE contact END,
      phone = CASE WHEN p_patch ? 'phone' THEN left(p_patch->>'phone', 40) ELSE phone END,
      email = CASE WHEN p_patch ? 'email' THEN left(p_patch->>'email', 160) ELSE email END,
      city = CASE WHEN p_patch ? 'city' THEN left(p_patch->>'city', 80) ELSE city END,
      kind = COALESCE(NULLIF(p_patch->>'kind', ''), kind),
      source = CASE WHEN p_patch ? 'source' THEN left(p_patch->>'source', 80) ELSE source END,
      stage = v_stage,
      next_action = CASE WHEN p_patch ? 'next_action' THEN left(p_patch->>'next_action', 200) ELSE next_action END,
      next_at = CASE WHEN p_patch ? 'next_at' THEN NULLIF(p_patch->>'next_at', '')::date ELSE next_at END,
      loss_reason = CASE WHEN v_stage = 'lost' THEN left(COALESCE(p_patch->>'loss_reason', loss_reason), 200) ELSE NULL END,
      note = CASE WHEN p_patch ? 'note' THEN left(p_patch->>'note', 2000) ELSE note END,
      opposed = CASE WHEN p_patch ? 'opposed' THEN (p_patch->>'opposed')::boolean ELSE opposed END,
      stage_changed_at = CASE WHEN v_stage <> v_old.stage THEN now() ELSE stage_changed_at END,
      updated_at = now()
    WHERE id = v_id;
  IF v_stage <> v_old.stage THEN
    INSERT INTO public.crm_prospect_events (prospect_id, by_user, kind, text) VALUES (v_id, auth.uid(), 'stage', v_old.stage || '>' || v_stage);
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_prospect_save(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_prospect_save(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_prospect_log(p_id uuid, p_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._crm_admin_gate();
  IF length(trim(COALESCE(p_text, ''))) = 0 THEN RAISE EXCEPTION 'text_required' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_prospects WHERE id = p_id) THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.crm_prospect_events (prospect_id, by_user, kind, text) VALUES (p_id, auth.uid(), 'exchange', left(trim(p_text), 500));
  UPDATE public.crm_prospects SET updated_at = now() WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_prospect_log(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_prospect_log(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_admin_prospect_delete(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._crm_admin_gate();
  DELETE FROM public.crm_prospects WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_prospect_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_prospect_delete(uuid) TO authenticated, service_role;

-- ── Acquisition ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_acquisition(p_include_demo boolean DEFAULT false, p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := CASE WHEN p_days IN (7, 30, 90) THEN p_days ELSE 30 END;
  v_start timestamptz := now() - v_days * interval '1 day';
  v_rows jsonb;
  v_demo_u uuid[];
  v_funnel jsonb; v_sessions jsonb; v_sources jsonb; v_devices jsonb; v_series jsonb; v_med numeric;
BEGIN
  PERFORM public._crm_admin_gate();
  v_rows := public._crm_admin_rows(p_include_demo);
  SELECT COALESCE(array_agg(id), '{}') INTO v_demo_u FROM public.profiles WHERE public.is_demo_email(email);

  DROP TABLE IF EXISTS _as;
  CREATE TEMP TABLE _as ON COMMIT DROP AS
    SELECT p.*,
           (SELECT r->>'state' FROM jsonb_array_elements(v_rows) r
             WHERE (r->>'organizer_user_id')::uuid = p.user_id
                OR (r->>'venue_id') IN (SELECT v.id FROM public.venues v WHERE v.owner_id = p.user_id) LIMIT 1) AS acc_state
      FROM public.pro_signups p
     WHERE p.product = 'crm' AND p.created_at >= v_start
       AND (p_include_demo OR ((p.user_id IS NULL OR NOT (p.user_id = ANY(v_demo_u))) AND (p.email IS NULL OR NOT public.is_demo_email(p.email))));

  SELECT jsonb_build_array(
      jsonb_build_object('k', 'opened', 'n', (SELECT count(*) FROM _as)),
      jsonb_build_object('k', 'role', 'n', (SELECT count(*) FROM _as WHERE steps ? 'role')),
      jsonb_build_object('k', 'structure', 'n', (SELECT count(*) FROM _as WHERE steps ? 'structure')),
      jsonb_build_object('k', 'account', 'n', (SELECT count(*) FROM _as WHERE steps ? 'account' OR account_created_at IS NOT NULL)),
      jsonb_build_object('k', 'created', 'n', (SELECT count(*) FROM _as WHERE account_created_at IS NOT NULL)),
      jsonb_build_object('k', 'console', 'n', (SELECT count(*) FROM _as WHERE console_opened_at IS NOT NULL)),
      jsonb_build_object('k', 'paid', 'n', (SELECT count(*) FROM _as WHERE acc_state IN ('paid', 'late'))))
    INTO v_funnel;

  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM account_created_at - created_at)) INTO v_med
    FROM _as WHERE account_created_at IS NOT NULL;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'at' DESC), '[]'::jsonb) INTO v_sessions FROM (
    SELECT jsonb_build_object('at', s.updated_at, 'started', s.created_at,
             'who', CASE WHEN s.email IS NULL OR s.email = '' THEN NULL ELSE left(split_part(s.email, '@', 1), 2) || '•••@' || split_part(s.email, '@', 2) END,
             'org', s.org_name, 'city', s.city, 'last_step', s.last_step, 'steps', COALESCE(s.steps, '{}'::jsonb),
             'source', COALESCE(NULLIF(s.source, ''), NULLIF(s.utm_source, '')), 'device', s.device, 'account', s.account_created_at IS NOT NULL,
             'state', s.acc_state, 'secs', extract(epoch FROM s.updated_at - s.created_at)::int) AS x
      FROM _as s ORDER BY s.updated_at DESC LIMIT 40) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('source', src, 'started', n, 'created', c, 'paid', pd) ORDER BY pd DESC, c DESC, n DESC), '[]'::jsonb) INTO v_sources FROM (
    SELECT COALESCE(NULLIF(source, ''), NULLIF(utm_source, ''), 'direct') AS src, count(*) AS n,
           count(*) FILTER (WHERE account_created_at IS NOT NULL) AS c, count(*) FILTER (WHERE acc_state IN ('paid', 'late')) AS pd
      FROM _as GROUP BY 1) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('device', d, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_devices FROM (
    SELECT COALESCE(device, 'unknown') AS d, count(*) AS n FROM _as GROUP BY 1) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('t', d, 'started', (SELECT count(*) FROM _as WHERE created_at::date = d::date),
                    'created', (SELECT count(*) FROM _as WHERE account_created_at::date = d::date)) ORDER BY d), '[]'::jsonb) INTO v_series
    FROM generate_series((now() - (v_days - 1) * interval '1 day')::date, now()::date, interval '1 day') d;

  RETURN jsonb_build_object('at', now(), 'days', v_days, 'funnel', v_funnel, 'median_secs', v_med, 'sessions', v_sessions,
                            'sources', v_sources, 'devices', v_devices, 'series', v_series);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_acquisition(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_acquisition(boolean, integer) TO authenticated, service_role;

-- ── Produit et valeur ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_admin_product(p_include_demo boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_ids text[];
  v_usage jsonb; v_ttv jsonb; v_wait jsonb; v_recipes jsonb; v_retention jsonb;
  v_live integer; v_paid integer;
BEGIN
  PERFORM public._crm_admin_gate();
  v_rows := public._crm_admin_rows(p_include_demo);
  SELECT COALESCE(array_agg(r->>'id'), '{}') INTO v_ids FROM jsonb_array_elements(v_rows) r WHERE r->>'state' <> 'churned';
  SELECT count(*), count(*) FILTER (WHERE r->>'state' IN ('paid', 'late')) INTO v_live, v_paid FROM jsonb_array_elements(v_rows) r WHERE r->>'state' <> 'churned';

  -- Qui utilise quoi : les sept étapes, sur les comptes vivants.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('step', i, 'n',
           (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'state' <> 'churned' AND (r->'ob'->>i)::boolean),
           'paid', (SELECT count(*) FROM jsonb_array_elements(v_rows) r WHERE r->>'state' IN ('paid', 'late') AND (r->'ob'->>i)::boolean)) ORDER BY i), '[]'::jsonb)
    INTO v_usage FROM generate_series(0, 6) i;

  -- Délais médians depuis l'inscription, en jours.
  WITH acc AS (
    SELECT r->>'id' AS id, (r->>'signup_at')::timestamptz AS signup_at, (r->>'sub_created')::timestamptz AS sub_at,
           (r->>'venue_id') AS vid, (r->>'organizer_user_id')::uuid AS oid
      FROM jsonb_array_elements(v_rows) r WHERE r->>'signup_at' IS NOT NULL
  ), t AS (
    SELECT a.id, a.signup_at,
           (SELECT c.initial_import_done_at FROM public.ticketing_connections c WHERE (a.vid IS NOT NULL AND c.venue_id = a.vid) OR (a.oid IS NOT NULL AND c.organizer_user_id = a.oid) ORDER BY c.created_at LIMIT 1) AS synced_at,
           (SELECT min(COALESCE(e.sent_at, e.send_started_at)) FROM public.email_campaigns e WHERE e.automation_id IS NULL AND e.status IN ('sent', 'sending')
              AND ((a.vid IS NOT NULL AND e.venue_id = a.vid) OR (a.oid IS NOT NULL AND e.organizer_user_id = a.oid))) AS sent_at,
           (SELECT min(l.created_at) FROM public.crm_yunit_lots l WHERE l.scope_key = a.id AND l.kind = 'purchase') AS bought_at
      FROM acc a
  )
  SELECT jsonb_build_object(
      'n', count(*),
      'sync', percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM synced_at - signup_at) / 86400) FILTER (WHERE synced_at IS NOT NULL),
      'sent', percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM sent_at - signup_at) / 86400) FILTER (WHERE sent_at IS NOT NULL),
      'bought', percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM bought_at - signup_at) / 86400) FILTER (WHERE bought_at IS NOT NULL),
      'n_sync', count(*) FILTER (WHERE synced_at IS NOT NULL), 'n_sent', count(*) FILTER (WHERE sent_at IS NOT NULL), 'n_bought', count(*) FILTER (WHERE bought_at IS NOT NULL))
    INTO v_ttv FROM t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('feature', feature, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_wait FROM (
    SELECT feature, count(*) AS n FROM public.crm_feature_waitlist WHERE scope_key = ANY(v_ids) OR scope_key IS NULL GROUP BY feature) q;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'n', n) ORDER BY n DESC), '[]'::jsonb) INTO v_recipes FROM (
    SELECT a.kind, count(*) AS n FROM public.email_automations a
     WHERE a.enabled AND public.crm_scope_key(a.venue_id, a.organizer_user_id) = ANY(v_ids) GROUP BY a.kind) q;

  -- Ce qui fait rester : part de payants selon le nombre de recettes allumées.
  SELECT jsonb_build_object(
      'with_recipes', count(*) FILTER (WHERE (r->>'recipes')::int >= 3),
      'with_recipes_paid', count(*) FILTER (WHERE (r->>'recipes')::int >= 3 AND r->>'state' IN ('paid', 'late')),
      'without', count(*) FILTER (WHERE (r->>'recipes')::int < 3),
      'without_paid', count(*) FILTER (WHERE (r->>'recipes')::int < 3 AND r->>'state' IN ('paid', 'late')))
    INTO v_retention FROM jsonb_array_elements(v_rows) r WHERE r->>'state' <> 'churned';

  RETURN jsonb_build_object('at', now(), 'live', v_live, 'paid', v_paid, 'usage', v_usage, 'ttv', v_ttv, 'waitlist', v_wait, 'recipes', v_recipes, 'retention', v_retention);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_product(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_product(boolean) TO authenticated, service_role;
