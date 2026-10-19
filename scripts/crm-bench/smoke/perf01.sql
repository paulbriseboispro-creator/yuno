-- PERF-01 sur la PROD, annulé (rehearse.mjs) :
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/perf01.sql \
--     20261027100000_crm_score_fit_once_per_row.sql
-- Rejoué SANS la migration, il échoue (SMOKE_FAIL structure) en rendant les
-- mêmes empreintes : les comparer prouve que la correction ne change aucun
-- résultat. Compte démo seulement (crm@womber.fr) : aucune portée réelle.
--   1. Le calcul complet du compte démo (crm_score_compute, ~7 s) : modèle,
--      coefficients, mesures (hors durée).
--   2. _crm_logit_fit sur un jeu synthétique de 20 000 lignes, à froid puis à
--      chaud : les coefficients au bit près (texte float8 exact).
--   3. Le journal prévu / réel du compte démo sur sa prochaine soirée, avec des
--      chances fictives posées pour ses acheteurs (le modèle démo est « weak »,
--      il ne note personne) : c'est ce qui fait passer la jointure corrigée.
--   4. La structure : p calculé une fois par ligne, la jointure par la clé,
--      aucun droit pour anon / authenticated.
-- Tout est annulé par l'exception finale.
DO $smoke$
DECLARE
  v_scope constant text := 'org:6a958c46-680d-4c6a-aec0-15301af47e1f';
  v_org   constant uuid := '6a958c46-680d-4c6a-aec0-15301af47e1f';
  v_fit   text := pg_get_functiondef('public._crm_logit_fit(integer,float8,integer,float8[],float8)'::regprocedure);
  v_jdef  text := pg_get_functiondef('public._crm_score_journal(text,text,uuid)'::regprocedure);
  v_old   constant text := 'LEFT JOIN public.crm_person_night_score s ON s.scope_key = p_scope AND s.event_id = g.event_id AND s.email = g.email';
  v_model jsonb;
  v_cold  float8[];
  v_warm  float8[];
  v_ev    uuid;
  v_n     integer;
  v_scored integer;
  v_night jsonb;
  v_people text;
  v_out   jsonb;
  v_bad   text := '';
BEGIN
  -- 1. Le calcul complet du compte démo.
  PERFORM public.crm_score_compute(NULL, v_org);
  SELECT jsonb_build_object('status', m.status, 'beta', m.beta::text,
                            'md5', md5(concat_ws('|', m.status, m.features::text, m.mean::text, m.sd::text, m.beta::text, (m.metrics - 'ms')::text)))
    INTO v_model
    FROM public.crm_score_model m WHERE m.scope_key = v_scope;

  -- 2. L'ajustement seul, jeu synthétique déterministe (k = 4 facteurs).
  DROP TABLE IF EXISTS _scz;
  CREATE TEMP TABLE _scz ON COMMIT DROP AS
  SELECT 1::float8 AS x1, sin(g)::float8 AS x2, cos(g * 0.7)::float8 AS x3,
         (((g * 7919) % 101) / 100.0)::float8 AS x4, (g % 3 = 0)::int::float8 AS x5,
         (0.8 * sin(g) - 0.5 * cos(g * 0.7) + 1.2 * (((g * 7919) % 101) / 100.0) - 0.3 * (g % 3 = 0)::int
           + 0.9 * sin(g * 13.37) > 0.4)::int AS y,
         (1 + (g % 5) * 0.25)::float8 AS w
    FROM generate_series(1, 20000) g;
  v_cold := public._crm_logit_fit(4, 1.0, 8);
  v_warm := public._crm_logit_fit(4, 1.0, 8, v_cold);

  -- 3. Le journal du compte démo, chances fictives sur sa prochaine soirée.
  SELECT e.id INTO v_ev FROM public.events e
   WHERE e.organizer_user_id = v_org AND e.external_source IS NOT NULL AND e.start_at > now()
   ORDER BY e.start_at, e.id LIMIT 1;
  IF v_ev IS NULL THEN RAISE EXCEPTION 'SMOKE_FAIL aucune soirée démo à venir'; END IF;
  DELETE FROM public.crm_person_night_score WHERE scope_key = v_scope;
  INSERT INTO public.crm_person_night_score (scope_key, event_id, email, p, label, reasons)
  SELECT v_scope, v_ev, x.em, x.p,
         CASE WHEN x.p >= 0.30 THEN 'high' WHEN x.p >= 0.10 THEN 'medium' ELSE 'low' END, '{}'
    FROM (SELECT DISTINCT lower(t.buyer_email) AS em,
                 ((abs(hashtext(lower(t.buyer_email))) % 997) / 997.0 * 0.6)::real AS p
            FROM public.external_tickets t
            JOIN public.events e ON e.id = t.event_id
           WHERE e.organizer_user_id = v_org AND t.buyer_email IS NOT NULL) x
   ORDER BY x.em;
  GET DIAGNOSTICS v_scored = ROW_COUNT;
  v_n := public._crm_score_journal(v_scope, NULL, v_org);
  SELECT jsonb_build_object('scored', n.scored, 'expected_known', n.expected_known::text, 'band', n.band::text,
                            'audiences', n.audiences)
    INTO v_night
    FROM public.crm_prediction_nights n
   WHERE n.scope_key = v_scope AND n.event_id = v_ev AND n.snapshot_on = current_date;
  SELECT md5(string_agg(concat_ws('|', pp.horizon, pp.email, pp.p::text, pp.label, pp.auds::text), E'\n' ORDER BY pp.horizon, pp.email))
    INTO v_people
    FROM public.crm_prediction_people pp
   WHERE pp.scope_key = v_scope AND pp.event_id = v_ev AND pp.snapshot_at = now();

  v_out := jsonb_build_object('model', v_model, 'fit_cold', v_cold::text, 'fit_warm', v_warm::text,
                              'journal', jsonb_build_object('scored_in', v_scored, 'people_logged', v_n,
                                                            'night', v_night, 'people_md5', v_people));

  -- 4. La structure.
  IF strpos(v_fit, 'OFFSET 0) zp OFFSET 0) z') = 0 THEN v_bad := v_bad || ' fit_sans_offset'; END IF;
  IF strpos(v_jdef, 'LEFT JOIN LATERAL (SELECT x.p FROM public.crm_person_night_score x') = 0 OR strpos(v_jdef, v_old) > 0 THEN
    v_bad := v_bad || ' journal_sans_cle';
  END IF;
  IF has_function_privilege('anon', 'public._crm_logit_fit(integer,float8,integer,float8[],float8)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._crm_logit_fit(integer,float8,integer,float8[],float8)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._crm_score_journal(text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._crm_score_journal(text,text,uuid)', 'EXECUTE') THEN
    v_bad := v_bad || ' droits';
  END IF;
  IF v_night IS NULL OR v_n IS NULL OR v_n = 0 THEN v_bad := v_bad || ' journal_vide'; END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'SMOKE_FAIL structure :% — %', v_bad, v_out;
  END IF;
  RAISE EXCEPTION 'SMOKE_OK %', v_out;
END
$smoke$;
