-- Smoke ANNULÉ — tables vague A, P3.4 : can_manage_event_tables et l'équipe d'organisation.
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-4-team.sql 20261225130000_tables_can_manage_team.sql
-- Organisation = organizer@womber.fr. Membres posés dans la transaction : éditeur (barman@), scanneur (bouncer@),
-- éditeur en attente (viphost@), admin déjà en base (promoter@). Manager de club : alex.door@ avec can_manage_tables.
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
  v_admin   uuid := 'e7d838a6-3f97-456c-95df-8b4c874c953b';  -- promoter@ (admin accepté en base)
  v_editor  uuid := 'd9f3f907-0167-46dd-bd12-be1e5942e339';  -- barman@
  v_scanner uuid := 'c9559229-023c-470e-b5e2-339c0708b061';  -- bouncer@
  v_pending uuid := '95958e40-117d-4302-960d-652864d1bb9b';  -- viphost@
  v_unknown uuid := '2ce1f11d-6605-4cb4-b384-052fb1f6cdcb';  -- apple-demo3@
  v_mgr     uuid := 'c240b1d1-9cba-4cb5-ae2e-321f60d506e5';  -- alex.door@ (manager 'tables' du club womber)
  v_SAT     uuid := 'a0d17000-0000-4000-8000-000000000001';  -- soirée de l'orga, sans club
  v_A       uuid := '6b28b8ba-e022-4f40-be2f-1d2aaeb53f08';  -- soirée du club womber (solo club)
  v_AMORE   uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';  -- co-soirée, operations = venue, partenaire = organizer@
  v_BOTH    uuid := '1c4fcbff-f2d9-4865-ad3b-8d6df83effae';  -- co-soirée, operations = both, partenaire = organizer@
  r text; out jsonb := '{}'::jsonb; z uuid;
BEGIN
  INSERT INTO org_members (organizer_user_id, member_user_id, member_email, role, invited_by, invitation_status, accepted_at) VALUES
    (v_org, v_editor,  'barman@womber.fr',  'editor',  v_org, 'accepted', now()),
    (v_org, v_scanner, 'bouncer@womber.fr', 'scanner', v_org, 'accepted', now());
  INSERT INTO org_members (organizer_user_id, member_user_id, member_email, role, invited_by, invitation_status) VALUES
    (v_org, v_pending, 'viphost@womber.fr', 'editor', v_org, 'pending');
  INSERT INTO manager_permissions (venue_id, user_id, can_manage_tables) VALUES ('womber', v_mgr, true);

  -- Soirée de l'organisateur : fondateur, admin, éditeur oui ; scanneur, invitation en attente, inconnu non.
  PERFORM pg_temp.expect('fondateur', can_manage_event_tables(v_org, v_SAT)::text, 'true');
  PERFORM pg_temp.expect('admin d''équipe', can_manage_event_tables(v_admin, v_SAT)::text, 'true');
  PERFORM pg_temp.expect('éditeur d''équipe', can_manage_event_tables(v_editor, v_SAT)::text, 'true');
  PERFORM pg_temp.expect('scanneur', can_manage_event_tables(v_scanner, v_SAT)::text, 'false');
  PERFORM pg_temp.expect('éditeur en attente', can_manage_event_tables(v_pending, v_SAT)::text, 'false');
  PERFORM pg_temp.expect('inconnu', can_manage_event_tables(v_unknown, v_SAT)::text, 'false');
  PERFORM pg_temp.expect('NULL', COALESCE(can_manage_event_tables(NULL, v_SAT), false)::text, 'false');
  out := out || jsonb_build_object('SAT', jsonb_build_object('org', true, 'admin', true, 'editor', true, 'scanner', false, 'pending', false, 'unknown', false));

  -- Soirée du club : l'équipe de l'organisateur n'y a aucun droit ; le manager « tables » du club oui.
  PERFORM pg_temp.expect('éditeur sur soirée de club', can_manage_event_tables(v_editor, v_A)::text, 'false');
  PERFORM pg_temp.expect('manager tables sur soirée de club', can_manage_event_tables(v_mgr, v_A)::text, 'true');
  PERFORM pg_temp.expect('inconnu sur soirée de club', can_manage_event_tables(v_unknown, v_A)::text, 'false');

  -- Co-soirée dont les opérations reviennent au CLUB : ni le partenaire ni son équipe.
  PERFORM pg_temp.expect('partenaire, ops = venue', can_manage_event_tables(v_org, v_AMORE)::text, 'false');
  PERFORM pg_temp.expect('éditeur partenaire, ops = venue', can_manage_event_tables(v_editor, v_AMORE)::text, 'false');
  PERFORM pg_temp.expect('manager club, ops = venue', can_manage_event_tables(v_mgr, v_AMORE)::text, 'true');
  -- Co-soirée « both » : le partenaire et son équipe oui.
  PERFORM pg_temp.expect('partenaire, ops = both', can_manage_event_tables(v_org, v_BOTH)::text, 'true');
  PERFORM pg_temp.expect('éditeur partenaire, ops = both', can_manage_event_tables(v_editor, v_BOTH)::text, 'true');
  PERFORM pg_temp.expect('scanneur partenaire, ops = both', can_manage_event_tables(v_scanner, v_BOTH)::text, 'false');
  out := out || jsonb_build_object('co_event', 'ok');

  -- Effets réels sous RLS : l'éditeur écrit une zone et pose un « Complet » ; le scanneur n'écrit rien.
  r := pg_temp.try_dml(v_editor, format($q$INSERT INTO table_zones (event_id, name) VALUES (%L, 'zone éditeur')$q$, v_SAT));
  PERFORM pg_temp.expect('éditeur INSERT zone', r, 'OK:1'); out := out || jsonb_build_object('editor_insert_zone', r);
  r := pg_temp.try_dml(v_scanner, format($q$INSERT INTO table_zones (event_id, name) VALUES (%L, 'zone scanneur')$q$, v_SAT));
  PERFORM pg_temp.expect('scanneur INSERT zone', r, 'ERR:42501'); out := out || jsonb_build_object('scanner_insert_zone', r);
  r := pg_temp.try_dml(v_editor, format($q$UPDATE events SET tables_sold_out = false WHERE id = %L$q$, v_SAT));
  out := out || jsonb_build_object('editor_update_events', r);
  r := pg_temp.try_q(v_editor, format('public.set_event_tables_mode(%L, ''basic'')', v_SAT));
  PERFORM pg_temp.expect('éditeur set_event_tables_mode', r, 'basic'); out := out || jsonb_build_object('editor_set_mode', r);
  r := pg_temp.try_q(v_scanner, format('public.set_event_tables_mode(%L, ''basic'')', v_SAT));
  PERFORM pg_temp.expect('scanneur set_event_tables_mode', r, 'ERR:P0001:Not allowed');
  r := pg_temp.try_q(v_editor, format('public.enable_collab_tables(%L)', v_SAT));
  IF r NOT IN ('basic','elite') THEN RAISE EXCEPTION 'SMOKE_FAIL éditeur enable_collab_tables: %', r; END IF;
  out := out || jsonb_build_object('editor_enable', r);

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
