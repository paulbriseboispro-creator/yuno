-- Smoke ANNULÉ — tables vague A, P6.3 : plus d'INSERT client direct sur table_reservations.
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-3-no-client-insert.sql 20261225120000_tables_drop_client_insert.sql
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
  v_uid uuid := '2ce1f11d-6605-4cb4-b384-052fb1f6cdcb';   -- apple-demo3@womber.fr (client)
  v_A uuid := '6b28b8ba-e022-4f40-be2f-1d2aaeb53f08';
  r text; out jsonb := '{}'::jsonb; v_id uuid;
BEGIN
  -- Un client connecté tente de poser une réservation « pending » à son nom : refusé.
  r := pg_temp.try_dml(v_uid, format($q$INSERT INTO table_reservations (event_id, user_id, user_email, total_price, status) VALUES (%L, %L, 'apple-demo3@womber.fr', 100, 'pending')$q$, v_A, v_uid));
  PERFORM pg_temp.expect('client INSERT pending', r, 'ERR:42501'); out := out || jsonb_build_object('client_insert', r);

  -- Le chemin légitime reste : RPC serveur (service) et création manuelle pro (SECURITY DEFINER).
  v_id := public.reserve_table_slot(v_A, NULL, NULL, NULL, v_uid, 'apple-demo3@womber.fr', false, 2, 0, 100, 4, 'pending', 'SMOKE-QR-' || gen_random_uuid()::text, 'Smoke', NULL, NULL, false, false, NULL, 'none', 'smoke', false);
  IF v_id IS NULL THEN RAISE EXCEPTION 'SMOKE_FAIL reserve_table_slot ne rend plus d''id'; END IF;
  out := out || jsonb_build_object('reserve_table_slot', 'ok');

  -- Lecture de sa propre réservation toujours possible.
  r := pg_temp.try_q(v_uid, format($q$(SELECT count(*) FROM table_reservations WHERE id = %L)$q$, v_id));
  PERFORM pg_temp.expect('client lit sa résa', r, '1'); out := out || jsonb_build_object('own_read', r);

  -- Policies INSERT restantes sur la table : aucune pour un client.
  out := out || jsonb_build_object('insert_policies', (SELECT COALESCE(jsonb_agg(policyname), '[]'::jsonb) FROM pg_policies WHERE tablename = 'table_reservations' AND cmd IN ('INSERT', 'ALL')));

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
