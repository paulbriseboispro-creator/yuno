-- Scénarios + agents (lots J1 → A5) sur la PROD, annulé (rehearse.mjs) :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/journeys.sql \
--     20261016100000_crm_scenario_conditions.sql … 20261016180000_crm_admin_daily.sql \
--     scripts/demo/seed-crm-journeys.sql
-- Après les migrations et le semis démo : chaque écran lu en tant que titulaire
-- du compte démo CRM, puis une passe du moteur et le bilan quotidien de l'Admin.
-- Chaque appel est isolé : une erreur est notée et fait finir en SMOKE_FAIL
-- (donc ÉCHEC côté rehearse.mjs) ; tout est annulé dans les deux cas.
DO $smoke$
DECLARE
  v_org  uuid := (SELECT id FROM auth.users WHERE email = 'crm@womber.fr');
  v_ms   jsonb := '{}'::jsonb;
  v_out  jsonb := '{}'::jsonb;
  v_err  jsonb := '{}'::jsonb;
  v_t    timestamptz;
  v_r    jsonb;
  v_list jsonb;
  v_loyal uuid;
  v_draft uuid;
  v_tree jsonb;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'SMOKE_FAIL compte démo crm@womber.fr introuvable'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);

  -- Liste des scénarios (onglet Scénarios).
  BEGIN
    v_t := clock_timestamp();
    v_list := public.crm_scenarios(NULL, v_org)->'scenarios';
    v_ms := v_ms || jsonb_build_object('list', round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
    v_out := v_out || jsonb_build_object('scenarios', (SELECT jsonb_agg(jsonb_build_object('t', x->>'template', 's', x->>'state', 'in', x->'entered', 'goal', x->'goal')) FROM jsonb_array_elements(v_list) x));
    SELECT (x->>'id')::uuid INTO v_loyal FROM jsonb_array_elements(v_list) x WHERE x->>'template' = 'loyal_no_ticket';
    SELECT (x->>'id')::uuid INTO v_draft FROM jsonb_array_elements(v_list) x WHERE x->>'state' = 'draft' LIMIT 1;
  EXCEPTION WHEN others THEN v_err := v_err || jsonb_build_object('list', SQLSTATE || ' ' || SQLERRM);
  END;

  -- Rapport, éditeur, effectif d'un groupe, « Avant de publier ».
  IF v_loyal IS NOT NULL THEN
    BEGIN
      v_t := clock_timestamp();
      v_r := public.crm_scenario_report(NULL, v_org, v_loyal);
      v_ms := v_ms || jsonb_build_object('report', round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
      v_out := v_out || jsonb_build_object('report_e1', v_r->'nodes'->'e1', 'holdout', v_r->'holdout');
    EXCEPTION WHEN others THEN v_err := v_err || jsonb_build_object('report', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      v_t := clock_timestamp();
      v_r := public.crm_scenario(NULL, v_org, v_loyal);
      v_tree := v_r->'live'->'graph'->'entry'->'filter';
      v_ms := v_ms || jsonb_build_object('editor', round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
      IF v_tree IS NOT NULL AND v_tree <> 'null'::jsonb THEN
        v_t := clock_timestamp();
        v_r := public.crm_scenario_counts(NULL, v_org, v_tree);
        v_ms := v_ms || jsonb_build_object('counts', round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
        v_out := v_out || jsonb_build_object('counts', v_r);
      END IF;
    EXCEPTION WHEN others THEN v_err := v_err || jsonb_build_object('editor', SQLSTATE || ' ' || SQLERRM);
    END;
  END IF;
  IF v_draft IS NOT NULL THEN
    BEGIN
      v_t := clock_timestamp();
      v_r := public.crm_scenario_preview(NULL, v_org, v_draft);
      v_ms := v_ms || jsonb_build_object('preview', round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
      v_out := v_out || jsonb_build_object('preview', jsonb_build_object('errors', jsonb_array_length(COALESCE(v_r->'errors', '[]')), 'stats', v_r->'stats'));
    EXCEPTION WHEN others THEN v_err := v_err || jsonb_build_object('preview', SQLSTATE || ' ' || SQLERRM);
    END;
  END IF;

  -- Agents : plan de soirée (prochaine soirée), bilan de la semaine, fil de notifications.
  BEGIN
    v_t := clock_timestamp();
    v_r := public.crm_night_plan(NULL, v_org, NULL);
    v_ms := v_ms || jsonb_build_object('plan', round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
    v_out := v_out || jsonb_build_object('plan', jsonb_build_object('ok', v_r->'ok', 'error', v_r->'error', 'steps', jsonb_array_length(COALESCE(v_r->'steps', '[]')), 'cost', v_r->'totals'->'cost'));
  EXCEPTION WHEN others THEN v_err := v_err || jsonb_build_object('plan', SQLSTATE || ' ' || SQLERRM);
  END;
  BEGIN
    v_t := clock_timestamp();
    v_r := public.crm_weekly_review(NULL, v_org);
    v_ms := v_ms || jsonb_build_object('review', round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
    v_out := v_out || jsonb_build_object('review', jsonb_build_object('quiet', v_r->'quiet', 'activity', v_r->'activity', 'actions', jsonb_array_length(COALESCE(v_r->'actions', '[]'))));
  EXCEPTION WHEN others THEN v_err := v_err || jsonb_build_object('review', SQLSTATE || ' ' || SQLERRM);
  END;
  BEGIN
    v_t := clock_timestamp();
    v_r := public._crm_notif_list(NULL, v_org, v_org, true);
    v_ms := v_ms || jsonb_build_object('notif', round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
    v_out := v_out || jsonb_build_object('notif', (SELECT jsonb_agg(DISTINCT x->>'kind') FROM jsonb_array_elements(COALESCE(v_r, '[]')) x));
  EXCEPTION WHEN others THEN v_err := v_err || jsonb_build_object('notif', SQLSTATE || ' ' || SQLERRM);
  END;

  -- Côté serveur : une passe du moteur (le cron), le bilan quotidien de l'Admin, les crons posés.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  BEGIN
    v_t := clock_timestamp();
    PERFORM public.crm_scenario_tick();
    v_ms := v_ms || jsonb_build_object('tick', round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
  EXCEPTION WHEN others THEN v_err := v_err || jsonb_build_object('tick', SQLSTATE || ' ' || SQLERRM);
  END;
  BEGIN
    v_t := clock_timestamp();
    v_r := public._crm_admin_daily_core(false);
    v_ms := v_ms || jsonb_build_object('daily', round(extract(epoch FROM clock_timestamp() - v_t) * 1000));
    v_out := v_out || jsonb_build_object('daily', v_r->'counts');
  EXCEPTION WHEN others THEN v_err := v_err || jsonb_build_object('daily', SQLSTATE || ' ' || SQLERRM);
  END;
  v_out := v_out || jsonb_build_object('crons', (SELECT jsonb_agg(jobname || ' ' || schedule ORDER BY jobname) FROM cron.job
                                                  WHERE jobname IN ('crm-scenario-tick', 'crm-admin-daily')));

  IF v_err <> '{}'::jsonb THEN
    RAISE EXCEPTION 'SMOKE_FAIL %', jsonb_build_object('errors', v_err, 'ms', v_ms, 'out', v_out)::text;
  END IF;
  RAISE EXCEPTION 'SMOKE_OK %', jsonb_build_object('ms', v_ms, 'out', v_out)::text;
END
$smoke$;
