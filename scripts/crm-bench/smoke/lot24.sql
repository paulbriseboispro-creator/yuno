-- Smoke de la répétition des migrations 20261014100000 → 130000 (lots 2 à 4),
-- sur le compte démo CRM (crm@womber.fr) SEULEMENT. Joué par rehearse.mjs dans
-- la même transaction que les migrations ; l'exception finale annule tout.
DO $smoke$
DECLARE
  v_org   uuid := (SELECT id FROM auth.users WHERE email = 'crm@womber.fr');
  v_key   text;
  v_ev    uuid;
  v_t     timestamptz;
  v_out   jsonb := '{}'::jsonb;
  v_r     jsonb;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'demo account missing'; END IF;
  v_key := 'org:' || v_org;
  SELECT e.event_id INTO v_ev FROM public.external_events e
   WHERE e.organizer_user_id = v_org AND e.start_at > now() ORDER BY e.start_at LIMIT 1;

  -- 0. L'état d'avant (statuts, modèle).
  v_out := v_out || jsonb_build_object(
    'before_supported', (SELECT jsonb_agg(family ORDER BY family) FROM public.crm_family_status
                          WHERE scope_key = v_key AND variant = '' AND status = 'supported'),
    'before_model', (SELECT jsonb_build_object('status', m.status, 'features', cardinality(m.features),
                       'auc', m.metrics->'valid'->'auc', 'auc_active', m.metrics->'valid'->'active'->'auc', 'ece', m.metrics->'valid'->'ece')
                       FROM public.crm_score_model m WHERE m.scope_key = v_key),
    'before_expected', (SELECT round(sum(p)) FROM public.crm_person_night_score WHERE scope_key = v_key));

  -- 1. La nuit suivante (le calcul d'avant reculé d'un jour : « 2 jours de suite »).
  UPDATE public.crm_family_status SET computed_at = computed_at - interval '1 day' WHERE scope_key = v_key;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_t := clock_timestamp();
  v_r := public.crm_analysis_compute(NULL, v_org, true, 0);
  v_out := v_out || jsonb_build_object('analysis_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000), 'engine', v_r->'engine');
  v_out := v_out || jsonb_build_object(
    'after_supported', (SELECT jsonb_agg(family ORDER BY family) FROM public.crm_family_status
                         WHERE scope_key = v_key AND variant = '' AND status = 'supported'),
    'after_statuses', (SELECT jsonb_object_agg(z.family, z.s) FROM (
                         SELECT family, status || ' j' || supported_runs || ' p' || COALESCE(round((detail->>'p')::numeric, 4)::text, '-')
                                || CASE WHEN (detail->>'bh')::boolean THEN ' bh' ELSE '' END AS s
                           FROM public.crm_family_status WHERE scope_key = v_key AND variant = '') z));

  v_t := clock_timestamp();
  v_r := public.crm_score_compute(NULL, v_org);
  v_out := v_out || jsonb_build_object('score_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000), 'score', v_r - 'scope');
  v_out := v_out || jsonb_build_object(
    'model', (SELECT jsonb_build_object('status', m.status, 'features', m.features, 'valid', m.metrics->'valid',
                                         'baseline_active', m.metrics->'baseline'->'active'->'auc',
                                         'backtest', m.metrics->'backtest', 'recent', m.metrics->'recent')
                FROM public.crm_score_model m WHERE m.scope_key = v_key),
    'after_expected', (SELECT round(sum(p)) FROM public.crm_person_night_score WHERE scope_key = v_key),
    'scored', (SELECT count(*) FROM public.crm_person_night_score WHERE scope_key = v_key),
    'reasons', (SELECT jsonb_object_agg(z.k, z.n) FROM (
                  SELECT x.k, count(*) AS n FROM public.crm_person_night_score s CROSS JOIN LATERAL unnest(s.reasons) x(k)
                   WHERE s.scope_key = v_key GROUP BY 1) z),
    'reasons_blocked', (SELECT count(*) FROM public.crm_person_night_score s CROSS JOIN LATERAL unnest(s.reasons) x(k)
                         WHERE s.scope_key = v_key AND public._crm_score_reason_family(x.k) IN (
                           SELECT family FROM public.crm_family_status WHERE scope_key = v_key AND variant = '' AND status = 'not_supported')),
    'remaining_share', (SELECT jsonb_object_agg(event_id, round(remaining_share::numeric, 2)) FROM public.crm_score_night WHERE scope_key = v_key));
  -- 2e nuit du score : départ à chaud (mêmes facteurs).
  v_t := clock_timestamp();
  v_r := public.crm_score_compute(NULL, v_org);
  v_out := v_out || jsonb_build_object('score_warm_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000));

  -- 2. Le collecteur SMS de la recette (aucune recette en prod : rien à faire, sans erreur).
  v_out := v_out || jsonb_build_object('first_return_collect', public.crm_first_return_sms_collect());

  -- 3. Lectures d'écran, en tant que titulaire du compte démo.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  v_t := clock_timestamp();
  v_r := public.crm_automations(NULL, v_org, '30d');
  v_out := v_out || jsonb_build_object('automations_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000),
    'first_return_sms', (SELECT r->'sms' FROM jsonb_array_elements(v_r->'recipes') r WHERE r->>'kind' = 'first_return'));
  IF v_ev IS NOT NULL THEN
    v_t := clock_timestamp();
    v_r := public.crm_night_targets(NULL, v_org, v_ev);
    v_out := v_out || jsonb_build_object('targets_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000),
      'targets', (SELECT jsonb_agg(jsonb_build_object('k', a->>'key', 'o', a->'order', 'n', a->'n', 'new', a->'new_n',
                                                       'exp', a->'expected', 'ov', a->'overlap'))
                    FROM jsonb_array_elements(v_r->'audiences') a));
  END IF;

  RAISE EXCEPTION 'SMOKE_OK %', v_out::text;
END
$smoke$;
