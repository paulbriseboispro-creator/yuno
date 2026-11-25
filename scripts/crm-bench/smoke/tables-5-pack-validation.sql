-- Smoke ANNULÉ — tables vague A, P3.1 : validation des formules (trigger validate_table_pack).
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-5-pack-validation.sql 20261225140000_tables_pack_validation.sql
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
  v_SAT uuid := 'a0d17000-0000-4000-8000-000000000001';
  v_org uuid := 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';
  z uuid; p uuid; r text; out jsonb := '{}'::jsonb; k text; sqlt text;
  legacy int;
BEGIN
  INSERT INTO table_zones (event_id, name) VALUES (v_SAT, 'zone smoke') RETURNING id INTO z;

  -- Formules valides (les trois régimes) : passent.
  INSERT INTO table_packs (zone_id, event_id, name, base_price, deposit, deposit_type, base_capacity, max_extra_persons)
    VALUES (z, v_SAT, 'fixe ok', 300, 100, 'fixed', 6, 2) RETURNING id INTO p;
  INSERT INTO table_packs (zone_id, event_id, name, base_price, deposit, deposit_type) VALUES (z, v_SAT, 'fixe = prix', 300, 300, 'fixed');
  INSERT INTO table_packs (zone_id, event_id, name, base_price, deposit, deposit_type) VALUES (z, v_SAT, 'paiement intégral', 300, 0, 'fixed');
  INSERT INTO table_packs (zone_id, event_id, name, base_price, deposit, deposit_type) VALUES (z, v_SAT, 'pourcent', 300, 25, 'percentage');
  INSERT INTO table_packs (zone_id, event_id, name, base_price, deposit, deposit_type) VALUES (z, v_SAT, 'pourcent 100', 300, 100, 'percentage');
  INSERT INTO table_packs (zone_id, event_id, name, base_price, deposit, deposit_type, payment_mode) VALUES (z, v_SAT, 'sur place, acompte résiduel', 300, 500, 'fixed', 'on_site');
  out := out || jsonb_build_object('valid_inserts', 6);

  -- Cas refusés : un par raison (SQLSTATE YU002, message table_pack_invalid:<raison>).
  FOREACH k IN ARRAY ARRAY['price_negative','extra_price_negative','minimum_spend_negative','deposit_negative','capacity_min','extra_persons_negative','deposit_exceeds_price','deposit_percent_range','deposit_percent_range_zero'] LOOP
    sqlt := CASE k
      WHEN 'price_negative'          THEN 'INSERT INTO table_packs (zone_id, event_id, name, base_price) VALUES (%L, %L, ''x'', -1)'
      WHEN 'extra_price_negative'    THEN 'INSERT INTO table_packs (zone_id, event_id, name, base_price, extra_person_price) VALUES (%L, %L, ''x'', 10, -5)'
      WHEN 'minimum_spend_negative'  THEN 'INSERT INTO table_packs (zone_id, event_id, name, base_price, minimum_spend) VALUES (%L, %L, ''x'', 10, -5)'
      WHEN 'deposit_negative'        THEN 'INSERT INTO table_packs (zone_id, event_id, name, base_price, deposit) VALUES (%L, %L, ''x'', 10, -5)'
      WHEN 'capacity_min'            THEN 'INSERT INTO table_packs (zone_id, event_id, name, base_price, base_capacity) VALUES (%L, %L, ''x'', 10, 0)'
      WHEN 'extra_persons_negative'  THEN 'INSERT INTO table_packs (zone_id, event_id, name, base_price, max_extra_persons) VALUES (%L, %L, ''x'', 10, -1)'
      WHEN 'deposit_exceeds_price'   THEN 'INSERT INTO table_packs (zone_id, event_id, name, base_price, deposit, deposit_type) VALUES (%L, %L, ''x'', 300, 500, ''fixed'')'
      WHEN 'deposit_percent_range'   THEN 'INSERT INTO table_packs (zone_id, event_id, name, base_price, deposit, deposit_type) VALUES (%L, %L, ''x'', 300, 120, ''percentage'')'
      ELSE                                'INSERT INTO table_packs (zone_id, event_id, name, base_price, deposit, deposit_type) VALUES (%L, %L, ''x'', 300, 0, ''percentage'')'
    END;
    r := pg_temp.try_dml(v_org, format(sqlt, z, v_SAT));   -- en tant qu'organisateur, sous RLS : l'erreur arrive jusqu'au client
    PERFORM pg_temp.expect('refus ' || k, r, 'ERR:YU002:table_pack_invalid:' || replace(k, '_zero', ''));
  END LOOP;
  out := out || jsonb_build_object('refused_reasons', 9);

  -- UPDATE : modifier le prix de façon fautive est refusé ; un champ sans rapport (nom) passe ; toucher à une colonne sans la changer ne juge pas.
  r := pg_temp.try_dml(v_org, format($q$UPDATE table_packs SET deposit = 999 WHERE id = %L$q$, p));
  PERFORM pg_temp.expect('UPDATE acompte > prix', r, 'ERR:YU002:table_pack_invalid:deposit_exceeds_price');
  r := pg_temp.try_dml(v_org, format($q$UPDATE table_packs SET base_price = 50 WHERE id = %L$q$, p));   -- acompte 100 > nouveau prix 50
  PERFORM pg_temp.expect('UPDATE prix sous l''acompte', r, 'ERR:YU002:table_pack_invalid:deposit_exceeds_price');
  r := pg_temp.try_dml(v_org, format($q$UPDATE table_packs SET name = 'renommée', base_price = base_price WHERE id = %L$q$, p));
  PERFORM pg_temp.expect('UPDATE nom seul', r, 'OK:1');
  out := out || jsonb_build_object('update_checks', 'ok');

  -- Lignes héritées : le trigger n'en juge aucune (0 ligne fautive en base) ; une ligne fautive injectée « avant » le trigger
  -- se met à jour sur un champ sans rapport sans être bloquée.
  SELECT count(*) INTO legacy FROM table_packs
   WHERE (COALESCE(payment_mode,'online') = 'online' AND ((deposit_type = 'fixed' AND deposit > base_price) OR (deposit_type = 'percentage' AND (deposit <= 0 OR deposit > 100))))
      OR base_price < 0 OR base_capacity < 1 OR COALESCE(max_extra_persons, 0) < 0 OR COALESCE(deposit, 0) < 0;
  out := out || jsonb_build_object('rows_violating_after_smoke', legacy);
  ALTER TABLE table_packs DISABLE TRIGGER trg_validate_table_pack;
  INSERT INTO table_packs (zone_id, event_id, name, base_price, deposit, deposit_type) VALUES (z, v_SAT, 'héritée fautive', 100, 400, 'fixed') RETURNING id INTO p;
  ALTER TABLE table_packs ENABLE TRIGGER trg_validate_table_pack;
  r := pg_temp.try_dml(v_org, format($q$UPDATE table_packs SET description = 'texte' WHERE id = %L$q$, p));
  PERFORM pg_temp.expect('ligne héritée, champ sans rapport', r, 'OK:1');
  out := out || jsonb_build_object('legacy_row_untouched_update', r);

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
