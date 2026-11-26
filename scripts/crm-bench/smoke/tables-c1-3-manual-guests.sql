-- Smoke ANNULÉ — tables vague C1, point 5 : réservation manuelle complète (table, formule, e-mail, QR) et nombre de convives.
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-c1-3-manual-guests.sql 20261226100000_sale_email_queue_effects.sql 20261226110000_tables_capacity_eve_recap.sql 20261226120000_tables_manual_reservation_guest_count.sql
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
  v_owner uuid := 'a810aed8-1b10-4e41-b325-4bf07f657d72';  -- owner@ du club womber
  v_evB uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';
  v_gold uuid := '6fe30ed6-994b-45bb-8e66-69917f0ca6bf';
  v_silver uuid := '5f49fc44-be53-43d7-bd86-5daa1802f861';
  v_zgold uuid := 'af1f18ef-ced9-4a2b-b191-1e18164f9b4b';
  v_t1 uuid := gen_random_uuid(); v_t2 uuid := gen_random_uuid();
  v_cap int; v_extra int;
  r text; id1 uuid; id2 uuid; n int; j jsonb;
  out jsonb := '{}'::jsonb;
BEGIN
  DELETE FROM table_reservations WHERE event_id = v_evB;
  DELETE FROM venue_floor_plans WHERE event_id = v_evB;
  UPDATE events SET tables_mode = 'elite', sold_out_pack_ids = '{}', tables_enabled = true, is_active = true, cancelled_at = NULL,
                    start_at = now() + interval '3 days', end_at = now() + interval '3 days 6 hours' WHERE id = v_evB;
  INSERT INTO venue_floor_plans (venue_id, event_id, layout) VALUES ('womber', v_evB, jsonb_build_object('tables', jsonb_build_array(
    jsonb_build_object('id', v_t1, 'name', 'T1', 'packId', v_gold, 'zoneId', v_zgold),
    jsonb_build_object('id', v_t2, 'name', 'T2', 'packId', v_gold, 'zoneId', v_zgold))));
  SELECT base_capacity, max_extra_persons INTO v_cap, v_extra FROM table_packs WHERE id = v_gold;
  out := out || jsonb_build_object('gold_cap', v_cap, 'gold_extra', v_extra);

  -- Complète : table choisie + formule + e-mail + confirmation → QR posé, QR d'invités, formule
  r := pg_temp.try_q(v_owner, format('public.create_manual_table_reservation(%L, %L, ''Jeanne Test'', ''0600000000'', ''jeanne@test.fr'', 4, 300, 0, %L, NULL, false, true, %L)', v_evB, v_zgold, v_t1, v_gold));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL résa manuelle complète : %', r; END IF;
  id1 := r::uuid;
  IF (SELECT qr_code FROM table_reservations WHERE id = id1) NOT LIKE 'VP-%' OR (SELECT pack_id FROM table_reservations WHERE id = id1) <> v_gold
     OR (SELECT assigned_table_id FROM table_reservations WHERE id = id1) <> v_t1 OR (SELECT status FROM table_reservations WHERE id = id1) <> 'paid' THEN
    RAISE EXCEPTION 'SMOKE_FAIL résa manuelle : colonnes';
  END IF;
  SELECT count(*) INTO n FROM table_reservation_guests WHERE reservation_id = id1; IF n <> 4 THEN RAISE EXCEPTION 'SMOKE_FAIL QR invités : %', n; END IF;
  out := out || jsonb_build_object('manual_full', 'ok');

  -- Sans confirmation : pas de QR (comme avant) ; walk-in sans table : fonctionne comme avant (signature d'avant, arguments nommés)
  r := pg_temp.try_q(v_owner, format('public.create_manual_table_reservation(p_event_id => %L, p_zone_id => %L, p_full_name => ''Walk In'', p_guest_count => 2)', v_evB, v_zgold));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL walk-in comme avant : %', r; END IF;
  IF (SELECT qr_code FROM table_reservations WHERE id = r::uuid) IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL walk-in sans QR'; END IF;

  -- Refus
  r := pg_temp.try_q(v_owner, format('public.create_manual_table_reservation(%L, %L, ''X'', NULL, NULL, 2, 0, 0, NULL, NULL, false, true, NULL)', v_evB, v_zgold));
  PERFORM pg_temp.expect('email_required', r, 'ERR:22023:email_required');
  r := pg_temp.try_q(v_owner, format('public.create_manual_table_reservation(%L, %L, ''X'', NULL, NULL, 2, 0, 0, %L, NULL, false, false, NULL)', v_evB, v_zgold, gen_random_uuid()));
  PERFORM pg_temp.expect('table_not_found', r, 'ERR:23503:table_not_found');
  r := pg_temp.try_q(v_owner, format('public.create_manual_table_reservation(%L, %L, ''X'', NULL, NULL, 2, 0, 0, NULL, NULL, false, false, %L)', v_evB, v_zgold, v_silver));
  PERFORM pg_temp.expect('pack_not_in_zone', r, 'ERR:22023:pack_not_in_zone');
  r := pg_temp.try_q(v_owner, format('public.create_manual_table_reservation(%L, %L, ''X'', NULL, NULL, 51, 0, 0, NULL, NULL, false, false, NULL)', v_evB, v_zgold));
  PERFORM pg_temp.expect('guest_count_out_of_range', r, 'ERR:YU011:guest_count_out_of_range:1:50');
  r := pg_temp.try_q(gen_random_uuid(), format('public.create_manual_table_reservation(%L, %L, ''X'', NULL, NULL, 2, 0, 0, NULL, NULL, false, false, NULL)', v_evB, v_zgold));
  PERFORM pg_temp.expect('forbidden manuel', r, 'ERR:42501');
  r := pg_temp.try_q(v_owner, format('public.create_manual_table_reservation(%L, %L, ''X'', NULL, NULL, 2, 0, 0, %L, NULL, false, false, NULL)', v_evB, v_zgold, v_t1));
  PERFORM pg_temp.expect('table déjà prise', r, 'ERR:23505');
  out := out || jsonb_build_object('refusals', 'ok');

  -- M5 : une pending de 40 min qui visait T2 ne bloque plus ; une pending de 10 min bloque.
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, status, qr_code, requested_table_id, placement_status, created_at)
    VALUES (v_evB, v_gold, v_zgold, 'p@test', 100, 'pending', 'smkc3-old', v_t2, 'requested', now() - interval '40 minutes');
  r := pg_temp.try_q(v_owner, format('public.create_manual_table_reservation(%L, %L, ''M5'', NULL, NULL, 2, 0, 0, %L, NULL, false, false, NULL)', v_evB, v_zgold, v_t2));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL M5 pending expirée : %', r; END IF;
  id2 := r::uuid;
  out := out || jsonb_build_object('m5', 'ok');

  -- Nombre de convives : id1 (4) → 6 (QR en plus) → 2 (QR en moins) ; bornes ; entrés ; attendu ; droits
  r := pg_temp.try_q(v_owner, format('public.vip_set_table_guest_count(%L, %s)', id1, LEAST(v_cap + v_extra, 50)));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL guest_count max : %', r; END IF;
  SELECT count(*) INTO n FROM table_reservation_guests WHERE reservation_id = id1;
  IF n <> LEAST(v_cap + v_extra, 50) THEN RAISE EXCEPTION 'SMOKE_FAIL QR après hausse : % (attendu %)', n, v_cap + v_extra; END IF;
  r := pg_temp.try_q(v_owner, format('public.vip_set_table_guest_count(%L, %s)', id1, v_cap + v_extra + 1));
  PERFORM pg_temp.expect('au-dessus de la formule', r, 'ERR:YU011:guest_count_out_of_range:1:' || (v_cap + v_extra));
  r := pg_temp.try_q(v_owner, format('public.vip_set_table_guest_count(%L, 3, 99)', id1));
  PERFORM pg_temp.expect('état attendu', r, 'ERR:YU014:guest_count_changed:' || (v_cap + v_extra));
  UPDATE table_reservation_guests SET entry_scanned = true, entry_scanned_at = now()
   WHERE reservation_id = id1 AND guest_number IN (0, 1, 2);
  r := pg_temp.try_q(v_owner, format('public.vip_set_table_guest_count(%L, 2)', id1));
  PERFORM pg_temp.expect('sous les entrés', r, 'ERR:YU012:guest_count_below_entered:3');
  r := pg_temp.try_q(v_owner, format('public.vip_set_table_guest_count(%L, 3, %s)', id1, v_cap + v_extra));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL baisse jusqu''aux entrés : %', r; END IF;
  SELECT count(*) INTO n FROM table_reservation_guests WHERE reservation_id = id1; IF n <> 3 THEN RAISE EXCEPTION 'SMOKE_FAIL QR après baisse : %', n; END IF;
  -- les QR gardés n'ont pas changé
  r := pg_temp.try_q(gen_random_uuid(), format('public.vip_set_table_guest_count(%L, 2)', id2));
  PERFORM pg_temp.expect('forbidden convives', r, 'ERR:42501');
  UPDATE table_reservations SET status = 'cancelled' WHERE id = id2;
  r := pg_temp.try_q(v_owner, format('public.vip_set_table_guest_count(%L, 2)', id2));
  PERFORM pg_temp.expect('annulée', r, 'ERR:YU013:reservation_not_active');
  r := pg_temp.try_anon(format('public.vip_set_table_guest_count(%L, 2)', id1));
  PERFORM pg_temp.expect('anon', r, 'ERR:42501');
  out := out || jsonb_build_object('guest_count', 'ok');

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
