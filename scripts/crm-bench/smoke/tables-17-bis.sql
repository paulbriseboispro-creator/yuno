-- Smoke ANNULÉ — tables vague B bis : QR d'invités aléatoires (D12) et `notify` de vip_set_table_placement (I3).
--   cd <worktree> && node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-17-bis.sql $(cd supabase/migrations && ls 20261225*.sql)
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
CREATE OR REPLACE FUNCTION pg_temp.place(p_uid uuid, p_resa uuid, p_action text, p_table text DEFAULT NULL, p_adj text DEFAULT NULL, p_amt numeric DEFAULT NULL, p_exp text DEFAULT NULL) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_q(p_uid, format('public.vip_set_table_placement(%L, %L, %L, %L, %L, %L)', p_resa, p_action, p_table, p_adj, p_amt, p_exp));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.place(p_uid uuid, p_resa uuid, p_action text, p_table text DEFAULT NULL, p_adj text DEFAULT NULL, p_amt numeric DEFAULT NULL, p_exp text DEFAULT NULL) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_q(p_uid, format('public.vip_set_table_placement(%L, %L, %L, %L, %L, %L)', p_resa, p_action, p_table, p_adj, p_amt, p_exp));
$f$;
DO $smoke$
DECLARE
  v_owner uuid := 'a810aed8-1b10-4e41-b325-4bf07f657d72';
  v_door  uuid := 'c9559229-023c-470e-b5e2-339c0708b061';
  v_evB   uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';
  v_gold  uuid := '6fe30ed6-994b-45bb-8e66-69917f0ca6bf';
  v_zone  uuid := 'af1f18ef-ced9-4a2b-b191-1e18164f9b4b';
  t text[]; j jsonb; out jsonb := '{}'::jsonb; n int; bad int;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; rq text;
BEGIN
  DELETE FROM table_reservations WHERE event_id = v_evB;
  UPDATE events SET start_at = now() + interval '10 days', end_at = now() + interval '10 days 6 hours' WHERE id = v_evB;
  SELECT array_agg(e->>'id' ORDER BY ord) INTO t FROM venue_floor_plans f, jsonb_array_elements(f.layout->'tables') WITH ORDINALITY AS x(e, ord) WHERE f.venue_id = 'womber' AND f.event_id IS NULL;

  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, paid_at, qr_code, requested_table_id, placement_status)
    VALUES (v_evB, v_gold, v_zone, 'a@t', 'A', 500, 140, 4, 'paid', now(), 'smk17-a', t[1]::uuid, 'requested') RETURNING id INTO r1;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, paid_at, qr_code, requested_table_id, placement_status)
    VALUES (v_evB, v_gold, v_zone, 'b@t', 'B', 500, 140, 3, 'paid', now(), 'smk17-b', t[2]::uuid, 'requested') RETURNING id INTO r2;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, paid_at, qr_code)
    VALUES (v_evB, v_gold, v_zone, 'c@t', 'C', 500, 140, 2, 'paid', now(), 'smk17-c') RETURNING id INTO r3;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, paid_at, qr_code, placement_status)
    VALUES (v_evB, v_gold, v_zone, 'd@t', 'D', 500, 140, 2, 'paid', now(), 'smk17-d', 'assign_on_arrival') RETURNING id INTO r4;

  -- D12 : QR aléatoires, indépendants, distincts du QR de la réservation.
  SELECT count(*) INTO n FROM table_reservation_guests WHERE reservation_id IN (r1, r2, r3, r4);
  IF n <> 11 THEN RAISE EXCEPTION 'SMOKE_FAIL nombre de tickets invités : %', n; END IF;
  SELECT count(*) INTO bad FROM table_reservation_guests g JOIN table_reservations r ON r.id = g.reservation_id
   WHERE g.reservation_id IN (r1, r2, r3, r4) AND (g.qr_code NOT LIKE 'TG-%' OR g.qr_code LIKE r.qr_code || '%' OR position(r.qr_code in g.qr_code) > 0);
  IF bad <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL QR invité dérivé du QR de la table : %', bad; END IF;
  SELECT count(DISTINCT qr_code) INTO n FROM table_reservation_guests WHERE reservation_id IN (r1, r2, r3, r4);
  IF n <> 11 THEN RAISE EXCEPTION 'SMOKE_FAIL QR invités non distincts : %', n; END IF;
  -- Le QR ne bouge pas quand la réservation change (QR de la table, nombre de personnes).
  SELECT qr_code INTO rq FROM table_reservation_guests WHERE reservation_id = r1 AND guest_number = 2;
  UPDATE table_reservations SET qr_code = 'smk17-a2', guest_count = 5 WHERE id = r1;
  PERFORM pg_temp.expect('QR stable', (SELECT qr_code FROM table_reservation_guests WHERE reservation_id = r1 AND guest_number = 2), rq);
  SELECT count(*) INTO n FROM table_reservation_guests WHERE reservation_id = r1;
  IF n <> 5 THEN RAISE EXCEPTION 'SMOKE_FAIL 5 invités attendus : %', n; END IF;
  -- La porte reconnaît un QR invité par la table (get_table_guest_pass), et le QR de la table n'est pas un QR d'invité.
  PERFORM pg_temp.expect('pass invité', pg_temp.try_anon(format('public.get_table_guest_pass(%L)', rq)), '{');
  PERFORM pg_temp.expect('QR de la table ≠ pass invité', pg_temp.try_anon(format('public.get_table_guest_pass(%L)', 'smk17-a2')), '<null>');
  out := out || jsonb_build_object('guest_qr', 'random, stable, distinct');

  -- Rattrapage : un invité au format dérivé est régénéré (même WHERE que la migration), un invité entré reste.
  UPDATE table_reservation_guests g SET qr_code = r.qr_code || '-' || (g.guest_number + 1) FROM table_reservations r WHERE r.id = g.reservation_id AND g.reservation_id = r2;
  UPDATE table_reservation_guests SET entry_scanned = true WHERE reservation_id = r2 AND guest_number = 0;
  UPDATE table_reservation_guests g SET qr_code = 'TG-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 20))
    FROM table_reservations r JOIN events e ON e.id = r.event_id
   WHERE g.reservation_id = r.id AND NOT g.entry_scanned AND g.qr_code = r.qr_code || '-' || (g.guest_number + 1)
     AND COALESCE(e.end_at, e.start_at + interval '8 hours') > now() - interval '6 hours' AND g.reservation_id = r2;
  SELECT count(*) INTO n FROM table_reservation_guests WHERE reservation_id = r2 AND qr_code LIKE 'TG-%';
  IF n <> 2 THEN RAISE EXCEPTION 'SMOKE_FAIL rattrapage : % (2 attendus, le 1er est entré)', n; END IF;

  -- I3 : notify décidé par le serveur.
  j := pg_temp.place(v_owner, r1, 'assign', t[1], NULL, NULL, 'requested')::jsonb;
  IF j->>'notify' IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL attribuer la table demandée ne prévient pas : %', j; END IF;
  j := pg_temp.place(v_owner, r2, 'assign', t[11], NULL, NULL, 'requested')::jsonb;
  IF j->>'notify' <> 'table_changed' THEN RAISE EXCEPTION 'SMOKE_FAIL autre table que la demandée : %', j; END IF;
  j := pg_temp.place(v_owner, r1, 'assign', t[3])::jsonb;
  IF j->>'notify' <> 'table_changed' THEN RAISE EXCEPTION 'SMOKE_FAIL déplacement d''une table attribuée : %', j; END IF;
  j := pg_temp.place(v_owner, r1, 'assign', t[3])::jsonb;
  IF j->>'notify' IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL même table, rien à dire : %', j; END IF;
  j := pg_temp.place(v_owner, r3, 'assign', t[6])::jsonb;
  IF j->>'notify' IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL client sans demande ni table : %', j; END IF;
  -- À l'arrivée : prévenu s'il avait une table / une demande, une seule fois ; jamais s'il n'avait rien.
  j := pg_temp.place(v_owner, r1, 'on_arrival', NULL, NULL, NULL, 'modified')::jsonb;
  PERFORM pg_temp.expect('arrivée après table', COALESCE(j->>'notify','<null>'), 'table_changed');
  j := pg_temp.place(v_owner, r4, 'on_arrival', NULL, NULL, NULL, 'assign_on_arrival')::jsonb;
  IF j->>'notify' IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL déjà à l''arrivée, sans demande : %', j; END IF;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, paid_at, qr_code, requested_table_id, placement_status)
    VALUES (v_evB, v_gold, v_zone, 'e@t', 'E', 500, 140, 1, 'paid', now(), 'smk17-e', t[8]::uuid, 'requested') RETURNING id INTO r5;
  j := pg_temp.place(v_owner, r5, 'on_arrival', NULL, NULL, NULL, 'requested')::jsonb;
  PERFORM pg_temp.expect('arrivée après demande', COALESCE(j->>'notify','<null>'), 'table_changed');
  j := pg_temp.place(v_owner, r5, 'on_arrival', NULL, NULL, NULL, 'assign_on_arrival')::jsonb;
  IF j->>'notify' IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL répétition à l''arrivée : %', j; END IF;
  -- Un client installé se déplace (I5 : l'hôte passe par la RPC).
  UPDATE table_reservations SET vip_status = 'active', placed_at = now() WHERE id = r3;
  j := pg_temp.place(v_owner, r3, 'assign', t[7])::jsonb;
  IF j->>'new_table' <> t[7] THEN RAISE EXCEPTION 'SMOKE_FAIL déplacer un installé : %', j; END IF;
  out := out || jsonb_build_object('notify', 'ok');
  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
