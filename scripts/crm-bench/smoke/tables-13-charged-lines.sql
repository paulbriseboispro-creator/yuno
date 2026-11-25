-- Smoke ANNULÉ — tables vague A bis, B1 / M1 / I4 : montants prélevés stockés au checkout, facture lue depuis là, colonnes protégées.
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-13-charged-lines.sql 20261225160000_tables_deposit_invoice.sql 20261225180000_tables_placement_columns.sql 20261225220000_tables_charged_lines_receipt.sql
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
  v_evB  uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';
  v_SAT  uuid := 'a0d17000-0000-4000-8000-000000000001';
  v_org  uuid := 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';
  v_gold uuid := '6fe30ed6-994b-45bb-8e66-69917f0ca6bf';
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid;
  inv record; out jsonb := '{}'::jsonb; g text;
BEGIN
  -- 1. Montants stockés : la ligne de frais de la session (5,61) diffère de l'estimation (management_fee 5,60) → la facture suit la session.
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_evB, v_gold, 'c1@test', 500, 140, 5.60, 'paid', now(), 'smk13-1', false, 'online',
            '[{"kind":"deposit","cents":14000},{"kind":"fee","cents":561}]'::jsonb, 145.61) RETURNING id INTO r1;
  PERFORM issue_sale_invoice(NULL, r1, NULL);
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = r1;
  IF inv.amount <> 145.61 OR inv.service_fee <> 0 OR inv.management_fee <> 0 OR jsonb_array_length(inv.items) <> 2
     OR (inv.items->1->>'total')::numeric <> 5.61 OR (inv.items->0->>'total')::numeric <> 140
     OR inv.invoice_kind <> 'deposit' OR inv.remaining_on_site <> 360
     OR (SELECT sum((i->>'total')::numeric) FROM jsonb_array_elements(inv.items) i) <> inv.amount THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 1 : %', to_jsonb(inv) - 'qr_code';
  END IF;
  out := out || jsonb_build_object('stored_lines', jsonb_build_object('amount', inv.amount, 'items_sum', 145.61));

  -- 2. Paiement intégral : « Table VIP », une seule ligne de frais, pas de kind d'acompte.
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_evB, v_gold, 'c2@test', 300, 300, 12, 'paid', now(), 'smk13-2', false, 'online',
            '[{"kind":"deposit","cents":30000},{"kind":"fee","cents":1200}]'::jsonb, 312) RETURNING id INTO r2;
  PERFORM issue_sale_invoice(NULL, r2, NULL);
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = r2;
  IF inv.amount <> 312 OR inv.invoice_kind IS NOT NULL OR inv.remaining_on_site IS NOT NULL OR jsonb_array_length(inv.items) <> 2
     OR inv.items->0->>'kind' <> 'table' THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 2 : %', to_jsonb(inv) - 'qr_code';
  END IF;

  -- 3. Frais absorbés : la ligne de frais est la prise en charge des frais Stripe (3,31), jamais les 8 € de frais de gestion.
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_evB, v_gold, 'c3@test', 800, 200, 8, 'paid', now(), 'smk13-3', true, 'online',
            '[{"kind":"deposit","cents":20000},{"kind":"fee","cents":331}]'::jsonb, 203.31) RETURNING id INTO r3;
  PERFORM issue_sale_invoice(NULL, r3, NULL);
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = r3;
  IF inv.amount <> 203.31 OR inv.management_fee <> 0 OR (inv.items->1->>'total')::numeric <> 3.31
     OR (SELECT sum((i->>'total')::numeric) FROM jsonb_array_elements(inv.items) i) <> 203.31 THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 3 : %', to_jsonb(inv) - 'qr_code';
  END IF;

  -- 4. Franchise de TVA : acompte sans TVA, frais de service à 20 %.
  UPDATE organizer_profiles SET vat_regime = 'franchise' WHERE user_id = v_org;
  INSERT INTO table_reservations (event_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_SAT, 'c4@test', 400, 100, 4, 'paid', now(), 'smk13-4', false, 'online',
            '[{"kind":"deposit","cents":10000},{"kind":"fee","cents":400}]'::jsonb, 104) RETURNING id INTO r4;
  PERFORM issue_sale_invoice(NULL, r4, NULL);
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = r4;
  IF inv.seller_kind <> 'organizer' OR inv.amount <> 104 OR round(inv.total_ht, 4) <> round(100 + 4 / 1.2, 4)
     OR round(inv.amount - inv.total_ht, 4) <> round(4 - 4 / 1.2, 4) THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 4 : %', to_jsonb(inv) - 'qr_code';
  END IF;
  out := out || jsonb_build_object('franchise', jsonb_build_object('ht', round(inv.total_ht, 2), 'tva', round(inv.tva, 2)));

  -- 5. Réservation sans montants stockés (démo, ancienne) : le repli d'avant (estimation) reste.
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode)
    VALUES (v_evB, v_gold, 'c5@test', 800, 200, 8, 'paid', now(), 'smk13-5', true, 'online') RETURNING id INTO r5;
  PERFORM issue_sale_invoice(NULL, r5, NULL);
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = r5;
  IF inv.amount <> 203.30 THEN RAISE EXCEPTION 'SMOKE_FAIL cas 5 : %', to_jsonb(inv) - 'qr_code'; END IF;

  -- 6. Colonnes protégées : un compte connecté (propriétaire du club) ne les écrit pas, ne lit pas le hachage… mais écrit un champ de service.
  g := pg_temp.try_dml(v_owner, format('UPDATE table_reservations SET charged_total = 1 WHERE id = %L', r1));
  PERFORM pg_temp.expect('charged_total client', g, 'ERR:42501');
  g := pg_temp.try_dml(v_owner, format('UPDATE table_reservations SET charged_lines = ''[]''::jsonb WHERE id = %L', r1));
  PERFORM pg_temp.expect('charged_lines client', g, 'ERR:42501');
  g := pg_temp.try_dml(v_owner, format('UPDATE table_reservations SET receipt_token_hash = ''x'' WHERE id = %L', r1));
  PERFORM pg_temp.expect('receipt hash client', g, 'ERR:42501');
  g := pg_temp.try_dml(v_owner, format('UPDATE table_reservations SET remarks = ''ok'' WHERE id = %L', r1));
  PERFORM pg_temp.expect('champ de service', g, 'OK:1');

  -- 7. CHECK : charged_lines doit être un tableau, charged_total ≥ 0.
  BEGIN
    UPDATE table_reservations SET charged_lines = '{"a":1}'::jsonb WHERE id = r1;
    RAISE EXCEPTION 'SMOKE_FAIL cas 7 : charged_lines objet accepté';
  EXCEPTION WHEN check_violation THEN NULL; END;

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
