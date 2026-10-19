-- PERF-02 sur la PROD, annulé (rehearse.mjs), APRÈS PERF-01 : un VRAI délai
-- dépassé (statement_timeout), que le banc PGlite ne sait que simuler.
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/perf02-timeout.sql \
--     20261027100000_crm_score_fit_once_per_row.sql 20261028100000_crm_score_nightly_overrun.sql
-- Compte démo seulement (crm@womber.fr) : son modèle est reculé d'un jour pour
-- qu'il soit SEUL en tête de file (les comptes réels, notés aujourd'hui, n'y
-- sont pas), puis la passe de nuit est lancée avec un délai de 2 s, sous les
-- ~7 s de son calcul. Attendu : le délai est attrapé, le modèle d'hier reste
-- tel quel, score_overrun_at est posé, une alerte. Sans PERF-02, la passe
-- remonte l'erreur 57014 et tout échoue : c'est ce qui prouve que le smoke mord.
-- Plusieurs instructions : chacune a son propre délai (PostgreSQL ≥ 13), et le
-- délai court ne vaut que pour la passe. Tout est annulé par l'exception finale.
CREATE TEMP TABLE _perf02_before AS
SELECT m.scope_key, m.status, m.beta::text AS beta, m.trained_at - interval '1 day' AS trained_at,
       (SELECT count(*) FROM public.crm_person_night_score s WHERE s.scope_key = m.scope_key) AS scored
  FROM public.crm_score_model m
 WHERE m.scope_key = 'org:6a958c46-680d-4c6a-aec0-15301af47e1f';
UPDATE public.crm_score_model SET trained_at = trained_at - interval '1 day'
 WHERE scope_key = 'org:6a958c46-680d-4c6a-aec0-15301af47e1f';
-- Garde : la passe ne doit prendre QUE la démo (même file qu'avant PERF-02,
-- identique tant qu'aucune portée n'a de dépassement).
DO $guard$
BEGIN
  IF (SELECT st.scope_key
        FROM public.crm_analysis_state st
        LEFT JOIN public.crm_score_model m ON m.scope_key = st.scope_key
       WHERE st.full_at IS NOT NULL
         AND (m.trained_at IS NULL OR m.trained_at < date_trunc('day', now()))
         AND EXISTS (SELECT 1 FROM public.ticketing_connections c
                      WHERE c.status <> 'disconnected' AND public.crm_scope_key(c.venue_id, c.organizer_user_id) = st.scope_key)
       ORDER BY m.trained_at NULLS FIRST
       LIMIT 1) IS DISTINCT FROM 'org:6a958c46-680d-4c6a-aec0-15301af47e1f' THEN
    RAISE EXCEPTION 'SMOKE_FAIL la file ne commence pas par la démo : rien n''est lancé';
  END IF;
END
$guard$;
SELECT set_config('statement_timeout', '2s', true);
CREATE TEMP TABLE _perf02_r AS SELECT public.crm_score_nightly() AS r;
SELECT set_config('statement_timeout', '60s', true);
DO $smoke$
DECLARE
  v_scope constant text := 'org:6a958c46-680d-4c6a-aec0-15301af47e1f';
  v_r  jsonb := (SELECT r FROM _perf02_r);
  v_b  record;
  v_m  record;
  v_st record;
  v_alerts integer;
  v_scored integer;
BEGIN
  SELECT * INTO v_b FROM _perf02_before;
  SELECT m.status, m.beta::text AS beta, m.trained_at INTO v_m FROM public.crm_score_model m WHERE m.scope_key = v_scope;
  SELECT st.score_overrun_at, st.score_overrun INTO v_st FROM public.crm_analysis_state st WHERE st.scope_key = v_scope;
  SELECT count(*) INTO v_scored FROM public.crm_person_night_score s WHERE s.scope_key = v_scope;
  SELECT count(*) INTO v_alerts FROM public.admin_notifications n
   WHERE n.dedup_key = 'crm_score_overrun:' || v_scope || ':' || to_char(now(), 'YYYY-MM-DD');
  IF v_r->>'scope' IS DISTINCT FROM v_scope OR v_r->>'overrun' IS DISTINCT FROM 'timeout' THEN
    RAISE EXCEPTION 'SMOKE_FAIL passe : %', v_r;
  END IF;
  IF v_m.status IS DISTINCT FROM v_b.status OR v_m.beta IS DISTINCT FROM v_b.beta
     OR v_m.trained_at IS DISTINCT FROM v_b.trained_at OR v_scored IS DISTINCT FROM v_b.scored THEN
    RAISE EXCEPTION 'SMOKE_FAIL le modèle d''hier a bougé : % → %', row_to_json(v_b), row_to_json(v_m);
  END IF;
  IF v_st.score_overrun_at IS DISTINCT FROM now() OR v_st.score_overrun->>'kind' IS DISTINCT FROM 'timeout' THEN
    RAISE EXCEPTION 'SMOKE_FAIL trace : %', row_to_json(v_st);
  END IF;
  IF v_alerts <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL alertes : %', v_alerts; END IF;
  RAISE EXCEPTION 'SMOKE_OK %', jsonb_build_object('pass', v_r, 'trace', v_st.score_overrun - 'context',
                                                  'model_kept', v_m.status, 'alerts', v_alerts);
END
$smoke$;
