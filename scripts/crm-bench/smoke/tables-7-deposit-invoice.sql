-- Smoke ANNULÉ — tables vague A, P2.3 : facture d'acompte d'une table (save_invoice_on_creation).
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-7-deposit-invoice.sql 20261225160000_tables_deposit_invoice.sql
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
  v_evB  uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';  -- soirée du club womber (vendeur = club, TVA 20 %)
  v_SAT  uuid := 'a0d17000-0000-4000-8000-000000000001';  -- soirée de l'organisateur organizer@ (sans club)
  v_org  uuid := 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';
  v_gold uuid := '6fe30ed6-994b-45bb-8e66-69917f0ca6bf';  -- « Gold Vip » 500 €, acompte 140 €
  v_silv uuid := '5f49fc44-be53-43d7-bd86-5daa1802f861';  -- « Silver VIP »
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid;
  inv record; n text; out jsonb := '{}'::jsonb;
  v_tid uuid; v_tprice numeric; v_ticket_amount numeric;
BEGIN
  -- 1. Acompte < total, frais de gestion payés par le client : 140 + 5,60 = 145,60 encaissés.
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode)
    VALUES (v_evB, v_gold, 'inv1@test', 500, 140, 5.60, 'paid', now(), 'smk7-1', false, 'online') RETURNING id INTO r1;
  n := issue_sale_invoice(NULL, r1, NULL);
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = r1;
  IF inv.amount <> 145.60 OR round(inv.total_ht, 4) <> round(145.60 / 1.2, 4) OR round(inv.tva, 4) <> round(145.60 - 145.60 / 1.2, 4)
     OR inv.invoice_kind <> 'deposit' OR inv.remaining_on_site <> 360 OR jsonb_array_length(inv.items) <> 2
     OR inv.items->0->>'description' <> 'Acompte table Gold Vip' OR (inv.items->0->>'total')::numeric <> 140
     OR inv.items->1->>'description' <> 'Frais de service' OR (inv.items->1->>'total')::numeric <> 5.60 THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 1 : % / %', to_jsonb(inv) - 'qr_code', n;
  END IF;
  out := out || jsonb_build_object('deposit_invoice', jsonb_build_object('amount', inv.amount, 'ht', round(inv.total_ht,2), 'tva', round(inv.tva,2), 'remaining', inv.remaining_on_site, 'kind', inv.invoice_kind));

  -- 2. Paiement intégral (acompte = total) : facture « normale » (pas d'invoice_kind), frais compris dans le montant.
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode)
    VALUES (v_evB, v_silv, 'inv2@test', 300, 300, 12, 'paid', now(), 'smk7-2', false, 'online') RETURNING id INTO r2;
  PERFORM issue_sale_invoice(NULL, r2, NULL);
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = r2;
  IF inv.amount <> 312 OR inv.invoice_kind IS NOT NULL OR inv.remaining_on_site IS NOT NULL
     OR round(inv.total_ht, 4) <> round(312 / 1.2, 4) OR inv.items->0->>'description' <> 'Table VIP Silver VIP' THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 2 : %', to_jsonb(inv) - 'qr_code';
  END IF;
  out := out || jsonb_build_object('full_payment_invoice', jsonb_build_object('amount', inv.amount, 'kind', inv.invoice_kind));

  -- 3. Le club absorbe les frais de gestion : le client paie l'estimation des frais Stripe (200 → 3,30 €), pas les frais de gestion (8 €).
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode)
    VALUES (v_evB, v_gold, 'inv3@test', 800, 200, 8, 'paid', now(), 'smk7-3', true, 'online') RETURNING id INTO r3;
  PERFORM issue_sale_invoice(NULL, r3, NULL);
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = r3;
  IF inv.amount <> 203.30 OR (inv.items->1->>'total')::numeric <> 3.30 OR inv.remaining_on_site <> 600 THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 3 : %', to_jsonb(inv) - 'qr_code';
  END IF;
  out := out || jsonb_build_object('absorbed_fee_invoice', inv.amount);

  -- 4. Organisateur seul, franchise de TVA (taux 0) : l'acompte n'a pas de TVA, les frais de service gardent 20 %.
  UPDATE organizer_profiles SET vat_regime = 'franchise' WHERE user_id = v_org;
  INSERT INTO table_reservations (event_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode)
    VALUES (v_SAT, 'inv4@test', 400, 100, 4, 'paid', now(), 'smk7-4', false, 'online') RETURNING id INTO r4;
  PERFORM issue_sale_invoice(NULL, r4, NULL);
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = r4;
  IF inv.seller_kind <> 'organizer' OR inv.amount <> 104 OR round(inv.total_ht, 4) <> round(100 + 4 / 1.2, 4)
     OR inv.items->0->>'description' <> 'Acompte table VIP' OR inv.remaining_on_site <> 300 THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 4 : %', to_jsonb(inv) - 'qr_code';
  END IF;
  out := out || jsonb_build_object('organizer_franchise_invoice', jsonb_build_object('amount', inv.amount, 'ht', round(inv.total_ht,2), 'tva', round(inv.tva,2)));

  -- 5. Une réservation réglée sur place n'a pas de facture.
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, payment_mode)
    VALUES (v_evB, v_silv, 'inv5@test', 300, 0, 0, 'paid', now(), 'smk7-5', 'on_site') RETURNING id INTO r5;
  BEGIN
    PERFORM issue_sale_invoice(NULL, r5, NULL);
    RAISE EXCEPTION 'SMOKE_FAIL cas 5 : facture émise pour une table sur place';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'invoice_on_site_sale' THEN RAISE; END IF;
  END;

  -- 6. Un billet garde son comportement d'avant : montant = total payé.
  SELECT t.id, t.total_price INTO v_tid, v_tprice FROM tickets t
   WHERE t.status IN ('paid', 'used') AND COALESCE(t.total_price, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM invoice_numbers n WHERE n.ticket_id = t.id) LIMIT 1;
  IF v_tid IS NULL THEN
    out := out || jsonb_build_object('ticket_invoice', 'aucun billet sans facture en base : non rejoué');
  ELSE
    PERFORM issue_sale_invoice(v_tid, NULL, NULL);
    SELECT amount INTO v_ticket_amount FROM invoices WHERE ticket_id = v_tid;
    IF v_ticket_amount IS DISTINCT FROM v_tprice THEN RAISE EXCEPTION 'SMOKE_FAIL billet : % <> %', v_ticket_amount, v_tprice; END IF;
    out := out || jsonb_build_object('ticket_invoice_amount', v_ticket_amount);
  END IF;

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
