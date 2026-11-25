-- Smoke ANNULÉ — tables vague A bis, M4 / M6 / M7 : suppression du plan de soirée, annulation d'un client installé, adresse secrète du reçu.
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-16-minor-fixes.sql 20261225170000_tables_pending_31min.sql 20261225180000_tables_placement_columns.sql 20261225190000_tables_client_receipt.sql 20261225200000_tables_set_placement.sql 20261225210000_tables_cancel_unpaid.sql 20261225220000_tables_charged_lines_receipt.sql 20261225230000_tables_hold_35min_paid_conflict.sql 20261225250000_tables_minor_fixes.sql
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
  r text; j jsonb; out jsonb := '{}'::jsonb;
  a uuid; b uuid; c uuid; d uuid; v_e uuid;
BEGIN
  DELETE FROM table_reservations WHERE event_id = v_evB;
  DELETE FROM venue_floor_plans WHERE event_id = v_evB;
  UPDATE events SET start_at = now() + interval '10 days', end_at = now() + interval '10 days 6 hours' WHERE id = v_evB;

  -- M4 : plan propre à la soirée (copie du plan du club) ; une réservation payée tient sa première table.
  INSERT INTO venue_floor_plans (venue_id, event_id, layout)
    SELECT 'womber', v_evB, f.layout FROM venue_floor_plans f WHERE f.venue_id = 'womber' AND f.event_id IS NULL;
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, status, paid_at, qr_code, assigned_table_id, placement_status)
    VALUES (v_evB, v_gold, 'm4@test', 100, 'paid', now(), 'smk16-m4',
            (SELECT (t->>'id')::uuid FROM venue_floor_plans f, jsonb_array_elements(f.layout->'tables') t WHERE f.event_id = v_evB LIMIT 1), 'approved');
  r := pg_temp.try_dml(v_owner, format('DELETE FROM venue_floor_plans WHERE event_id = %L', v_evB));
  PERFORM pg_temp.expect('M4 suppression du plan refusée (table vendue)', r, 'ERR:YU003:table_has_reservation:');
  UPDATE table_reservations SET status = 'cancelled' WHERE qr_code = 'smk16-m4';
  r := pg_temp.try_dml(v_owner, format('DELETE FROM venue_floor_plans WHERE event_id = %L', v_evB));
  PERFORM pg_temp.expect('M4 suppression permise (plus rien de vendu)', r, 'OK:1');
  out := out || jsonb_build_object('m4', 'ok');

  -- M6 : client entré / installé non annulable ; walk-in manuel annulable ; table normale non entrée annulable.
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, status, paid_at, qr_code, entry_scanned)
    VALUES (v_evB, v_gold, 'm6a@test', 100, 'paid', now(), 'smk16-a', true) RETURNING id INTO a;
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, status, paid_at, qr_code, vip_status, purchase_source)
    VALUES (v_evB, v_gold, 'm6b@test', 100, 'paid', now(), 'smk16-b', 'active', 'direct') RETURNING id INTO b;
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, status, paid_at, qr_code, vip_status, purchase_source)
    VALUES (v_evB, v_gold, 'm6c@test', 0, 'paid', now(), 'smk16-c', 'active', 'manual') RETURNING id INTO c;
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, status, paid_at, qr_code)
    VALUES (v_evB, v_gold, 'm6d@test', 100, 'paid', now(), 'smk16-d') RETURNING id INTO d;
  r := pg_temp.try_q(v_owner, format('public.cancel_unpaid_table_reservation(%L, ''x'')', a));
  PERFORM pg_temp.expect('M6 entré', r, 'ERR:YU008:already_seated');
  r := pg_temp.try_q(v_owner, format('public.cancel_unpaid_table_reservation(%L, ''x'')', b));
  PERFORM pg_temp.expect('M6 installé', r, 'ERR:YU008:already_seated');
  r := pg_temp.try_q(v_owner, format('public.cancel_unpaid_table_reservation(%L, ''x'')', c));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL M6 walk-in manuel : %', r; END IF;
  r := pg_temp.try_q(v_owner, format('public.cancel_unpaid_table_reservation(%L, ''x'')', d));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL M6 table normale : %', r; END IF;
  out := out || jsonb_build_object('m6', 'ok');

  -- M7 : reçu d'une soirée secrète — adresse masquée si l'organisateur ne la dévoile pas par e-mail ; sinon visible.
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, status, paid_at, qr_code, charged_total)
    VALUES (v_evB, v_gold, 'm7@test', 500, 140, 'paid', now(), 'smk16-m7', 145.61) RETURNING id INTO v_e;
  UPDATE events SET location_is_secret = true, reveal_address_in_email = false, location_address = '12 rue Secrète', location_name = 'Lieu secret' WHERE id = v_evB;
  j := public.get_table_receipt(v_e, 'smk16-m7');
  IF j->'event'->>'location_address' IS NOT NULL OR j->'event'->>'location_name' IS NOT NULL OR (j->'event'->>'address_deferred')::boolean IS NOT TRUE
     OR j->'venue'->>'address' IS NOT NULL OR (j->>'charged_total')::numeric <> 145.61 THEN
    RAISE EXCEPTION 'SMOKE_FAIL M7 adresse secrète : %', j->'event';
  END IF;
  UPDATE events SET reveal_address_in_email = true WHERE id = v_evB;
  j := public.get_table_receipt(v_e, 'smk16-m7');
  IF j->'event'->>'location_address' <> '12 rue Secrète' OR (j->'event'->>'address_deferred')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'SMOKE_FAIL M7 adresse dévoilée : %', j->'event';
  END IF;
  out := out || jsonb_build_object('m7', 'ok');

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
