-- Smoke ANNULÉ — tables vague A bis, I2 : porte « tables » (can_manage_event_vip_tables) séparée de la porte « soirée / billetterie ».
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-15-rights-split.sql 20261225100000_tables_policies_event_scope.sql 20261225110000_tables_rpc_grants.sql 20261225130000_tables_can_manage_team.sql 20261225180000_tables_placement_columns.sql 20261225200000_tables_set_placement.sql 20261225240000_tables_rights_split.sql
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
  v_org     uuid := 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';
  v_editor  uuid := 'd9f3f907-0167-46dd-bd12-be1e5942e339';  -- barman@ (éditeur d'équipe de l'organisateur)
  v_scanner uuid := 'c9559229-023c-470e-b5e2-339c0708b061';  -- bouncer@ (scanneur)
  v_mgr     uuid := 'c240b1d1-9cba-4cb5-ae2e-321f60d506e5';  -- alex.door@ (manager, permission « tables » seule)
  v_SAT     uuid := 'a0d17000-0000-4000-8000-000000000001';  -- soirée de l'organisateur, sans club
  v_A       uuid := '6b28b8ba-e022-4f40-be2f-1d2aaeb53f08';  -- soirée du club womber (solo club)
  v_AMORE   uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';  -- co-soirée, operations = venue
  r text; out jsonb := '{}'::jsonb;
BEGIN
  INSERT INTO org_members (organizer_user_id, member_user_id, member_email, role, invited_by, invitation_status, accepted_at) VALUES
    (v_org, v_editor,  'barman@womber.fr',  'editor',  v_org, 'accepted', now()),
    (v_org, v_scanner, 'bouncer@womber.fr', 'scanner', v_org, 'accepted', now());
  INSERT INTO manager_permissions (venue_id, user_id, can_manage_tables) VALUES ('womber', v_mgr, true)
    ON CONFLICT DO NOTHING;
  UPDATE manager_permissions SET can_manage_tables = true WHERE venue_id = 'womber' AND user_id = v_mgr;

  -- Porte « soirée » (billetterie) : l'éditeur d'équipe oui (D11), le manager « tables » NON, le scanneur non.
  PERFORM pg_temp.expect('éditeur : soirée', can_manage_event_tables(v_editor, v_SAT)::text, 'true');
  PERFORM pg_temp.expect('scanneur : soirée', can_manage_event_tables(v_scanner, v_SAT)::text, 'false');
  PERFORM pg_temp.expect('manager tables : soirée de club', can_manage_event_tables(v_mgr, v_A)::text, 'false');
  PERFORM pg_temp.expect('manager tables : co-soirée', can_manage_event_tables(v_mgr, v_AMORE)::text, 'false');
  -- Porte « tables » : l'éditeur oui, le manager « tables » oui, le scanneur non.
  PERFORM pg_temp.expect('éditeur : tables', can_manage_event_vip_tables(v_editor, v_SAT)::text, 'true');
  PERFORM pg_temp.expect('scanneur : tables', can_manage_event_vip_tables(v_scanner, v_SAT)::text, 'false');
  PERFORM pg_temp.expect('manager : tables soirée de club', can_manage_event_vip_tables(v_mgr, v_A)::text, 'true');
  PERFORM pg_temp.expect('manager : tables co-soirée ops = venue', can_manage_event_vip_tables(v_mgr, v_AMORE)::text, 'true');
  PERFORM pg_temp.expect('éditeur d''une autre orga : tables soirée de club', can_manage_event_vip_tables(v_editor, v_A)::text, 'false');
  PERFORM pg_temp.expect('NULL', COALESCE(can_manage_event_vip_tables(NULL, v_A), false)::text, 'false');
  out := out || jsonb_build_object('gates', 'ok');

  -- Effets réels : billetterie (mot de passe de prévente) — éditeur oui, manager tables non, scanneur non.
  r := pg_temp.try_q(v_editor, format('public.set_event_sale_password(%L, NULL)', v_SAT));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL éditeur : mot de passe de prévente : %', r; END IF;
  r := pg_temp.try_q(v_mgr, format('public.set_event_sale_password(%L, NULL)', v_A));
  PERFORM pg_temp.expect('manager tables : mot de passe de prévente refusé', r, 'ERR:42501');
  r := pg_temp.try_q(v_scanner, format('public.set_event_sale_password(%L, NULL)', v_SAT));
  PERFORM pg_temp.expect('scanneur : mot de passe de prévente refusé', r, 'ERR:42501');
  out := out || jsonb_build_object('ticketing_gate', 'ok');

  -- Effets réels : tables (RLS) — le manager écrit une zone de la soirée de son club, l'éditeur celle de son organisation, le scanneur rien.
  r := pg_temp.try_dml(v_mgr, format($q$INSERT INTO table_zones (venue_id, event_id, name) VALUES ('womber', %L, 'zone manager')$q$, v_A));
  PERFORM pg_temp.expect('manager INSERT zone de soirée', r, 'OK:1');
  r := pg_temp.try_dml(v_mgr, format($q$INSERT INTO table_packs (venue_id, event_id, zone_id, name, base_price, base_capacity) VALUES ('womber', %L, (SELECT id FROM table_zones WHERE name = 'zone manager' LIMIT 1), 'pack manager', 100, 4)$q$, v_A));
  PERFORM pg_temp.expect('manager INSERT formule de soirée', r, 'OK:1');
  r := pg_temp.try_dml(v_editor, format($q$INSERT INTO table_zones (event_id, name) VALUES (%L, 'zone éditeur')$q$, v_SAT));
  PERFORM pg_temp.expect('éditeur INSERT zone', r, 'OK:1');
  r := pg_temp.try_dml(v_scanner, format($q$INSERT INTO table_zones (event_id, name) VALUES (%L, 'zone scanneur')$q$, v_SAT));
  PERFORM pg_temp.expect('scanneur INSERT zone', r, 'ERR:42501');
  r := pg_temp.try_dml(v_editor, format($q$INSERT INTO table_zones (venue_id, event_id, name) VALUES ('womber', %L, 'zone éditeur chez le club')$q$, v_A));
  PERFORM pg_temp.expect('éditeur d''une autre orga INSERT zone d''un club', r, 'ERR:42501');
  -- Plan de la soirée (upsert_event_floor_plan, SECURITY INVOKER sous RLS) : l'éditeur oui, le scanneur non.
  r := pg_temp.try_q(v_editor, format($q$public.upsert_event_floor_plan(%L, '{"tables":[]}'::jsonb)$q$, v_SAT));
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL éditeur upsert plan : %', r; END IF;
  r := pg_temp.try_q(v_scanner, format($q$public.upsert_event_floor_plan(%L, '{"tables":[]}'::jsonb)$q$, v_SAT));
  IF r NOT LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL scanneur upsert plan : %', r; END IF;
  -- Mode des tables : l'éditeur passe la porte, le scanneur non ; le manager passe la porte d'une soirée de club (refus métier ensuite).
  r := pg_temp.try_q(v_editor, format('public.set_event_tables_mode(%L, ''basic'')', v_SAT));
  PERFORM pg_temp.expect('éditeur set_event_tables_mode', r, 'basic');
  r := pg_temp.try_q(v_scanner, format('public.set_event_tables_mode(%L, ''basic'')', v_SAT));
  PERFORM pg_temp.expect('scanneur set_event_tables_mode', r, 'ERR:P0001:Not allowed');
  r := pg_temp.try_q(v_mgr, format('public.set_event_tables_mode(%L, ''basic'')', v_A));
  PERFORM pg_temp.expect('manager set_event_tables_mode (porte passée)', r, 'ERR:P0001:Tables mode follows');
  out := out || jsonb_build_object('tables_gate', 'ok');

  -- Les policies publiques restent lisibles par anon (la fonction citée est exécutable par anon).
  r := pg_temp.try_anon($q$(SELECT count(*) FROM public.table_packs WHERE is_active)$q$);
  IF r LIKE 'ERR:%' THEN RAISE EXCEPTION 'SMOKE_FAIL anon lit table_packs : %', r; END IF;

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
