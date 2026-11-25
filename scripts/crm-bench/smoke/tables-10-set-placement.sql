-- Smoke ANNULÉ — tables vague A, P4.1 / P4.2 : vip_set_table_placement (droits, état attendu, table libre, changement de formule).
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-10-set-placement.sql 20261225100000_tables_policies_event_scope.sql 20261225130000_tables_can_manage_team.sql 20261225170000_tables_pending_31min.sql 20261225180000_tables_placement_columns.sql 20261225200000_tables_set_placement.sql
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
DO $smoke$
DECLARE
  v_owner uuid := 'a810aed8-1b10-4e41-b325-4bf07f657d72';  -- owner@ du club womber
  v_host  uuid := '95958e40-117d-4302-960d-652864d1bb9b';  -- viphost@ (hôte VIP)
  v_door  uuid := 'c9559229-023c-470e-b5e2-339c0708b061';  -- bouncer@ (porte : ne place pas)
  v_orgz  uuid := 'd9f3f907-0167-46dd-bd12-be1e5942e339';  -- barman@ (autre rôle du club : il ne place pas)
  v_partner uuid := 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';  -- organizer@ (organisateur partenaire de cette soirée)
  v_mgr   uuid := 'c240b1d1-9cba-4cb5-ae2e-321f60d506e5';  -- alex.door@ (manager)
  v_nobody uuid := '2ce1f11d-6605-4cb4-b384-052fb1f6cdcb';
  v_evB   uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';
  v_gold  uuid := '6fe30ed6-994b-45bb-8e66-69917f0ca6bf';
  v_silv  uuid := '5f49fc44-be53-43d7-bd86-5daa1802f861';
  v_zone  uuid := 'af1f18ef-ced9-4a2b-b191-1e18164f9b4b';
  t text[]; r text; j jsonb; out jsonb := '{}'::jsonb;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; r8 uuid; r9 uuid;
BEGIN
  DELETE FROM table_reservations WHERE event_id = v_evB;
  UPDATE events SET start_at = now() + interval '10 days', end_at = now() + interval '10 days 6 hours' WHERE id = v_evB;
  -- L'hôte VIP appartient au club ; le manager a la permission « tables ».
  UPDATE profiles SET venue_id = 'womber' WHERE id = v_host;
  INSERT INTO manager_permissions (venue_id, user_id, can_manage_tables) VALUES ('womber', v_mgr, true) ON CONFLICT DO NOTHING;
  UPDATE manager_permissions SET can_manage_tables = true WHERE venue_id = 'womber' AND user_id = v_mgr;
  -- Plan du club : t3 est lié à la formule Gold, t4 à la formule Silver, les autres à aucune.
  SELECT array_agg(e->>'id' ORDER BY ord) INTO t FROM venue_floor_plans f, jsonb_array_elements(f.layout->'tables') WITH ORDINALITY AS x(e, ord) WHERE f.venue_id = 'womber' AND f.event_id IS NULL;
  UPDATE venue_floor_plans SET layout = jsonb_set(layout, '{tables}', (
      SELECT jsonb_agg(CASE e->>'id' WHEN t[3] THEN e || jsonb_build_object('packId', v_gold) WHEN t[4] THEN e || jsonb_build_object('packId', v_silv) ELSE e END)
        FROM jsonb_array_elements(layout->'tables') e))
   WHERE venue_id = 'womber' AND event_id IS NULL;

  -- Réservations payées de la formule Gold.
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, paid_at, qr_code, requested_table_id, placement_status)
    VALUES (v_evB, v_gold, v_zone, 'r1@t', 'R1', 500, 140, 4, 'paid', now(), 'smk10-1', t[1]::uuid, 'requested') RETURNING id INTO r1;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, paid_at, qr_code, requested_table_id, placement_status)
    VALUES (v_evB, v_gold, v_zone, 'r2@t', 'R2', 500, 140, 4, 'paid', now(), 'smk10-2', t[2]::uuid, 'requested') RETURNING id INTO r2;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, paid_at, qr_code)
    VALUES (v_evB, v_gold, v_zone, 'r3@t', 'R3', 500, 140, 4, 'paid', now(), 'smk10-3') RETURNING id INTO r3;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, paid_at, qr_code)
    VALUES (v_evB, v_gold, v_zone, 'r4@t', 'R4', 500, 140, 4, 'paid', now(), 'smk10-4') RETURNING id INTO r4;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, paid_at, qr_code, assigned_table_id, vip_status, placed_at)
    VALUES (v_evB, v_gold, v_zone, 'r5@t', 'R5', 500, 140, 4, 'paid', now(), 'smk10-5', t[5]::uuid, 'active', now()) RETURNING id INTO r5;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, qr_code)
    VALUES (v_evB, v_gold, v_zone, 'r6@t', 'R6', 500, 140, 4, 'pending', 'smk10-6') RETURNING id INTO r6;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, paid_at, qr_code, requested_table_id, placement_status)
    VALUES (v_evB, v_gold, v_zone, 'r7@t', 'R7', 500, 140, 4, 'paid', now(), 'smk10-7', t[7]::uuid, 'requested') RETURNING id INTO r7;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, qr_code)
    VALUES (v_evB, v_gold, v_zone, 'r8@t', 'R8', 500, 140, 4, 'cancelled', 'smk10-8') RETURNING id INTO r8;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, paid_at, qr_code)
    VALUES (v_evB, v_gold, v_zone, 'r9@t', 'R9', 500, 140, 4, 'paid', now(), 'smk10-9') RETURNING id INTO r9;

  -- 1. Droits : l'organisateur étranger, le videur, un inconnu et l'anonyme n'ont rien à faire ici.
  PERFORM pg_temp.expect('barman', pg_temp.place(v_orgz, r1, 'assign', t[1]), 'ERR:42501:not_allowed');
  PERFORM pg_temp.expect('videur', pg_temp.place(v_door, r1, 'assign', t[1]), 'ERR:42501:not_allowed');
  PERFORM pg_temp.expect('inconnu', pg_temp.place(v_nobody, r1, 'assign', t[1]), 'ERR:42501:not_allowed');
  PERFORM pg_temp.expect('anon', pg_temp.try_anon(format('public.vip_set_table_placement(%L, ''assign'', %L)', r1, t[1])), 'ERR:42501');
  out := out || jsonb_build_object('rights_refused', 4);

  -- 2. Attribuer la table demandée (libre) : approved, rien à ajuster. Le propriétaire.
  r := pg_temp.place(v_owner, r1, 'assign', t[1], NULL, NULL, 'requested');
  j := r::jsonb;
  IF j->>'placement_status' <> 'approved' OR (j->>'changed_table')::boolean IS NOT TRUE OR j->>'new_table' <> t[1] OR j->>'previous_table' IS NOT NULL
     OR j->>'placement_adjustment' IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL assign demandée : %', r; END IF;
  -- Le collègue (hôte VIP) rejoue la même demande avec l'état qu'il avait lu : « un collègue est déjà passé ».
  PERFORM pg_temp.expect('état périmé', pg_temp.place(v_host, r1, 'assign', t[1], NULL, NULL, 'requested'), 'ERR:YU004:placement_changed');
  out := out || jsonb_build_object('assign_requested', 'approved', 'stale_state', 'YU004');

  -- 3. Table déjà promise à R1 : R2, qui la demandait aussi, ne peut pas la prendre ; autre table libre de la même formule : modified.
  PERFORM pg_temp.expect('table prise (promise)', pg_temp.place(v_owner, r2, 'assign', t[1], NULL, NULL, 'requested'), 'ERR:YU007:table_taken');
  r := pg_temp.place(v_host, r2, 'assign', t[11], NULL, NULL, 'requested');   -- l'hôte VIP place
  j := r::jsonb;
  IF j->>'placement_status' <> 'modified' OR j->>'new_table' <> t[11] THEN RAISE EXCEPTION 'SMOKE_FAIL proposer une autre table : %', r; END IF;
  -- Le manager « tables » aussi.
  PERFORM pg_temp.expect('manager tables', pg_temp.place(v_mgr, r9, 'assign', t[9]), '{');
  PERFORM pg_temp.expect('organisateur partenaire', pg_temp.place(v_partner, r9, 'assign', t[9]), '{');
  out := out || jsonb_build_object('taken', 'YU007', 'other_table', 'modified');

  -- 4. Table liée à une AUTRE formule (t4 = Silver, R3 = Gold) : un choix est obligatoire.
  PERFORM pg_temp.expect('formule autre sans choix', pg_temp.place(v_owner, r3, 'assign', t[4]), 'ERR:YU005:formula_change_requires_adjustment');
  PERFORM pg_temp.expect('ajustement inconnu', pg_temp.place(v_owner, r3, 'assign', t[4], 'bogus'), 'ERR:22023:invalid_adjustment');
  PERFORM pg_temp.expect('pay_on_site sans montant', pg_temp.place(v_owner, r3, 'assign', t[4], 'pay_on_site'), 'ERR:22023:invalid_adjustment_amount');
  PERFORM pg_temp.expect('pay_on_site négatif', pg_temp.place(v_owner, r3, 'assign', t[4], 'pay_on_site', -5), 'ERR:22023:invalid_adjustment_amount');
  j := pg_temp.place(v_owner, r3, 'assign', t[4], 'upgrade_free')::jsonb;
  IF j->>'placement_adjustment' <> 'upgrade_free' OR j->>'placement_status' <> 'approved' THEN RAISE EXCEPTION 'SMOKE_FAIL surclassement offert : %', j; END IF;
  -- Même table renvoyée sans rappeler le choix : il reste. Puis « différence à régler sur place » : montant arrondi au centime.
  j := pg_temp.place(v_owner, r3, 'assign', t[4])::jsonb;
  IF j->>'placement_adjustment' <> 'upgrade_free' OR (j->>'changed_table')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'SMOKE_FAIL choix conservé : %', j; END IF;
  j := pg_temp.place(v_owner, r3, 'assign', t[4], 'pay_on_site', 80.456)::jsonb;
  IF j->>'placement_adjustment' <> 'pay_on_site' OR (j->>'placement_adjustment_amount')::numeric <> 80.46 THEN RAISE EXCEPTION 'SMOKE_FAIL différence : %', j; END IF;
  SELECT placement_adjustment || ':' || placement_adjustment_amount INTO r FROM table_reservations WHERE id = r3;
  PERFORM pg_temp.expect('colonnes écrites', r, 'pay_on_site:80.46');
  -- Retour à une table de SA formule (t3 = Gold) : l'ajustement est remis à NULL.
  j := pg_temp.place(v_owner, r3, 'assign', t[3])::jsonb;
  IF j->>'placement_adjustment' IS NOT NULL OR j->>'previous_table' <> t[4] THEN RAISE EXCEPTION 'SMOKE_FAIL retour même formule : %', j; END IF;
  SELECT (placement_adjustment IS NULL AND placement_adjustment_amount IS NULL)::text INTO r FROM table_reservations WHERE id = r3;
  PERFORM pg_temp.expect('ajustement remis à NULL', r, 'true');
  out := out || jsonb_build_object('formula_change', 'YU005 puis upgrade_free / pay_on_site 80.46, remis à NULL au retour');

  -- 5. Placement à l'arrivée : la table est libérée et un autre client peut la prendre.
  j := pg_temp.place(v_owner, r2, 'on_arrival', NULL, NULL, NULL, 'modified')::jsonb;
  IF j->>'placement_status' <> 'assign_on_arrival' OR j->>'new_table' IS NOT NULL OR (j->>'changed_table')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'SMOKE_FAIL on_arrival : %', j; END IF;
  j := pg_temp.place(v_owner, r4, 'assign', t[11])::jsonb;
  IF j->>'new_table' <> t[11] THEN RAISE EXCEPTION 'SMOKE_FAIL table libérée : %', j; END IF;
  -- Un client installé ne passe pas « à l'arrivée » ; il peut en revanche changer de table (même formule).
  PERFORM pg_temp.expect('installé → arrivée', pg_temp.place(v_owner, r5, 'on_arrival'), 'ERR:YU008:already_seated');
  j := pg_temp.place(v_owner, r5, 'assign', t[6])::jsonb;
  IF j->>'previous_table' <> t[5] OR j->>'new_table' <> t[6] THEN RAISE EXCEPTION 'SMOKE_FAIL déplacer un installé : %', j; END IF;
  out := out || jsonb_build_object('on_arrival', 'ok', 'seated_move', 'ok');

  -- 6. Réservation non payée, annulée : refusée. Table inconnue ou mal formée : refusée.
  PERFORM pg_temp.expect('pending', pg_temp.place(v_owner, r6, 'assign', t[8]), 'ERR:YU008:reservation_not_active');
  PERFORM pg_temp.expect('annulée', pg_temp.place(v_owner, r8, 'assign', t[8]), 'ERR:YU008:reservation_not_active');
  PERFORM pg_temp.expect('table inconnue', pg_temp.place(v_owner, r9, 'assign', gen_random_uuid()::text), 'ERR:YU009:table_unknown');
  PERFORM pg_temp.expect('table mal formée', pg_temp.place(v_owner, r9, 'assign', 'pas-un-uuid'), 'ERR:YU009:table_unknown');
  PERFORM pg_temp.expect('table manquante', pg_temp.place(v_owner, r9, 'assign'), 'ERR:22023:table_required');
  PERFORM pg_temp.expect('action inconnue', pg_temp.place(v_owner, r9, 'fly'), 'ERR:22023:invalid_action');
  PERFORM pg_temp.expect('résa inconnue', pg_temp.place(v_owner, gen_random_uuid(), 'assign', t[8]), 'ERR:P0002:reservation_not_found');

  -- 7. Une demande vivante retient la table (R7 demande t7, pas encore attribuée) ; dès qu'elle est servie ailleurs, t7 se libère.
  PERFORM pg_temp.expect('demande vivante', pg_temp.place(v_owner, r9, 'assign', t[7]), 'ERR:YU007:table_taken');
  PERFORM pg_temp.place(v_owner, r7, 'assign', t[8]);
  j := pg_temp.place(v_owner, r9, 'assign', t[7])::jsonb;
  IF j->>'new_table' <> t[7] THEN RAISE EXCEPTION 'SMOKE_FAIL demande servie ailleurs : %', j; END IF;
  out := out || jsonb_build_object('requested_holds_table', 'ok');

  -- 8. Le client écrit-il directement ces colonnes ? Non (le propriétaire lui-même passe par la RPC).
  r := pg_temp.try_dml(v_owner, format($q$UPDATE table_reservations SET placement_adjustment = 'upgrade_free' WHERE id = %L$q$, r1));
  PERFORM pg_temp.expect('écriture directe interdite', r, 'ERR:42501');
  r := pg_temp.try_dml(v_owner, format($q$UPDATE table_reservations SET placement_adjustment_amount = 1 WHERE id = %L$q$, r1));
  PERFORM pg_temp.expect('écriture directe interdite (montant)', r, 'ERR:42501');
  -- L'hôte VIP pur non plus (liste blanche + protect), mais les colonnes de service qu'il a toujours écrites restent permises.
  r := pg_temp.try_dml(v_host, format($q$UPDATE table_reservations SET placement_adjustment = 'upgrade_free' WHERE id = %L$q$, r1));
  PERFORM pg_temp.expect('hôte : écriture directe interdite', r, 'ERR:42501');
  r := pg_temp.try_dml(v_host, format($q$UPDATE table_reservations SET placement_note = 'ok' WHERE id = %L$q$, r1));
  PERFORM pg_temp.expect('hôte : colonne de service permise', r, 'OK:1');
  -- CHECK : un montant sans ajustement est refusé même en service.
  BEGIN
    UPDATE table_reservations SET placement_adjustment = NULL, placement_adjustment_amount = 5 WHERE id = r1;
    RAISE EXCEPTION 'SMOKE_FAIL le CHECK du montant n''a pas joué';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
