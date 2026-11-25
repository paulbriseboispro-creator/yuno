-- Smoke ANNULÉ — tables vague A, P6.2 : grants des RPC de configuration.
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-2-grants.sql 20261225110000_tables_rpc_grants.sql
-- ── Prélude commun des smokes « tables » (fonctions TEMPORAIRES, annulées avec la transaction) ───────────────
-- try_dml(uid, sql) : joue une écriture EN TANT QUE uid (rôle authenticated, claims posés) → 'OK:<lignes>' ou 'ERR:<code>:<message>'.
-- try_q(uid, expr)  : évalue une expression scalaire EN TANT QUE uid → le texte du résultat ou 'ERR:<code>:<message>'.
-- expect(label, got, prefix) : lève SMOKE_FAIL si `got` ne commence pas par `prefix`.
CREATE OR REPLACE FUNCTION pg_temp.try_dml(p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',p_uid)::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('role','authenticated', true);
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    RETURN 'OK:' || n;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
  END;
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.try_q(p_uid uuid, p_expr text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',p_uid)::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  PERFORM set_config('role','authenticated', true);
  BEGIN
    EXECUTE 'SELECT (' || p_expr || ')::text' INTO v;
    EXECUTE 'RESET ROLE';
    RETURN COALESCE(v, '<null>');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
  END;
END $f$;

-- Lecture / appel en tant qu'anonyme (aucune session).
CREATE OR REPLACE FUNCTION pg_temp.try_anon(p_expr text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('role','anon', true);
  BEGIN
    EXECUTE 'SELECT (' || p_expr || ')::text' INTO v;
    EXECUTE 'RESET ROLE';
    RETURN COALESCE(v, '<null>');
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
  END;
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.expect(p_label text, p_got text, p_prefix text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_got IS NULL OR left(p_got, length(p_prefix)) <> p_prefix THEN
    RAISE EXCEPTION 'SMOKE_FAIL [%] attendu "%…" obtenu "%"', p_label, p_prefix, left(COALESCE(p_got, '<null>'), 300);
  END IF;
END $f$;
-- ── Fin du prélude ───────────────────────────────────────────────────────────────────────────────────────────
DO $smoke$
DECLARE
  v_owner uuid := 'a810aed8-1b10-4e41-b325-4bf07f657d72';
  v_A uuid := '6b28b8ba-e022-4f40-be2f-1d2aaeb53f08';
  r text; out jsonb := '{}'::jsonb; s text;
BEGIN
  -- anon ne peut plus exécuter ces fonctions : permission denied (42501), pas « Not authenticated ».
  FOREACH s IN ARRAY ARRAY[
    'apply_vip_room_to_event(gen_random_uuid(), gen_random_uuid())',
    'enable_collab_tables(gen_random_uuid())',
    'set_event_tables_mode(gen_random_uuid(), ''basic'')',
    'enable_collab_basic_tables(gen_random_uuid())',
    'calculate_vip_upsell(gen_random_uuid())'
  ] LOOP
    r := pg_temp.try_anon('public.' || s);
    PERFORM pg_temp.expect('anon ' || s, r, 'ERR:42501:permission denied');
  END LOOP;

  -- Un compte connecté atteint la fonction (refus MÉTIER, pas de permission).
  r := pg_temp.try_q(v_owner, 'public.set_event_tables_mode(gen_random_uuid(), ''basic'')');
  PERFORM pg_temp.expect('auth set_event_tables_mode', r, 'ERR:P0001:Not allowed to manage tables');
  out := out || jsonb_build_object('auth_set_mode', r);
  r := pg_temp.try_q(v_owner, 'public.apply_vip_room_to_event(gen_random_uuid(), gen_random_uuid())');
  PERFORM pg_temp.expect('auth apply_vip_room', r, 'ERR:P0001:Room not found');
  r := pg_temp.try_q(v_owner, format('public.enable_collab_tables(%L)', v_A));
  IF r NOT IN ('basic', 'elite') THEN RAISE EXCEPTION 'SMOKE_FAIL enable_collab_tables en tant que propriétaire: %', r; END IF;
  out := out || jsonb_build_object('auth_enable', r);

  -- La lecture publique de disponibilité reste ouverte à anon.
  r := pg_temp.try_anon(format('(SELECT count(*) FROM public.get_event_table_availability(%L))', v_A));
  IF r LIKE 'ERR%' THEN RAISE EXCEPTION 'SMOKE_FAIL anon get_event_table_availability: %', r; END IF;
  out := out || jsonb_build_object('anon_availability', r);

  -- Inventaire : plus aucune de ces fonctions n'est exécutable par anon.
  out := out || jsonb_build_object('still_anon', (
    SELECT COALESCE(jsonb_agg(p.oid::regprocedure::text), '[]'::jsonb)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('apply_vip_room_to_event','enable_collab_tables','set_event_tables_mode','enable_collab_basic_tables','save_event_vip_room',
                         'compute_collab_table_settlement','prepare_collab_table_settlement','cancel_collab_table_settlement','calculate_vip_upsell',
                         'upsert_event_floor_plan','get_vip_table_analytics','get_vip_consumption_analytics')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))));
  IF jsonb_array_length(out->'still_anon') > 0 THEN RAISE EXCEPTION 'SMOKE_FAIL grants incorrects: %', out->'still_anon'; END IF;

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
