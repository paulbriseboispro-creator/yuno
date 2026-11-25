-- Smoke ANNULÉ — tables vague A, P2.8 : une pending de plus de 35 min (31 avant la vague A bis) ne retient plus rien (reserve_table_slot + get_event_table_availability).
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-8-pending-31min.sql 20261225170000_tables_pending_31min.sql
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
-- Appel de reserve_table_slot (service_role) : rend l'id ou 'ERR:<sqlstate>:<message>'.
CREATE OR REPLACE FUNCTION pg_temp.rts(p_event uuid, p_zone uuid, p_pack uuid, p_email text, p_table text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  BEGIN
    v := public.reserve_table_slot(
      _event_id => p_event, _zone_id => p_zone, _capacity_zone_id => p_zone, _pack_id => p_pack, _user_id => NULL, _user_email => p_email,
      _is_guest => true, _guest_count => 2, _deposit => 10, _total_price => 100, _management_fee => 1, _status => 'pending',
      _qr_code => 'smk8-' || gen_random_uuid()::text, _full_name => 'Test', _phone => NULL, _remarks => NULL, _newsletter_opt_in => false,
      _sms_opt_in => false, _requested_table_id => p_table, _placement_status => CASE WHEN p_table IS NULL THEN 'none' ELSE 'requested' END,
      _purchase_source => NULL);
    RETURN v::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
  END;
END $f$;

DO $smoke$
DECLARE
  v_evB uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';
  v_z uuid; v_pack uuid; t text[]; r text; out jsonb := '{}'::jsonb; n int;
BEGIN
  DELETE FROM table_reservations WHERE event_id = v_evB;
  SELECT array_agg(e->>'id' ORDER BY ord) INTO t FROM venue_floor_plans f, jsonb_array_elements(f.layout->'tables') WITH ORDINALITY AS x(e, ord)
   WHERE f.venue_id = 'womber' AND f.event_id IS NULL AND NULLIF(e->>'packId','') IS NULL;
  -- Zone d'UNE table, formule plafonnée à UNE table.
  INSERT INTO table_zones (venue_id, name, tables_count) VALUES ('womber', 'zone smoke 8', 1) RETURNING id INTO v_z;
  INSERT INTO table_packs (venue_id, zone_id, name, base_price, tables_count, limit_tables) VALUES ('womber', v_z, 'pack smoke 8', 100, 1, true) RETURNING id INTO v_pack;

  -- 1. Zone et formule : une pending de 40 min ne retient plus la dernière table → la réservation passe.
  INSERT INTO table_reservations (event_id, zone_id, pack_id, user_email, total_price, status, qr_code, created_at)
    VALUES (v_evB, v_z, v_pack, 'old@test', 100, 'pending', 'smk8-old', now() - interval '40 minutes');
  r := pg_temp.rts(v_evB, v_z, v_pack, 'new1@test', NULL);
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL pending périmée retient la zone : %', r; END IF;
  out := out || jsonb_build_object('stale_pending_frees_zone_and_pack', true);
  -- 2. … mais la pending toute fraîche (la sienne) retient bien la table : la suivante est refusée (zone complète).
  r := pg_temp.rts(v_evB, v_z, v_pack, 'new2@test', NULL);
  PERFORM pg_temp.expect('zone complète avec une pending récente', r, 'ERR:23514:La zone');
  -- 3. Formule seule : sans plafond de zone, la formule complète refuse.
  UPDATE table_zones SET tables_count = 0 WHERE id = v_z;
  r := pg_temp.rts(v_evB, v_z, v_pack, 'new3@test', NULL);
  PERFORM pg_temp.expect('formule complète avec une pending récente', r, 'ERR:23514:La formule');
  DELETE FROM table_reservations WHERE event_id = v_evB;

  -- 4. Table demandée : pending périmée = libre ; pending récente ou payée = prise.
  UPDATE table_packs SET limit_tables = false WHERE id = v_pack;
  INSERT INTO table_reservations (event_id, zone_id, pack_id, user_email, total_price, status, qr_code, requested_table_id, placement_status, created_at)
    VALUES (v_evB, v_z, v_pack, 'old2@test', 100, 'pending', 'smk8-old2', t[1]::uuid, 'requested', now() - interval '36 minutes');
  r := pg_temp.rts(v_evB, v_z, v_pack, 'tbl1@test', t[1]);
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL pending périmée retient la table : %', r; END IF;
  r := pg_temp.rts(v_evB, v_z, v_pack, 'tbl2@test', t[1]);
  PERFORM pg_temp.expect('table prise par une pending récente', r, 'ERR:23514:Cette table vient d''être réservée');
  UPDATE table_reservations SET status = 'paid' WHERE user_email = 'tbl1@test';
  r := pg_temp.rts(v_evB, v_z, v_pack, 'tbl3@test', t[1]);
  PERFORM pg_temp.expect('table prise par une payée', r, 'ERR:23514:Cette table vient d''être réservée');
  out := out || jsonb_build_object('requested_table_rules', 'ok');

  -- 5. get_event_table_availability : même seuil (35 min depuis la vague A bis, I1). 34 min 30 s : encore retenue ; 35 min 30 s : plus rien.
  DELETE FROM table_reservations WHERE event_id = v_evB;
  INSERT INTO table_reservations (event_id, zone_id, user_email, total_price, status, qr_code, created_at) VALUES
    (v_evB, v_z, 'a1@test', 100, 'pending', 'smk8-a1', now() - interval '34 minutes 30 seconds'),
    (v_evB, v_z, 'a2@test', 100, 'pending', 'smk8-a2', now() - interval '35 minutes 30 seconds'),
    (v_evB, v_z, 'a3@test', 100, 'paid',    'smk8-a3', now() - interval '3 hours'),
    (v_evB, v_z, 'a4@test', 100, 'cancelled','smk8-a4', now());
  SELECT count(*) INTO n FROM get_event_table_availability(v_evB);
  IF n <> 2 THEN RAISE EXCEPTION 'SMOKE_FAIL availability : % lignes (attendu 2 : pending 34 min 30 s + payée)', n; END IF;
  out := out || jsonb_build_object('availability_rows', n);

  -- 6. Droits : anon lit toujours la disponibilité ; la file reste service_role.
  r := pg_temp.try_anon(format('(SELECT count(*) FROM public.get_event_table_availability(%L))', v_evB));
  PERFORM pg_temp.expect('anon availability', r, '2');
  r := pg_temp.try_anon(format($q$public.reserve_table_slot(%L, NULL, NULL, NULL, NULL, 'x', true, 1, 0, 0, 0, 'pending', 'q', 'n', NULL, NULL, false, false, NULL, 'none', NULL)$q$, v_evB));
  PERFORM pg_temp.expect('anon reserve_table_slot', r, 'ERR:42501');

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
