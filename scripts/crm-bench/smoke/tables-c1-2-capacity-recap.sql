-- Smoke ANNULÉ — tables vague C1, points 3-4 : capacité unique (élite / basic / illimitée), lecteurs patchés, récap de la veille.
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-c1-2-capacity-recap.sql 20261226100000_sale_email_queue_effects.sql 20261226110000_tables_capacity_eve_recap.sql
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
  v_plat uuid := 'ba64dd88-90d9-4448-88e2-4e24f1f4de36';
  v_dia uuid := '55eb2cdc-6fc3-49d1-8b4e-0433974815ae';
  v_t1 uuid := gen_random_uuid(); v_t2 uuid := gen_random_uuid(); v_t3 uuid := gen_random_uuid();
  n int; j jsonb; r text; v_ev uuid; v_res uuid; v_order uuid;
  out jsonb := '{}'::jsonb;
BEGIN
  DELETE FROM table_reservations WHERE event_id = v_evB;
  DELETE FROM venue_floor_plans WHERE event_id = v_evB;
  UPDATE events SET tables_mode = 'elite', sold_out_pack_ids = '{}', tables_enabled = true, is_active = true, cancelled_at = NULL,
                    start_at = now() + interval '3 days', end_at = now() + interval '3 days 6 hours' WHERE id = v_evB;

  -- Élite, plan du club (sans packId : lien par zone) : 5 + 6 + 4 + 2 tables.
  n := _event_table_capacity(v_evB);
  IF n IS NULL OR n < 10 THEN RAISE EXCEPTION 'SMOKE_FAIL capacité élite (plan du club) : %', n; END IF;
  out := out || jsonb_build_object('elite_club_plan', n);

  -- Élite, plan propre à la soirée : 2 tables liées (or, argent), 1 non liée (packId null explicite).
  INSERT INTO venue_floor_plans (venue_id, event_id, layout) VALUES ('womber', v_evB, jsonb_build_object('tables', jsonb_build_array(
    jsonb_build_object('id', v_t1, 'name', 'T1', 'packId', v_gold, 'zoneId', 'af1f18ef-ced9-4a2b-b191-1e18164f9b4b'),
    jsonb_build_object('id', v_t2, 'name', 'T2', 'packId', v_silver, 'zoneId', '67cf00a9-aa14-41e6-8a56-b29389ae2cff'),
    jsonb_build_object('id', v_t3, 'name', 'T3', 'packId', NULL, 'zoneId', '67cf00a9-aa14-41e6-8a56-b29389ae2cff'))));
  IF _event_table_capacity(v_evB) <> 2 THEN RAISE EXCEPTION 'SMOKE_FAIL capacité élite plan de soirée : %', _event_table_capacity(v_evB); END IF;
  UPDATE events SET sold_out_pack_ids = ARRAY[v_gold] WHERE id = v_evB;
  IF _event_table_capacity(v_evB) <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL formule complète exclue : %', _event_table_capacity(v_evB); END IF;
  UPDATE events SET sold_out_pack_ids = '{}' WHERE id = v_evB;

  -- _event_tables_left = capacité - tables vendues ; réservation « payée » compte.
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, status, paid_at, qr_code, guest_count, assigned_table_id, placement_status)
    VALUES (v_evB, v_gold, 'c1@test', 100, 'paid', now(), 'smkc2-a', 4, v_t1, 'approved') RETURNING id INTO v_res;
  IF _event_tables_left(v_evB) <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL tables restantes : %', _event_tables_left(v_evB); END IF;
  out := out || jsonb_build_object('elite_event_plan', 'ok');

  -- Basic : illimité tant qu'une formule ouverte n'a pas limit_tables ; somme quand toutes l'ont.
  UPDATE events SET tables_mode = 'basic' WHERE id = v_evB;
  IF _event_table_capacity(v_evB) IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL basic illimité attendu NULL : %', _event_table_capacity(v_evB); END IF;
  IF _event_tables_left(v_evB) IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL basic illimité : tables restantes NULL'; END IF;
  UPDATE table_packs SET limit_tables = true, tables_count = 3 WHERE id IN (v_gold, v_silver, v_plat, v_dia);
  IF _event_table_capacity(v_evB) <> 12 THEN RAISE EXCEPTION 'SMOKE_FAIL basic limité 4 x 3 : %', _event_table_capacity(v_evB); END IF;
  IF _event_tables_left(v_evB) <> 11 THEN RAISE EXCEPTION 'SMOKE_FAIL basic restantes : %', _event_tables_left(v_evB); END IF;
  out := out || jsonb_build_object('basic', 'ok');

  -- Lecteurs : l'accueil des soirées et le rapport lisent la même capacité (pas d'erreur, même chiffre).
  UPDATE events SET tables_mode = 'elite' WHERE id = v_evB;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  j := (SELECT x->'tables' FROM jsonb_array_elements(public.get_events_sales_summary('womber', NULL)::jsonb->'events') x WHERE x->>'id' = v_evB::text);
  PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (j->>'capacity')::int IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'SMOKE_FAIL get_events_sales_summary capacity : %', j; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_owner)::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  j := public.get_event_report(v_evB);
  PERFORM set_config('request.jwt.claims', '', true); PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (j->'totals'->'tables'->>'capacity')::int IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'SMOKE_FAIL get_event_report capacity : %', left(j::text, 500); END IF;
  IF public._tix_event_tables_total(v_evB) <> 2 THEN RAISE EXCEPTION 'SMOKE_FAIL _tix_event_tables_total'; END IF;
  out := out || jsonb_build_object('readers', 'ok');

  -- Droits : visiteur et connecté peuvent lire la capacité (chiffre public), pas l'écrire (rien à écrire).
  r := pg_temp.try_anon(format('public._event_tables_left(%L)', v_evB));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL anon tables restantes : %', r; END IF;

  -- Récap de la veille : soirée NON démo, demain 22 h (Paris), une table vendue attribuée + une précommande.
  SELECT e.id INTO v_ev FROM events e
   WHERE NOT (e.id = ANY (demo_event_ids())) AND e.venue_id IS NOT NULL LIMIT 1;
  UPDATE events SET start_at = ((date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '1 day 22 hours') AT TIME ZONE 'Europe/Paris'),
                    end_at = ((date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '2 days 5 hours') AT TIME ZONE 'Europe/Paris'),
                    is_active = true, cancelled_at = NULL, tables_enabled = true WHERE id = v_ev;
  DELETE FROM table_reservations WHERE event_id = v_ev;
  INSERT INTO table_reservations (event_id, user_email, total_price, status, paid_at, qr_code, guest_count, assigned_table_id)
    VALUES (v_ev, 'r1@test', 100, 'paid', now(), 'smkc2-r1', 4, gen_random_uuid()) RETURNING id INTO v_res;
  INSERT INTO table_reservations (event_id, user_email, total_price, status, paid_at, qr_code, guest_count)
    VALUES (v_ev, 'r2@test', 100, 'paid', now(), 'smkc2-r2', 2);
  INSERT INTO vip_table_orders (table_reservation_id, venue_id, status, total_amount)
    VALUES (v_res, (SELECT venue_id FROM events WHERE id = v_ev), 'preorder', 180) RETURNING id INTO v_order;
  n := tables_eve_recap_run(true);
  IF n < 1 THEN RAISE EXCEPTION 'SMOKE_FAIL récap : aucune notification (n=%)', n; END IF;
  SELECT count(*) INTO n FROM (
    SELECT dedup_key FROM staff_notifications WHERE notification_type = 'table_eve_recap' AND event_id = v_ev
    UNION ALL SELECT dedup_key FROM organizer_notifications WHERE notification_type = 'table_eve_recap' AND event_id = v_ev) z;
  IF n < 1 THEN RAISE EXCEPTION 'SMOKE_FAIL récap non écrit'; END IF;
  PERFORM tables_eve_recap_run(true);
  SELECT count(*) INTO n FROM (
    SELECT dedup_key FROM staff_notifications WHERE notification_type = 'table_eve_recap' AND event_id = v_ev
    UNION ALL SELECT dedup_key FROM organizer_notifications WHERE notification_type = 'table_eve_recap' AND event_id = v_ev) z;
  out := out || jsonb_build_object('recap_rows_after_2_runs', n, 'recap_msg',
    (SELECT message FROM (SELECT message FROM staff_notifications WHERE notification_type = 'table_eve_recap' AND event_id = v_ev
                          UNION ALL SELECT message FROM organizer_notifications WHERE notification_type = 'table_eve_recap' AND event_id = v_ev) m LIMIT 1));
  -- démo : jamais
  UPDATE events SET start_at = ((date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '1 day 22 hours') AT TIME ZONE 'Europe/Paris'),
                    is_active = true, cancelled_at = NULL, tables_enabled = true WHERE id = v_evB;
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, status, paid_at, qr_code) VALUES (v_evB, v_gold, 'd@test', 100, 'paid', now(), 'smkc2-demo');
  PERFORM tables_eve_recap_run(true);
  IF EXISTS (SELECT 1 FROM staff_notifications WHERE notification_type = 'table_eve_recap' AND event_id = v_evB) THEN RAISE EXCEPTION 'SMOKE_FAIL récap envoyé pour la démo'; END IF;
  IF pg_temp.try_anon('public.tables_eve_recap_run(true)') NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'SMOKE_FAIL anon peut lancer le récap'; END IF;

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
