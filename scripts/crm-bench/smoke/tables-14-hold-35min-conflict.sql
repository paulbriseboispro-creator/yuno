-- Smoke ANNULÉ — tables vague A bis, I1 : garde de la place 35 min, conflit au passage à payé, M5 (ajout manuel).
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-14-hold-35min-conflict.sql 20261225150000_tables_sold_table_guard.sql 20261225170000_tables_pending_31min.sql 20261225180000_tables_placement_columns.sql 20261225230000_tables_hold_35min_paid_conflict.sql
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
CREATE OR REPLACE FUNCTION pg_temp.rts(p_event uuid, p_zone uuid, p_pack uuid, p_email text, p_table text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  BEGIN
    v := public.reserve_table_slot(
      _event_id => p_event, _zone_id => p_zone, _capacity_zone_id => p_zone, _pack_id => p_pack, _user_id => NULL, _user_email => p_email,
      _is_guest => true, _guest_count => 2, _deposit => 10, _total_price => 100, _management_fee => 1, _status => 'pending',
      _qr_code => 'smk14-' || gen_random_uuid()::text, _full_name => 'Test', _phone => NULL, _remarks => NULL, _newsletter_opt_in => false,
      _sms_opt_in => false, _requested_table_id => p_table, _placement_status => CASE WHEN p_table IS NULL THEN 'none' ELSE 'requested' END,
      _purchase_source => NULL);
    RETURN v::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
  END;
END $f$;

DO $smoke$
DECLARE
  v_owner uuid := 'a810aed8-1b10-4e41-b325-4bf07f657d72';
  v_evB uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';
  v_z uuid; v_pack uuid; t text[]; r text; out jsonb := '{}'::jsonb; j jsonb;
  a uuid; b uuid; c uuid; d uuid; row record;
BEGIN
  DELETE FROM table_reservations WHERE event_id = v_evB;
  UPDATE events SET start_at = now() + interval '10 days', end_at = now() + interval '10 days 6 hours' WHERE id = v_evB;
  SELECT array_agg(e->>'id' ORDER BY ord) INTO t FROM venue_floor_plans f, jsonb_array_elements(f.layout->'tables') WITH ORDINALITY AS x(e, ord)
   WHERE f.venue_id = 'womber' AND f.event_id IS NULL AND NULLIF(e->>'packId','') IS NULL;
  INSERT INTO table_zones (venue_id, name, tables_count) VALUES ('womber', 'zone smoke 14', 0) RETURNING id INTO v_z;
  INSERT INTO table_packs (venue_id, zone_id, name, base_price, tables_count, limit_tables) VALUES ('womber', v_z, 'pack smoke 14', 100, 1, false) RETURNING id INTO v_pack;

  -- 1. La règle : 34 min = retenue, 36 min = libérée ; payée toujours.
  IF NOT public._table_resa_holds('pending', now() - interval '34 minutes') THEN RAISE EXCEPTION 'SMOKE_FAIL 34 min doit retenir'; END IF;
  IF public._table_resa_holds('pending', now() - interval '36 minutes') THEN RAISE EXCEPTION 'SMOKE_FAIL 36 min ne doit plus retenir'; END IF;
  IF NOT public._table_resa_holds('paid', now() - interval '3 days') OR public._table_resa_holds('cancelled', now()) THEN RAISE EXCEPTION 'SMOKE_FAIL paid/cancelled'; END IF;

  -- 2. reserve_table_slot : une pending de 33 min (l'ancienne règle la libérait à 31) retient encore la table ; 36 min la libère.
  INSERT INTO table_reservations (event_id, zone_id, pack_id, user_email, total_price, status, qr_code, requested_table_id, placement_status, created_at)
    VALUES (v_evB, v_z, v_pack, 'p33@test', 100, 'pending', 'smk14-33', t[1]::uuid, 'requested', now() - interval '33 minutes');
  r := pg_temp.rts(v_evB, v_z, v_pack, 'x1@test', t[1]);
  PERFORM pg_temp.expect('pending 33 min retient la table', r, 'ERR:23514:Cette table vient d''être réservée');
  UPDATE table_reservations SET created_at = now() - interval '36 minutes' WHERE qr_code = 'smk14-33';
  r := pg_temp.rts(v_evB, v_z, v_pack, 'x2@test', t[1]);
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL pending 36 min retient encore : %', r; END IF;
  DELETE FROM table_reservations WHERE event_id = v_evB;

  -- 3. Garde « table vendue » : même seuil. Plan du club sans la table t[1] pendant qu'une pending de 33 min la demande.
  INSERT INTO table_reservations (event_id, zone_id, pack_id, user_email, total_price, status, qr_code, requested_table_id, placement_status, created_at)
    VALUES (v_evB, v_z, v_pack, 'g33@test', 100, 'pending', 'smk14-g33', t[2]::uuid, 'requested', now() - interval '33 minutes');
  r := pg_temp.try_dml(v_owner, format($q$UPDATE venue_floor_plans SET layout = jsonb_set(layout, '{tables}', (SELECT jsonb_agg(e) FROM jsonb_array_elements(layout->'tables') e WHERE e->>'id' <> %L)) WHERE venue_id = 'womber' AND event_id IS NULL$q$, t[2]));
  PERFORM pg_temp.expect('retrait refusé (pending 33 min)', r, 'ERR:YU003');
  UPDATE table_reservations SET created_at = now() - interval '36 minutes' WHERE qr_code = 'smk14-g33';
  r := pg_temp.try_dml(v_owner, format($q$UPDATE venue_floor_plans SET layout = jsonb_set(layout, '{tables}', (SELECT jsonb_agg(e) FROM jsonb_array_elements(layout->'tables') e WHERE e->>'id' <> %L)) WHERE venue_id = 'womber' AND event_id IS NULL$q$, t[2]));
  PERFORM pg_temp.expect('retrait permis (pending 36 min)', r, 'OK:1');
  DELETE FROM table_reservations WHERE event_id = v_evB;

  -- 4. Ajout manuel (M5) : une pending périmée ne bloque plus la table, une récente oui.
  INSERT INTO table_reservations (event_id, zone_id, user_email, total_price, status, qr_code, requested_table_id, placement_status, created_at)
    VALUES (v_evB, v_z, 'm@test', 100, 'pending', 'smk14-m', t[1]::uuid, 'requested', now() - interval '36 minutes');
  UPDATE table_zones SET tables_count = 0 WHERE id = v_z;
  r := pg_temp.try_q(v_owner, format('public.create_manual_table_reservation(%L, %L, ''Walk'', NULL, NULL, 2, 0, 0, %L)', v_evB, v_z, t[1]));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL ajout manuel bloqué par une pending périmée : %', r; END IF;
  INSERT INTO table_reservations (event_id, zone_id, user_email, total_price, status, qr_code, requested_table_id, placement_status, created_at)
    VALUES (v_evB, v_z, 'm2@test', 100, 'pending', 'smk14-m2', t[3]::uuid, 'requested', now() - interval '10 minutes');
  r := pg_temp.try_q(v_owner, format('public.create_manual_table_reservation(%L, %L, ''Walk2'', NULL, NULL, 2, 0, 0, %L)', v_evB, v_z, t[3]));
  PERFORM pg_temp.expect('ajout manuel bloqué par une pending récente', r, 'ERR:23505');
  DELETE FROM table_reservations WHERE event_id = v_evB;

  -- 5. Conflit au passage à payé : A a payé avant B, les deux demandent t[1] → B passe en placement à l'arrivée, A intact.
  INSERT INTO table_reservations (event_id, zone_id, pack_id, user_email, total_price, status, paid_at, qr_code, requested_table_id, placement_status, created_at)
    VALUES (v_evB, v_z, v_pack, 'a@test', 100, 'paid', now() - interval '5 minutes', 'smk14-a', t[1]::uuid, 'requested', now() - interval '40 minutes') RETURNING id INTO a;
  INSERT INTO table_reservations (event_id, zone_id, pack_id, user_email, total_price, status, paid_at, qr_code, requested_table_id, placement_status, created_at)
    VALUES (v_evB, v_z, v_pack, 'b@test', 100, 'paid', now(), 'smk14-b', t[1]::uuid, 'requested', now() - interval '35 minutes') RETURNING id INTO b;
  j := public.table_resolve_paid_conflict(a);
  IF (j->>'conflict')::boolean THEN RAISE EXCEPTION 'SMOKE_FAIL A (premier payé) ne doit pas perdre sa table : %', j; END IF;
  j := public.table_resolve_paid_conflict(b);
  IF NOT (j->>'conflict')::boolean OR j->'tables' <> to_jsonb(ARRAY[t[1]]) OR j->'held_by' <> to_jsonb(ARRAY[a]) THEN RAISE EXCEPTION 'SMOKE_FAIL conflit B : %', j; END IF;
  SELECT * INTO row FROM table_reservations WHERE id = b;
  IF row.requested_table_id IS NOT NULL OR row.assigned_table_id IS NOT NULL OR row.placement_status <> 'assign_on_arrival' OR row.status <> 'paid' THEN
    RAISE EXCEPTION 'SMOKE_FAIL B après conflit : %', to_jsonb(row);
  END IF;
  SELECT * INTO row FROM table_reservations WHERE id = a;
  IF row.requested_table_id::text <> t[1] OR row.placement_status <> 'requested' THEN RAISE EXCEPTION 'SMOKE_FAIL A touchée : %', to_jsonb(row); END IF;
  -- Idempotent : rejouer ne change plus rien.
  j := public.table_resolve_paid_conflict(b);
  IF (j->>'conflict')::boolean THEN RAISE EXCEPTION 'SMOKE_FAIL rejeu : %', j; END IF;
  out := out || jsonb_build_object('conflict_resolved', true);

  -- 6. Une autre PENDING qui demande la même table ne vole rien à une payée ; mêmes paid_at → l'id départage ; table attribuée aussi.
  INSERT INTO table_reservations (event_id, zone_id, pack_id, user_email, total_price, status, qr_code, requested_table_id, placement_status, created_at)
    VALUES (v_evB, v_z, v_pack, 'c@test', 100, 'pending', 'smk14-c', t[2]::uuid, 'requested', now() - interval '2 minutes') RETURNING id INTO c;
  INSERT INTO table_reservations (event_id, zone_id, pack_id, user_email, total_price, status, paid_at, qr_code, requested_table_id, placement_status, assigned_table_id, created_at)
    VALUES (v_evB, v_z, v_pack, 'd@test', 100, 'paid', now(), 'smk14-d', t[2]::uuid, 'approved', t[2]::uuid, now() - interval '3 minutes') RETURNING id INTO d;
  j := public.table_resolve_paid_conflict(d);
  IF (j->>'conflict')::boolean THEN RAISE EXCEPTION 'SMOKE_FAIL une pending ne doit pas faire perdre une payée : %', j; END IF;
  -- c paie à son tour : d (payée avant) tient t[2], c passe en placement à l'arrivée.
  UPDATE table_reservations SET status = 'paid', paid_at = now() + interval '1 second' WHERE id = c;
  j := public.table_resolve_paid_conflict(c);
  IF NOT (j->>'conflict')::boolean THEN RAISE EXCEPTION 'SMOKE_FAIL c devait perdre t[2] : %', j; END IF;
  out := out || jsonb_build_object('pending_never_steals', true);

  -- 7. Plafond de zone : jamais corrigé, mais rendu.
  UPDATE table_zones SET tables_count = 1 WHERE id = v_z;
  j := public.table_resolve_paid_conflict(c);
  IF NOT (j->>'zone_overflow')::boolean OR (j->>'zone_max')::int <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL dépassement de zone : %', j; END IF;
  out := out || jsonb_build_object('zone_overflow', j->'zone_used');

  -- 8. Droits : la fonction est réservée à service_role.
  r := pg_temp.try_q(v_owner, format('public.table_resolve_paid_conflict(%L)', a));
  PERFORM pg_temp.expect('client ne résout pas un conflit', r, 'ERR:42501');
  r := pg_temp.try_anon(format('public.table_resolve_paid_conflict(%L)', a));
  PERFORM pg_temp.expect('anon ne résout pas un conflit', r, 'ERR:42501');
  r := pg_temp.try_anon('public._table_resa_holds(''paid'', now())');
  PERFORM pg_temp.expect('anon ne lit pas la règle', r, 'ERR:42501');

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
