-- PERF-02 sur la PROD, annulé (rehearse.mjs), APRÈS PERF-01 :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/perf02.sql \
--     20261028100000_crm_score_nightly_overrun.sql
-- Structure seulement : AUCUN calcul du score ici (une passe pèse jusqu'à
-- 120 s sur la petite machine de la prod). Vérifie que les six points de
-- contrôle sont posés dans la définition RÉELLE de crm_score_compute, dans
-- l'ordre, que la passe de nuit attrape le délai, que le budget lève YS001
-- quand il est posé et rien sinon, que rien n'est ouvert à anon /
-- authenticated, et rend l'ordre de la file tel que la passe le lirait.
DO $smoke$
DECLARE
  v_c   text := pg_get_functiondef('public.crm_score_compute(text,uuid)'::regprocedure);
  v_n   text := pg_get_functiondef('public.crm_score_nightly()'::regprocedure);
  v_ph  text[];
  v_err text;
  v_q   jsonb;
BEGIN
  v_ph := ARRAY(SELECT m[1] FROM regexp_matches(v_c, 'PERFORM public\._crm_score_budget\(sc, ''([a-z]+)''\);', 'g') m);
  IF v_ph IS DISTINCT FROM ARRAY['load', 'pairs', 'fit', 'model', 'note', 'journal'] THEN
    RAISE EXCEPTION 'SMOKE_FAIL points de contrôle : %', v_ph;
  END IF;
  IF strpos(v_n, 'GREATEST(m.trained_at, st.score_overrun_at) NULLS FIRST') = 0
     OR strpos(v_n, 'WHEN SQLSTATE ''YS001'' OR query_canceled THEN') = 0 THEN
    RAISE EXCEPTION 'SMOKE_FAIL crm_score_nightly sans file ni filet';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'crm_analysis_state'
        AND column_name IN ('score_overrun_at', 'score_overrun')) <> 2 THEN
    RAISE EXCEPTION 'SMOKE_FAIL colonnes de crm_analysis_state';
  END IF;
  -- Sans budget : rien. Budget minuscule : YS001.
  PERFORM public._crm_score_budget('{}'::jsonb, 'load');
  PERFORM public._crm_score_budget('{"budget_s": 0}'::jsonb, 'load');
  BEGIN
    PERFORM pg_sleep(0.01);
    PERFORM public._crm_score_budget('{"budget_s": 0.001}'::jsonb, 'load');
    v_err := 'aucune erreur';
  EXCEPTION WHEN SQLSTATE 'YS001' THEN
    v_err := 'YS001';
  END;
  IF v_err <> 'YS001' THEN RAISE EXCEPTION 'SMOKE_FAIL budget : %', v_err; END IF;
  IF has_function_privilege('anon', 'public.crm_score_nightly()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.crm_score_nightly()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.crm_score_compute(text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.crm_score_compute(text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._crm_score_budget(jsonb,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._crm_score_budget(jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SMOKE_FAIL droits';
  END IF;
  -- L'ordre de la file, tel que la passe le lirait maintenant (aucune donnée personnelle).
  SELECT jsonb_agg(jsonb_build_object('scope', z.scope_key, 'trained_at', z.trained_at, 'overrun_at', z.score_overrun_at) ORDER BY z.o)
    INTO v_q
    FROM (SELECT st.scope_key, m.trained_at, st.score_overrun_at,
                 row_number() OVER (ORDER BY GREATEST(m.trained_at, st.score_overrun_at) NULLS FIRST) AS o
            FROM public.crm_analysis_state st
            LEFT JOIN public.crm_score_model m ON m.scope_key = st.scope_key
           WHERE st.full_at IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.ticketing_connections c
                          WHERE c.status <> 'disconnected' AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = st.scope_key)) z;
  RAISE EXCEPTION 'SMOKE_OK %', jsonb_build_object('checkpoints', v_ph, 'queue', v_q);
END
$smoke$;
