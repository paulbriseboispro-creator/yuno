-- Smoke ANNULÉ — tables vague A, P3.2 : une table vendue ne quitte pas le plan (prevent_floor_plan_table_removal étendu).
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-6-sold-table-guard.sql 20261225150000_tables_sold_table_guard.sql
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
  v_evA   uuid := '6b28b8ba-e022-4f40-be2f-1d2aaeb53f08';  -- soirée du club, sera rendue PASSÉE
  v_evB   uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';  -- soirée du club, sera rendue À VENIR
  v_zone  uuid := '67cf00a9-aa14-41e6-8a56-b29389ae2cff';
  v_plan  uuid; v_planB uuid;
  t text[]; r text; out jsonb := '{}'::jsonb; i int;
BEGIN
  -- Soirées : A terminée hier, B dans dix jours.
  UPDATE events SET start_at = now() - interval '2 days', end_at = now() - interval '1 day' WHERE id = v_evA;
  UPDATE events SET start_at = now() + interval '10 days', end_at = now() + interval '10 days 6 hours' WHERE id = v_evB;
  SELECT id INTO v_plan FROM venue_floor_plans WHERE venue_id = 'womber' AND event_id IS NULL;
  SELECT array_agg(e->>'id' ORDER BY ord) INTO t FROM venue_floor_plans f, jsonb_array_elements(f.layout->'tables') WITH ORDINALITY AS x(e, ord) WHERE f.id = v_plan;
  IF array_length(t, 1) < 10 THEN RAISE EXCEPTION 'SMOKE_FAIL plan du club trop petit: %', array_length(t,1); END IF;
  DELETE FROM table_reservations WHERE event_id IN (v_evA, v_evB);

  -- Réservations de test (B = à venir, A = passée). Chaque cas vise une table différente.
  INSERT INTO table_reservations (event_id, user_email, total_price, status, zone_id, qr_code, requested_table_id, placement_status, assigned_table_id, created_at) VALUES
    (v_evB, 'c1@test', 100, 'paid',      v_zone, 'smk6-c1', t[1]::uuid, 'requested', NULL,        now()),                         -- demande vivante
    (v_evB, 'c2@test', 100, 'paid',      v_zone, 'smk6-c2', NULL,       'none',      t[2]::uuid,  now()),                         -- table attribuée
    (v_evB, 'c3@test', 100, 'pending',   v_zone, 'smk6-c3', t[3]::uuid, 'approved',  NULL,        now() - interval '5 minutes'),  -- pending récente
    (v_evB, 'c4@test', 100, 'pending',   v_zone, 'smk6-c4', NULL,       'none',      t[4]::uuid,  now() - interval '40 minutes'), -- pending périmée
    (v_evB, 'c5@test', 100, 'cancelled', v_zone, 'smk6-c5', NULL,       'none',      t[5]::uuid,  now()),                         -- annulée
    (v_evB, 'c6@test', 100, 'paid',      v_zone, 'smk6-c6', t[6]::uuid, 'rejected',  NULL,        now()),                         -- demande refusée
    (v_evB, 'c7@test', 100, 'paid',      v_zone, 'smk6-c7', t[7]::uuid, 'modified',  t[10]::uuid, now()),                         -- demande remplacée par t10
    (v_evA, 'c8@test', 100, 'paid',      v_zone, 'smk6-c8', NULL,       'none',      t[8]::uuid,  now() - interval '3 days');     -- soirée passée

  -- Retrait d'une table : UPDATE direct du plan du club, en tant que propriétaire (RLS).
  -- Cas refusés (YU003).
  FOR i IN 1..3 LOOP
    r := pg_temp.try_dml(v_owner, format($q$UPDATE venue_floor_plans SET layout = jsonb_set(layout, '{tables}', (SELECT jsonb_agg(e) FROM jsonb_array_elements(layout->'tables') e WHERE e->>'id' <> %L)) WHERE id = %L$q$, t[i], v_plan));
    PERFORM pg_temp.expect('refus table ' || i, r, 'ERR:YU003:table_has_reservation:' || t[i]);
  END LOOP;
  out := out || jsonb_build_object('refused_requested_assigned_pending_recent', 3);
  -- table 10 : tenue par c7 (assignée) → refusée aussi.
  r := pg_temp.try_dml(v_owner, format($q$UPDATE venue_floor_plans SET layout = jsonb_set(layout, '{tables}', (SELECT jsonb_agg(e) FROM jsonb_array_elements(layout->'tables') e WHERE e->>'id' <> %L)) WHERE id = %L$q$, t[10], v_plan));
  PERFORM pg_temp.expect('refus table 10 (assignée après modification)', r, 'ERR:YU003:table_has_reservation:' || t[10]);
  -- Deux tables retirées d'un coup, dont une vendue : refus, rien n'est retiré.
  r := pg_temp.try_dml(v_owner, format($q$UPDATE venue_floor_plans SET layout = jsonb_set(layout, '{tables}', (SELECT jsonb_agg(e) FROM jsonb_array_elements(layout->'tables') e WHERE e->>'id' <> ALL(%L::text[]))) WHERE id = %L$q$, ARRAY[t[9], t[1]], v_plan));
  PERFORM pg_temp.expect('refus lot avec une table vendue', r, 'ERR:YU003:table_has_reservation:' || t[1]);

  -- Cas permis : pending périmée (4), annulée (5), demande refusée (6), demande remplacée (7), soirée passée (8), table libre (9).
  FOR i IN 4..9 LOOP
    r := pg_temp.try_dml(v_owner, format($q$UPDATE venue_floor_plans SET layout = jsonb_set(layout, '{tables}', (SELECT jsonb_agg(e) FROM jsonb_array_elements(layout->'tables') e WHERE e->>'id' <> %L)) WHERE id = %L$q$, t[i], v_plan));
    PERFORM pg_temp.expect('permis table ' || i, r, 'OK:1');
  END LOOP;
  out := out || jsonb_build_object('allowed_stale_cancelled_rejected_modified_past_free', 6);

  -- Plan PROPRE à la soirée B : ses réservations lisent ce plan, plus celui du club.
  INSERT INTO venue_floor_plans (venue_id, event_id, layout) SELECT 'womber', v_evB, layout FROM venue_floor_plans WHERE id = v_plan RETURNING id INTO v_planB;
  -- table 2 (tenue par B) : retirable du plan du club (B ne s'en sert plus) …
  r := pg_temp.try_dml(v_owner, format($q$UPDATE venue_floor_plans SET layout = jsonb_set(layout, '{tables}', (SELECT jsonb_agg(e) FROM jsonb_array_elements(layout->'tables') e WHERE e->>'id' <> %L)) WHERE id = %L$q$, t[2], v_plan));
  PERFORM pg_temp.expect('plan club : table tenue par une soirée à plan propre', r, 'OK:1');
  -- … mais pas du plan de B, ni via upsert_event_floor_plan.
  r := pg_temp.try_dml(v_owner, format($q$UPDATE venue_floor_plans SET layout = jsonb_set(layout, '{tables}', (SELECT jsonb_agg(e) FROM jsonb_array_elements(layout->'tables') e WHERE e->>'id' <> %L)) WHERE id = %L$q$, t[2], v_planB));
  PERFORM pg_temp.expect('plan de la soirée : table vendue', r, 'ERR:YU003:table_has_reservation:' || t[2]);
  r := pg_temp.try_q(v_owner, format($q$public.upsert_event_floor_plan(%L, (SELECT jsonb_set(layout, '{tables}', (SELECT jsonb_agg(e) FROM jsonb_array_elements(layout->'tables') e WHERE e->>'id' <> %L)) FROM venue_floor_plans WHERE id = %L))$q$, v_evB, t[2], v_planB));
  PERFORM pg_temp.expect('upsert_event_floor_plan : table vendue', r, 'ERR:YU003:table_has_reservation:' || t[2]);
  -- upsert qui retire une table libre : passe et rend l'id du plan.
  r := pg_temp.try_q(v_owner, format($q$public.upsert_event_floor_plan(%L, (SELECT jsonb_set(layout, '{tables}', (SELECT jsonb_agg(e) FROM jsonb_array_elements(layout->'tables') e WHERE e->>'id' <> %L)) FROM venue_floor_plans WHERE id = %L))$q$, v_evB, t[11], v_planB));
  PERFORM pg_temp.expect('upsert_event_floor_plan : table libre', r, v_planB::text);
  out := out || jsonb_build_object('event_plan_scope', 'ok');

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
