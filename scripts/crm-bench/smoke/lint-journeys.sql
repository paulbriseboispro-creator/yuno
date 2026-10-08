-- Lint (plpgsql_check) de toutes les fonctions plpgsql des Scénarios et agents
-- (migrations 20261016100000 → 180000), comme `supabase db lint`, dans la
-- transaction annulée de rehearse.mjs (l'extension n'est pas gardée) :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/lint-journeys.sql 20261016100000_… … 20261016180000_…
-- Les fonctions de trigger sont sautées (plpgsql_check veut leur table). Une
-- table temporaire créée à l'exécution sort en « relation does not exist » :
-- faux positif, listé à part.
DO $smoke$
DECLARE
  r     record;
  c     record;
  v_err jsonb := '[]'::jsonb;
  v_tmp jsonb := '[]'::jsonb;
  v_n   int := 0;
  v_w   int := 0;
BEGIN
  CREATE EXTENSION IF NOT EXISTS plpgsql_check;
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS f
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
      JOIN pg_language l ON l.oid = p.prolang AND l.lanname = 'plpgsql'
     WHERE p.prorettype <> 'trigger'::regtype
       AND p.proname = ANY (ARRAY[
         '_crm_admin_daily_core', '_crm_cond_errors', '_crm_cond_leaf_check', '_crm_cond_leaf_sql', '_crm_cond_leaf_values',
         '_crm_cond_needs_event', '_crm_cond_node_refs', '_crm_cond_node_sql', '_crm_cond_resolve', '_crm_cond_segment_ids',
         '_crm_cond_sql', '_crm_cond_strip_defs', '_crm_cond_walk', '_crm_erase_contacts', '_crm_family_confirmed', '_crm_notif_list',
         '_crm_scenario_advance', '_crm_scenario_candidates', '_crm_scenario_content', '_crm_scenario_enter', '_crm_scenario_event_time',
         '_crm_scenario_graph_errors', '_crm_scenario_hold_reason', '_crm_scenario_holdout', '_crm_scenario_mark_done',
         '_crm_scenario_message', '_crm_scenario_need_cp', '_crm_scenario_pick_events', '_crm_scenario_sms_retry', '_crm_scenario_state',
         '_crm_scenario_temp', '_crm_scenario_uses_event', '_crm_scn_cond_into', '_crm_scn_has_url', '_crm_scn_int', '_crm_scn_node',
         '_crm_scn_push', '_crm_scn_sorted', '_crm_scn_str', '_crm_scn_succ', '_crm_scn_uuid', '_crm_scn_visit', '_crm_scn_walk',
         '_crm_sms_segments_estimate', '_mcp_email_audience', '_mcp_needs_temp', '_mcp_scenario_pick', '_mcp_scenario_tool',
         '_mcp_scenario_write', 'crm_admin_daily', 'crm_admin_daily_notify', 'crm_admin_scenarios', 'crm_night_plan', 'crm_scenario',
         'crm_scenario_counts', 'crm_scenario_delete', 'crm_scenario_duplicate', 'crm_scenario_preview', 'crm_scenario_publish',
         'crm_scenario_report', 'crm_scenario_save', 'crm_scenario_set_status', 'crm_scenario_tick', 'crm_scenarios',
         'crm_weekly_review', 'demo_preview_writable_rpc', 'mcp_approve_authorization', 'mcp_call', 'mcp_my_connections',
         'mcp_session', 'mcp_write'])
     ORDER BY 2
  LOOP
    v_n := v_n + 1;
    FOR c IN SELECT * FROM plpgsql_check_function_tb(r.oid::regprocedure) WHERE level IN ('error', 'warning') LOOP
      IF c.message ~ 'relation ".*" does not exist' THEN
        v_tmp := v_tmp || jsonb_build_array(r.f || ' · ' || c.message);
      ELSIF c.level = 'error' THEN
        v_err := v_err || jsonb_build_array(jsonb_build_object('f', r.f, 'line', c.lineno, 'msg', c.message));
      ELSE
        v_w := v_w + 1;
        v_err := v_err || jsonb_build_array(jsonb_build_object('f', r.f, 'line', c.lineno, 'warn', c.message));
      END IF;
    END LOOP;
  END LOOP;
  RAISE EXCEPTION 'SMOKE_OK %', jsonb_build_object('functions', v_n, 'warnings', v_w, 'findings', v_err,
                                                    'temp_tables', (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(v_tmp) x))::text;
END
$smoke$;
