-- Smoke ANNULÉ — tables vague A, P6.1 : policies table_packs / table_zones / venue_floor_plans.
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-1-policies.sql 20261225100000_tables_policies_event_scope.sql
-- Comptes démo : owner@womber.fr (club womber), partenaire.demo@womber.fr (propriétaire du club B « goya-social-club »),
-- organizer@womber.fr (organisateur de « Saturday Night », soirée sans club). Soirée A = « All In At Midnight » (club womber).
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
  z_B uuid; z_A uuid; z_S uuid;
  v_A      uuid := '6b28b8ba-e022-4f40-be2f-1d2aaeb53f08';  -- soirée du club womber
  v_SAT    uuid := 'a0d17000-0000-4000-8000-000000000001';  -- soirée de l'organisateur, sans club
  v_ownerA uuid := 'a810aed8-1b10-4e41-b325-4bf07f657d72';
  v_ownerB uuid := 'e400afd5-0877-4336-8135-649a79b6790f';
  v_org    uuid := 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';
  r text; out jsonb := '{}'::jsonb; n_before int; n_after int;
BEGIN
  -- Le club B (propriétaire = partenaire.demo) attaque la soirée A du club womber.
  r := pg_temp.try_dml(v_ownerB, format($q$INSERT INTO table_zones (venue_id, event_id, name) VALUES ('goya-social-club', %L, 'attaque')$q$, v_A));
  PERFORM pg_temp.expect('B zone sur soirée A', r, 'ERR:42501'); out := out || jsonb_build_object('B_zone_on_A', r);
  r := pg_temp.try_dml(v_ownerB, format($q$INSERT INTO table_packs (zone_id, venue_id, event_id, name, base_price) VALUES (gen_random_uuid(), 'goya-social-club', %L, 'attaque', 10)$q$, v_A));
  PERFORM pg_temp.expect('B pack sur soirée A', r, 'ERR:42501'); out := out || jsonb_build_object('B_pack_on_A', r);
  r := pg_temp.try_dml(v_ownerB, format($q$INSERT INTO venue_floor_plans (venue_id, event_id, layout) VALUES ('goya-social-club', %L, '{"tables":[]}')$q$, v_A));
  PERFORM pg_temp.expect('B plan sur soirée A', r, 'ERR:42501'); out := out || jsonb_build_object('B_plan_on_A', r);

  -- Cas permis : B écrit SES lignes de club.
  r := pg_temp.try_dml(v_ownerB, $q$INSERT INTO table_zones (venue_id, name) VALUES ('goya-social-club', 'zone club B')$q$);
  PERFORM pg_temp.expect('B zone de club', r, 'OK:1'); out := out || jsonb_build_object('B_club_zone', r);
  SELECT id INTO z_B FROM table_zones WHERE venue_id = 'goya-social-club' AND name = 'zone club B';
  r := pg_temp.try_dml(v_ownerB, format($q$INSERT INTO table_packs (zone_id, venue_id, name, base_price) VALUES (%L, 'goya-social-club', 'pack club B', 100)$q$, z_B));
  PERFORM pg_temp.expect('B pack de club', r, 'OK:1'); out := out || jsonb_build_object('B_club_pack', r);
  r := pg_temp.try_dml(v_ownerB, $q$INSERT INTO venue_floor_plans (venue_id, layout) VALUES ('goya-social-club', '{"tables":[]}')$q$);
  PERFORM pg_temp.expect('B plan de club', r, 'OK:1'); out := out || jsonb_build_object('B_club_plan', r);

  -- Rebasculer une ligne de club B sur la soirée A par UPDATE : refusé (WITH CHECK).
  r := pg_temp.try_dml(v_ownerB, format($q$UPDATE table_zones SET event_id = %L WHERE venue_id = 'goya-social-club' AND name = 'zone club B'$q$, v_A));
  PERFORM pg_temp.expect('B UPDATE zone → soirée A', r, 'ERR:42501'); out := out || jsonb_build_object('B_update_to_A', r);
  r := pg_temp.try_dml(v_ownerB, format($q$UPDATE venue_floor_plans SET event_id = %L WHERE venue_id = 'goya-social-club' AND event_id IS NULL$q$, v_A));
  PERFORM pg_temp.expect('B UPDATE plan → soirée A', r, 'ERR:42501');

  -- Cas permis ensuite : le club womber écrit SES lignes de soirée (venue_id = womber, event_id = A).
  r := pg_temp.try_dml(v_ownerA, format($q$INSERT INTO table_zones (venue_id, event_id, name) VALUES ('womber', %L, 'zone A club')$q$, v_A));
  PERFORM pg_temp.expect('A zone de soirée', r, 'OK:1'); out := out || jsonb_build_object('A_event_zone', r);
  SELECT id INTO z_A FROM table_zones WHERE event_id = v_A AND name = 'zone A club';
  r := pg_temp.try_dml(v_ownerA, format($q$INSERT INTO table_packs (zone_id, venue_id, event_id, name, base_price) VALUES (%L, 'womber', %L, 'pack A club', 100)$q$, z_A, v_A));
  PERFORM pg_temp.expect('A pack de soirée', r, 'OK:1');
  r := pg_temp.try_dml(v_ownerA, format($q$INSERT INTO venue_floor_plans (venue_id, event_id, layout) VALUES ('womber', %L, '{"tables":[]}')$q$, v_A));
  PERFORM pg_temp.expect('A plan de soirée', r, 'OK:1');
  r := pg_temp.try_dml(v_ownerA, format($q$INSERT INTO table_packs (zone_id, venue_id, name, base_price) VALUES (%L, 'womber', 'pack de club A', 100)$q$, z_A));
  PERFORM pg_temp.expect('A pack de club', r, 'OK:1');

  -- B ne peut ni modifier ni supprimer les lignes de la soirée A (invisibles / refusées).
  r := pg_temp.try_dml(v_ownerB, format($q$UPDATE table_zones SET name = 'piraté' WHERE event_id = %L$q$, v_A));
  PERFORM pg_temp.expect('B UPDATE zones de A', r, 'OK:0');
  r := pg_temp.try_dml(v_ownerB, format($q$DELETE FROM table_packs WHERE event_id = %L$q$, v_A));
  PERFORM pg_temp.expect('B DELETE packs de A', r, 'OK:0');
  SELECT count(*) INTO n_after FROM table_zones WHERE event_id = v_A AND name = 'zone A club';
  IF n_after <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL la zone de A a été touchée'; END IF;

  -- L'organisateur : sa soirée sans club (venue_id NULL) passe, un venue_id étranger non, la soirée A non.
  r := pg_temp.try_dml(v_org, format($q$INSERT INTO table_zones (event_id, name) VALUES (%L, 'zone orga')$q$, v_SAT));
  PERFORM pg_temp.expect('orga zone sur sa soirée', r, 'OK:1'); out := out || jsonb_build_object('org_own_event', r);
  r := pg_temp.try_dml(v_org, format($q$INSERT INTO table_zones (event_id, venue_id, name) VALUES (%L, 'womber', 'zone étrangère')$q$, v_SAT));
  PERFORM pg_temp.expect('orga venue_id étranger', r, 'ERR:42501'); out := out || jsonb_build_object('org_foreign_venue', r);
  r := pg_temp.try_dml(v_org, format($q$INSERT INTO table_zones (event_id, name) VALUES (%L, 'zone sur A')$q$, v_A));
  PERFORM pg_temp.expect('orga sur soirée A', r, 'ERR:42501'); out := out || jsonb_build_object('org_on_A', r);
  r := pg_temp.try_dml(v_org, format($q$INSERT INTO venue_floor_plans (event_id, layout) VALUES (%L, '{"tables":[]}')$q$, v_SAT));
  PERFORM pg_temp.expect('orga plan sur sa soirée', r, 'OK:1');
  SELECT id INTO z_S FROM table_zones WHERE event_id = v_SAT AND name = 'zone orga';
  r := pg_temp.try_dml(v_org, format($q$INSERT INTO table_packs (zone_id, event_id, name, base_price) VALUES (%L, %L, 'pack orga', 50)$q$, z_S, v_SAT));
  PERFORM pg_temp.expect('orga pack sur sa soirée', r, 'OK:1');

  -- Lecture publique intacte (anon : la policy ALL est évaluée pour lui).
  r := pg_temp.try_anon($q$SELECT count(*) FROM table_zones$q$);
  PERFORM pg_temp.expect('anon lit zones', r, '');
  IF r LIKE 'ERR%' THEN RAISE EXCEPTION 'SMOKE_FAIL anon ne lit plus les zones: %', r; END IF;
  r := pg_temp.try_anon($q$SELECT count(*) FROM table_packs$q$);
  IF r LIKE 'ERR%' THEN RAISE EXCEPTION 'SMOKE_FAIL anon ne lit plus les packs: %', r; END IF;
  r := pg_temp.try_anon($q$SELECT count(*) FROM venue_floor_plans$q$);
  IF r LIKE 'ERR%' THEN RAISE EXCEPTION 'SMOKE_FAIL anon ne lit plus les plans: %', r; END IF;

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
