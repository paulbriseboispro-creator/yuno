-- Smoke ANNULÉ — tables vague C1, point 6 : carte de soirée, précommande relue en base, salles VIP, reçu.
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-c1-4-bottles.sql 20261226100000_sale_email_queue_effects.sql 20261226110000_tables_capacity_eve_recap.sql 20261226120000_tables_manual_reservation_guest_count.sql 20261226130000_tables_bottle_menu_preorder.sql
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
  v_owner uuid := 'a810aed8-1b10-4e41-b325-4bf07f657d72';          -- owner@ du club womber
  v_orga uuid := 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';           -- organisateur démo
  v_evClub uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';          -- soirée du club womber
  v_evOrg uuid := 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';           -- soirée d'organisateur SANS club
  v_gold uuid := '6fe30ed6-994b-45bb-8e66-69917f0ca6bf';
  v_mc uuid; v_mc2 uuid; v_me uuid; v_mother uuid;
  v_res uuid; v_res2 uuid; j jsonb; r text; n int; v_room uuid;
  out jsonb := '{}'::jsonb;
BEGIN
  DELETE FROM table_reservations WHERE event_id IN (v_evClub, v_evOrg);

  -- Cartes : une du club womber, une de la soirée d'organisateur.
  INSERT INTO vip_menu_items (venue_id, name, category, price, is_active, position) VALUES ('womber', 'Club Champagne', 'champagne', 120, true, 1) RETURNING id INTO v_mc;
  INSERT INTO vip_menu_items (venue_id, name, category, price, is_active, position) VALUES ('womber', 'Club Inactive', 'vodka', 99, false, 2) RETURNING id INTO v_mc2;
  INSERT INTO vip_menu_items (event_id, name, category, price, is_active, position) VALUES (v_evOrg, 'Soirée Vodka', 'vodka', 80, true, 1) RETURNING id INTO v_me;

  -- CHECK : club OU soirée
  r := pg_temp.try_dml(v_owner, 'INSERT INTO vip_menu_items (name, category, price) VALUES (''x'', ''other'', 1)');
  IF r NOT LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL carte sans portée acceptée : %', r; END IF;
  out := out || jsonb_build_object('check', 'ok');

  -- RLS : l'organisateur écrit la carte de SA soirée, le propriétaire d'un club n'y touche pas (ni l'inverse)
  r := pg_temp.try_dml(v_orga, format('INSERT INTO vip_menu_items (event_id, name, category, price) VALUES (%L, ''Orga Gin'', ''gin'', 70)', v_evOrg));
  PERFORM pg_temp.expect('orga écrit la carte de sa soirée', r, 'OK:1');
  r := pg_temp.try_dml(v_owner, format('INSERT INTO vip_menu_items (event_id, name, category, price) VALUES (%L, ''Intrus'', ''gin'', 70)', v_evOrg));
  IF r NOT LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL un club écrit la carte d''une soirée qui n''est pas la sienne : %', r; END IF;
  r := pg_temp.try_dml(v_orga, 'INSERT INTO vip_menu_items (venue_id, name, category, price) VALUES (''womber'', ''Intrus'', ''gin'', 70)');
  IF r NOT LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL un organisateur écrit la carte du club : %', r; END IF;
  out := out || jsonb_build_object('rls', 'ok');

  -- Lecture client : club → carte du club ; sans club → carte de la soirée ; actifs seulement
  j := get_table_menu(v_evClub);
  IF NOT (j @> jsonb_build_array(jsonb_build_object('id', v_mc))) AND (SELECT count(*) FROM jsonb_array_elements(j) x WHERE x->>'id' = v_mc::text) <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL carte du club'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(j) x WHERE x->>'id' IN (v_mc2::text, v_me::text)) <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL carte du club : inactif ou autre périmètre visible'; END IF;
  j := get_table_menu(v_evOrg);
  IF (SELECT count(*) FROM jsonb_array_elements(j) x WHERE x->>'id' = v_me::text) <> 1 OR (SELECT count(*) FROM jsonb_array_elements(j) x WHERE x->>'id' = v_mc::text) <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL carte de la soirée'; END IF;
  r := pg_temp.try_anon(format('public.get_table_menu(%L)', v_evOrg)); IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL anon get_table_menu : %', r; END IF;
  out := out || jsonb_build_object('read', 'ok');

  -- Précommande : prix du navigateur ignorés, article d'un autre périmètre / inactif / inconnu refusé, quantités bornées
  j := table_preorder_check(v_evClub, jsonb_build_array(jsonb_build_object('menuItemId', v_mc, 'quantity', 2, 'unitPrice', 0.01)));
  IF (j->>'total')::numeric <> 240 THEN RAISE EXCEPTION 'SMOKE_FAIL prix relus en base : %', j; END IF;
  j := table_preorder_check(v_evClub, jsonb_build_array(jsonb_build_object('menuItemId', v_mc, 'quantity', 1), jsonb_build_object('menuItemId', v_mc, 'quantity', 2)));
  IF (j->>'total')::numeric <> 360 OR jsonb_array_length(j->'lines') <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL doublons additionnés : %', j; END IF;
  r := pg_temp.try_q(v_owner, format('public.table_preorder_check(%L, ''[{"menuItemId":"%s","quantity":1}]''::jsonb)', v_evClub, v_me));
  IF r NOT LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL (authenticated n''a pas à appeler ça) : %', r; END IF;
  BEGIN PERFORM table_preorder_check(v_evClub, jsonb_build_array(jsonb_build_object('menuItemId', v_me, 'quantity', 1))); RAISE EXCEPTION 'SMOKE_FAIL article d''une autre carte accepté';
  EXCEPTION WHEN SQLSTATE 'YU020' THEN IF SQLERRM <> 'invalid_preorder:item_not_found' THEN RAISE; END IF; END;
  BEGIN PERFORM table_preorder_check(v_evClub, jsonb_build_array(jsonb_build_object('menuItemId', v_mc2, 'quantity', 1))); RAISE EXCEPTION 'SMOKE_FAIL article inactif accepté';
  EXCEPTION WHEN SQLSTATE 'YU020' THEN IF SQLERRM <> 'invalid_preorder:item_not_found' THEN RAISE; END IF; END;
  BEGIN PERFORM table_preorder_check(v_evClub, jsonb_build_array(jsonb_build_object('menuItemId', v_mc, 'quantity', 21))); RAISE EXCEPTION 'SMOKE_FAIL quantité 21 acceptée';
  EXCEPTION WHEN SQLSTATE 'YU020' THEN IF SQLERRM <> 'invalid_preorder:bad_quantity' THEN RAISE; END IF; END;
  BEGIN PERFORM table_preorder_check(v_evClub, jsonb_build_array(jsonb_build_object('menuItemId', 'pas-un-uuid', 'quantity', 1))); RAISE EXCEPTION 'SMOKE_FAIL id invalide accepté';
  EXCEPTION WHEN SQLSTATE 'YU020' THEN IF SQLERRM <> 'invalid_preorder:item_not_found' THEN RAISE; END IF; END;
  out := out || jsonb_build_object('check_rules', 'ok');

  -- Écriture : club (venue_id posé) et organisateur sans club (venue_id NULL, event_id posé), idempotente
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, status, qr_code, user_id)
    VALUES (v_evClub, v_gold, 'pre1@test', 500, 140, 'pending', 'smkc4-1', NULL) RETURNING id INTO v_res;
  j := create_table_preorder(v_res, jsonb_build_array(jsonb_build_object('menuItemId', v_mc, 'quantity', 2, 'unitPrice', 1)));
  IF (j->>'total')::numeric <> 240 OR j->>'order_id' IS NULL THEN RAISE EXCEPTION 'SMOKE_FAIL create_table_preorder club : %', j; END IF;
  IF (SELECT venue_id FROM vip_table_orders WHERE id = (j->>'order_id')::uuid) <> 'womber' OR (SELECT event_id FROM vip_table_orders WHERE id = (j->>'order_id')::uuid) <> v_evClub
     OR (SELECT status FROM vip_table_orders WHERE id = (j->>'order_id')::uuid) <> 'preorder'
     OR (SELECT unit_price FROM vip_table_order_items WHERE order_id = (j->>'order_id')::uuid) <> 120 THEN RAISE EXCEPTION 'SMOKE_FAIL lignes club'; END IF;
  j := create_table_preorder(v_res, jsonb_build_array(jsonb_build_object('menuItemId', v_mc, 'quantity', 5)));
  IF (j->>'already')::boolean IS NOT TRUE OR (SELECT count(*) FROM vip_table_orders WHERE table_reservation_id = v_res) <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL idempotence'; END IF;
  -- la réservation et son total n'ont pas bougé (rien en ligne)
  IF (SELECT total_price FROM table_reservations WHERE id = v_res) <> 500 OR (SELECT deposit FROM table_reservations WHERE id = v_res) <> 140 THEN RAISE EXCEPTION 'SMOKE_FAIL la précommande touche l''argent'; END IF;

  INSERT INTO table_reservations (event_id, user_email, total_price, deposit, status, qr_code)
    VALUES (v_evOrg, 'pre2@test', 300, 0, 'pending', 'smkc4-2') RETURNING id INTO v_res2;
  j := create_table_preorder(v_res2, jsonb_build_array(jsonb_build_object('menuItemId', v_me, 'quantity', 3)));
  IF (j->>'total')::numeric <> 240 THEN RAISE EXCEPTION 'SMOKE_FAIL précommande orga : %', j; END IF;
  IF (SELECT venue_id FROM vip_table_orders WHERE id = (j->>'order_id')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL venue_id attendu NULL'; END IF;
  -- l'article d'un autre périmètre est refusé à l'écriture aussi
  BEGIN PERFORM create_table_preorder(v_res2, jsonb_build_array(jsonb_build_object('menuItemId', v_mc, 'quantity', 1)));
    -- déjà une précommande : renvoie 'already' sans relire ? non : le check a lieu avant
    RAISE EXCEPTION 'SMOKE_FAIL article du club sur une soirée sans club';
  EXCEPTION WHEN SQLSTATE 'YU020' THEN NULL; END;
  out := out || jsonb_build_object('write', 'ok');

  -- RLS commandes : l'organisateur lit la précommande de SA soirée sans club ; un autre compte non
  r := pg_temp.try_q(v_orga, format('(SELECT count(*) FROM vip_table_orders WHERE table_reservation_id = %L)', v_res2));
  PERFORM pg_temp.expect('orga voit la précommande', r, '1');
  r := pg_temp.try_q(v_orga, format('(SELECT count(*) FROM vip_table_order_items i JOIN vip_table_orders o ON o.id = i.order_id WHERE o.table_reservation_id = %L)', v_res2));
  PERFORM pg_temp.expect('orga voit les lignes', r, '1');
  r := pg_temp.try_q(v_owner, format('(SELECT count(*) FROM vip_table_orders WHERE table_reservation_id = %L)', v_res2));
  PERFORM pg_temp.expect('un autre club ne voit pas la précommande de l''orga', r, '0');
  r := pg_temp.try_q(v_owner, format('(SELECT count(*) FROM vip_table_orders WHERE table_reservation_id = %L)', v_res));
  PERFORM pg_temp.expect('le club voit sa précommande', r, '1');
  out := out || jsonb_build_object('orders_rls', 'ok');

  -- Reçu : la précommande apparaît
  j := get_table_receipt(v_res, 'smkc4-1');
  IF (j->'preorder'->>'total')::numeric <> 240 OR jsonb_array_length(j->'preorder'->'items') <> 1 OR j->'preorder'->>'payment' <> 'on_site' THEN RAISE EXCEPTION 'SMOKE_FAIL reçu : %', j->'preorder'; END IF;
  UPDATE table_reservations SET status = 'paid', paid_at = now() WHERE id = v_res;
  j := get_table_receipt(v_res, 'smkc4-1');
  IF (j->'preorder'->>'total')::numeric <> 240 THEN RAISE EXCEPTION 'SMOKE_FAIL reçu payé'; END IF;
  out := out || jsonb_build_object('receipt', 'ok');

  -- Salle VIP : la carte de la soirée suit la salle ; plus de quota de bouteilles
  DELETE FROM table_reservations WHERE event_id = v_evOrg;
  j := to_jsonb(pg_get_functiondef('public.save_event_vip_room(uuid,text,uuid)'::regprocedure));
  IF (j #>> '{}') LIKE '%included_bottles_quota%' THEN RAISE EXCEPTION 'SMOKE_FAIL save_event_vip_room lit encore le quota'; END IF;
  IF pg_get_functiondef('public.apply_vip_room_to_event(uuid,uuid)'::regprocedure) LIKE '%included_bottles_quota%' THEN RAISE EXCEPTION 'SMOKE_FAIL apply_vip_room_to_event écrit encore le quota'; END IF;
  -- save / apply en tant que l'organisateur (soirée sans club, une zone + une formule posées pour que la salle ne soit pas vide)
  INSERT INTO table_zones (event_id, name, color, tables_count, position, created_by_user_id) VALUES (v_evOrg, 'Z1', '#3b82f6', 2, 0, v_orga) RETURNING id INTO v_mother;
  INSERT INTO table_packs (event_id, zone_id, name, base_price, base_capacity, tables_count, position, created_by_user_id) VALUES (v_evOrg, v_mother, 'P1', 100, 6, 2, 0, v_orga);
  r := pg_temp.try_q(v_orga, format('public.save_event_vip_room(%L, ''Salle test'')', v_evOrg));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL save_event_vip_room : %', r; END IF;
  v_room := r::uuid;
  IF (SELECT jsonb_array_length(menu) FROM organizer_vip_rooms WHERE id = v_room) < 2 THEN RAISE EXCEPTION 'SMOKE_FAIL la salle n''a pas gardé la carte : %', (SELECT menu FROM organizer_vip_rooms WHERE id = v_room); END IF;
  DELETE FROM vip_menu_items WHERE event_id = v_evOrg;
  r := pg_temp.try_q(v_orga, format('public.apply_vip_room_to_event(%L, %L)', v_room, v_evOrg));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL apply_vip_room_to_event : %', r; END IF;
  SELECT count(*) INTO n FROM vip_menu_items WHERE event_id = v_evOrg AND is_active;
  IF n < 2 THEN RAISE EXCEPTION 'SMOKE_FAIL la carte n''a pas suivi la salle : %', n; END IF;
  out := out || jsonb_build_object('rooms', 'ok', 'menu_after_apply', n);

  -- grants
  IF pg_temp.try_anon(format('public.create_table_preorder(%L, ''[]''::jsonb)', v_res)) NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'SMOKE_FAIL anon create_table_preorder'; END IF;

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
