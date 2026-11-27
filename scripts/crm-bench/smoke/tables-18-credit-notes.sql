-- Smoke ANNULÉ — tables vague C2 : D15 (avoirs : total, partiels, billet, franchise, plafond, rejeu, filet, droits) et D14 (TVA des frais absorbés).
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-18-credit-notes.sql 20261227100000_invoice_fee_vat_seller_rate.sql 20261227110000_credit_notes.sql 20261227120000_credit_notes_sweep_accounting.sql 20261228110000_refund_confirmation_trace.sql
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
-- ── Fin du prélude ────────────────────────────────────────────────────────────────────────────────────────────

DO $smoke$
DECLARE
  v_owner uuid := 'a810aed8-1b10-4e41-b325-4bf07f657d72';  -- owner@ du club womber
  v_evB  uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';   -- soirée du club womber (démo)
  v_SAT  uuid := 'a0d17000-0000-4000-8000-000000000001';   -- soirée de l'organisateur ef75…
  v_org  uuid := 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';
  v_gold uuid := '6fe30ed6-994b-45bb-8e66-69917f0ca6bf';
  v_round uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; t1 uuid; t2 uuid;
  res jsonb; g text; n int; sum_amt numeric; sum_ht numeric; inv record; cn record; out jsonb := '{}'::jsonb;
BEGIN
  SELECT id INTO v_round FROM ticket_rounds WHERE event_id = v_evB LIMIT 1;
  IF v_round IS NULL THEN SELECT id INTO v_round FROM ticket_rounds LIMIT 1; END IF;

  -- 0. Table d'acompte du club (soirée démo) : facture, remboursement → AUCUN avoir (la démo n'émet rien).
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_evB, v_gold, 'c1@test', 500, 140, 5.60, 'paid', now(), 'smk18-1', false, 'online',
            '[{"kind":"deposit","cents":14000},{"kind":"fee","cents":561}]'::jsonb, 145.61) RETURNING id INTO r1;
  PERFORM issue_sale_invoice(NULL, r1, NULL);
  UPDATE table_reservations SET refund_amount = 50, refunded_at = now() WHERE id = r1;
  IF issue_credit_note(NULL, r1, NULL) IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL cas 0 : avoir émis sur une démo'; END IF;

  -- La suite du smoke joue des ventes RÉELLES : la démo est vidée (dans la transaction annulée).
  CREATE OR REPLACE FUNCTION public.demo_event_ids() RETURNS uuid[] LANGUAGE sql STABLE AS $x$ SELECT '{}'::uuid[] $x$;
  CREATE OR REPLACE FUNCTION public.demo_venue_ids() RETURNS text[] LANGUAGE sql STABLE AS $x$ SELECT '{}'::text[] $x$;

  -- 1. Remboursement partiel de 50 € sur la table : un avoir de 50 € (base), club à 20 %, numéro FAC-AV-<année>-00001.
  res := issue_credit_note(NULL, r1, NULL);
  IF res IS NULL OR (res->>'amount')::numeric <> 50 OR res->>'credit_number' !~ '^[A-Z]+-AV-[0-9]{4}-0*1$' THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 1 : %', res;
  END IF;
  SELECT * INTO cn FROM credit_notes WHERE id = (res->>'id')::uuid;
  IF cn.total_ht <> 41.67 OR cn.tva <> 8.33 OR cn.base_cents <> 5000 OR cn.fee_cents <> 0 OR cn.kind <> 'table' OR cn.vat_rate <> 20 THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 1 détail : %', to_jsonb(cn);
  END IF;
  out := out || jsonb_build_object('numero_1', res->>'credit_number');

  -- 2. Rejeu : rien. Puis second remboursement partiel (cumul 100) : un second avoir de 50 €, numéro suivant.
  IF issue_credit_note(NULL, r1, NULL) IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL cas 2 : rejeu a émis'; END IF;
  UPDATE table_reservations SET refund_amount = 100 WHERE id = r1;
  res := issue_credit_note(NULL, r1, NULL);
  IF res IS NULL OR (res->>'amount')::numeric <> 50 OR res->>'credit_number' !~ '-AV-[0-9]{4}-0*2$' THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 2b : %', res;
  END IF;

  -- 3. Plafond d'abord sur la base, puis les frais : cumul 145,61 = le TTC facturé → dernier avoir 45,61 (40 de base + 5,61 de frais),
  --    et le HT cumulé des avoirs retombe EXACTEMENT sur le HT de la facture.
  UPDATE table_reservations SET refund_amount = 145.61 WHERE id = r1;
  res := issue_credit_note(NULL, r1, NULL);
  SELECT * INTO cn FROM credit_notes WHERE id = (res->>'id')::uuid;
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = r1;
  SELECT sum(amount), sum(total_ht), count(*) INTO sum_amt, sum_ht, n FROM credit_notes WHERE invoice_id = inv.id;
  IF cn.amount <> 45.61 OR cn.base_cents <> 4000 OR cn.fee_cents <> 561 OR n <> 3 OR sum_amt <> inv.amount OR sum_ht <> round(inv.total_ht, 2) THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 3 : % / somme % HT % (facture % HT %)', to_jsonb(cn), sum_amt, sum_ht, inv.amount, inv.total_ht;
  END IF;

  -- 4. Au-delà du facturé : jamais (cumul 300 sur 145,61).
  UPDATE table_reservations SET refund_amount = 300 WHERE id = r1;
  IF issue_credit_note(NULL, r1, NULL) IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL cas 4 : avoir au-delà du facturé'; END IF;

  -- 5. Borne de l'appelant : p_up_to_cents plafonne le cumul vu (un second remboursement encore en vol n'est pas avoiré).
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_evB, v_gold, 'c2@test', 300, 300, 12, 'paid', now(), 'smk18-2', false, 'online',
            '[{"kind":"deposit","cents":30000},{"kind":"fee","cents":1200}]'::jsonb, 312) RETURNING id INTO r2;
  PERFORM issue_sale_invoice(NULL, r2, NULL);
  UPDATE table_reservations SET refund_amount = 120, refunded_at = now() - interval '2 hours' WHERE id = r2;
  res := issue_credit_note(NULL, r2, NULL, 7000);
  IF (res->>'amount')::numeric <> 70 THEN RAISE EXCEPTION 'SMOKE_FAIL cas 5 : %', res; END IF;

  -- 6. Franchise (organisateur) : acompte à 0 %, frais Yuno à 20 % ; remboursement total → HT cumulé = HT facture.
  UPDATE organizer_profiles SET vat_regime = 'franchise' WHERE user_id = v_org;
  INSERT INTO table_reservations (event_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_SAT, 'c4@test', 400, 100, 4, 'paid', now(), 'smk18-4', false, 'online',
            '[{"kind":"deposit","cents":10000},{"kind":"fee","cents":400}]'::jsonb, 104) RETURNING id INTO r4;
  PERFORM issue_sale_invoice(NULL, r4, NULL);
  UPDATE table_reservations SET refund_amount = 104 WHERE id = r4;
  res := issue_credit_note(NULL, r4, NULL);
  SELECT * INTO cn FROM credit_notes WHERE id = (res->>'id')::uuid;
  IF cn.seller_kind <> 'organizer' OR cn.amount <> 104 OR cn.vat_rate <> 0 OR cn.fee_vat_rate <> 20
     OR cn.total_ht <> round(100 + 4 / 1.2, 2) OR res->>'credit_number' !~ '^ORG-AV-[0-9]{4}-0*1$' THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 6 : %', to_jsonb(cn);
  END IF;
  -- Partiel de 50 sur franchise : 50 de base à 0 %, HT = TTC.
  INSERT INTO table_reservations (event_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_SAT, 'c4b@test', 400, 100, 4, 'paid', now(), 'smk18-4b', false, 'online',
            '[{"kind":"deposit","cents":10000},{"kind":"fee","cents":400}]'::jsonb, 104) RETURNING id INTO r6;
  PERFORM issue_sale_invoice(NULL, r6, NULL);
  UPDATE table_reservations SET refund_amount = 50 WHERE id = r6;
  res := issue_credit_note(NULL, r6, NULL);
  SELECT * INTO cn FROM credit_notes WHERE id = (res->>'id')::uuid;
  IF cn.total_ht <> 50 OR cn.tva <> 0 OR res->>'credit_number' !~ '-AV-[0-9]{4}-0*2$' THEN RAISE EXCEPTION 'SMOKE_FAIL cas 6b : %', to_jsonb(cn); END IF;

  -- 7. D14 : frais ABSORBÉS en franchise → la ligne de frais est à 0 % aussi (TVA de la facture = 0), puis au taux 20 % pour un assujetti.
  INSERT INTO table_reservations (event_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_SAT, 'c3@test', 800, 200, 8, 'paid', now(), 'smk18-3', true, 'online',
            '[{"kind":"deposit","cents":20000},{"kind":"fee","cents":331}]'::jsonb, 203.31) RETURNING id INTO r3;
  PERFORM issue_sale_invoice(NULL, r3, NULL);
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = r3;
  IF inv.tva <> 0 OR inv.total_ht <> 203.31 OR inv.vat_rate <> 0 OR inv.fee_vat_rate <> 0 THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 7 (franchise absorbé) : %', to_jsonb(inv) - 'qr_code';
  END IF;
  UPDATE organizer_profiles SET vat_regime = 'subject' WHERE user_id = v_org;
  INSERT INTO table_reservations (event_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_SAT, 'c3b@test', 800, 200, 8, 'paid', now(), 'smk18-3b', true, 'online',
            '[{"kind":"deposit","cents":20000},{"kind":"fee","cents":331}]'::jsonb, 203.31) RETURNING id INTO r5;
  PERFORM issue_sale_invoice(NULL, r5, NULL);
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = r5;
  IF inv.fee_vat_rate <> 20 OR round(inv.total_ht, 2) <> round(203.31 / 1.2, 2) THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 7b (assujetti absorbé) : %', to_jsonb(inv) - 'qr_code';
  END IF;
  -- Frais NON absorbés en franchise : la ligne de frais reste un frais Yuno à 20 %.
  UPDATE organizer_profiles SET vat_regime = 'franchise' WHERE user_id = v_org;
  INSERT INTO table_reservations (event_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_SAT, 'c3c@test', 400, 100, 4, 'paid', now(), 'smk18-3c', false, 'online',
            '[{"kind":"deposit","cents":10000},{"kind":"fee","cents":400}]'::jsonb, 104) RETURNING id INTO r3;
  PERFORM issue_sale_invoice(NULL, r3, NULL);
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = r3;
  IF inv.fee_vat_rate <> 20 OR inv.vat_rate <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL cas 7c : %', to_jsonb(inv) - 'qr_code'; END IF;

  -- 8. Billet : facture, remboursement partiel de 4 € (frais de service et assurance jamais rendus), avoir de 4 €.
  INSERT INTO tickets (event_id, ticket_round_id, user_email, quantity, unit_price, total_price, service_fee, insurance_fee, status, paid_at, qr_code, stripe_session_id)
    VALUES (v_evB, v_round, 't1@test', 1, 20, 20.99, 0.99, 0, 'paid', now(), 'smk18-t1', 'cs_smk18') RETURNING id INTO t1;
  PERFORM issue_sale_invoice(t1, NULL, NULL);
  UPDATE tickets SET refund_amount = 4, refunded_at = now() - interval '1 hour' WHERE id = t1;
  res := issue_credit_note(t1, NULL, NULL);
  IF res IS NULL OR (res->>'amount')::numeric <> 4 THEN RAISE EXCEPTION 'SMOKE_FAIL cas 8 : %', res; END IF;
  SELECT * INTO cn FROM credit_notes WHERE id = (res->>'id')::uuid;
  IF cn.kind <> 'ticket' OR cn.total_ht <> 3.33 OR cn.base_cents <> 400 THEN RAISE EXCEPTION 'SMOKE_FAIL cas 8 détail : %', to_jsonb(cn); END IF;
  -- Remboursement total rendu (cap = 20 €, frais gardés) : l'avoir couvre 20 €, jamais les 0,99 € de frais de service.
  UPDATE tickets SET refund_amount = 20, status = 'refunded' WHERE id = t1;
  res := issue_credit_note(t1, NULL, NULL);
  IF (res->>'amount')::numeric <> 16 THEN RAISE EXCEPTION 'SMOKE_FAIL cas 8b : %', res; END IF;

  -- 9. Table réglée sur place : pas de facture, pas d'avoir.
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, status, paid_at, qr_code, payment_mode)
    VALUES (v_evB, v_gold, 'os@test', 300, 0, 'confirmed', now(), 'smk18-os', 'on_site') RETURNING id INTO r5;
  UPDATE table_reservations SET refund_amount = 10 WHERE id = r5;
  IF issue_credit_note(NULL, r5, NULL) IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL cas 9 : avoir sur une vente sans facture'; END IF;

  -- 10. Immuabilité : service (postgres ici) ne change ni montant ni numéro ; un client ne supprime ni ne modifie.
  BEGIN
    UPDATE credit_notes SET amount = 1, base_cents = 100 WHERE id = (SELECT id FROM credit_notes LIMIT 1);
    RAISE EXCEPTION 'SMOKE_FAIL cas 10 : avoir modifié';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
  g := pg_temp.try_dml(v_owner, 'DELETE FROM credit_notes');
  PERFORM pg_temp.expect('delete client', g, 'ERR:42501');
  g := pg_temp.try_dml(v_owner, 'UPDATE credit_notes SET reason = ''x''');
  PERFORM pg_temp.expect('update client', g, 'ERR:42501');
  g := pg_temp.try_dml(v_owner, 'INSERT INTO credit_notes (invoice_id) SELECT id FROM invoices LIMIT 1');
  PERFORM pg_temp.expect('insert client', g, 'ERR:42501');

  -- 11. Lecture : le propriétaire du club voit les avoirs de SON club (r1 : 3, ticket : 2), un inconnu rien ; anonyme : aucune lecture directe.
  g := pg_temp.try_q(v_owner, format('SELECT count(*) FROM credit_notes WHERE table_reservation_id = %L', r1));
  PERFORM pg_temp.expect('owner voit', g, '3');
  g := pg_temp.try_q('00000000-0000-4000-8000-0000000000aa', 'SELECT count(*) FROM credit_notes');
  PERFORM pg_temp.expect('inconnu', g, '0');
  g := pg_temp.try_anon('(SELECT count(*) FROM credit_notes)');
  PERFORM pg_temp.expect('anon direct', g, 'ERR:42501');
  -- Lien public par jeton.
  SELECT public_token INTO g FROM credit_notes WHERE table_reservation_id = r1 LIMIT 1;
  res := get_credit_note_by_token(g);
  IF res IS NULL OR res->>'credit_number' IS NULL OR res->'seller'->>'name' IS NULL OR res->>'invoice_number' IS NULL THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 11 jeton : %', res;
  END IF;
  g := pg_temp.try_anon(format('get_credit_note_by_token(%L)', (SELECT public_token FROM credit_notes WHERE table_reservation_id = r1 LIMIT 1)));
  PERFORM pg_temp.expect('anon par jeton', g, '{');
  IF get_credit_note_by_token('0123456789abcdef0123456789abcdef') IS NOT NULL OR get_credit_note_by_token('x') IS NOT NULL THEN
    RAISE EXCEPTION 'SMOKE_FAIL cas 11 : jeton inconnu accepté';
  END IF;
  -- Document pour un compte connecté : le propriétaire oui, un inconnu non.
  g := pg_temp.try_q(v_owner, format('public.get_credit_note_doc(%L)', (SELECT id FROM credit_notes WHERE table_reservation_id = r1 LIMIT 1)));
  PERFORM pg_temp.expect('doc owner', g, '{');
  g := pg_temp.try_q('00000000-0000-4000-8000-0000000000aa', format('public.get_credit_note_doc(%L)', (SELECT id FROM credit_notes WHERE table_reservation_id = r1 LIMIT 1)));
  PERFORM pg_temp.expect('doc inconnu', g, '<null>');

  -- 12. Compta : get_accounting_credit_notes(club) rend les avoirs de la portée.
  g := pg_temp.try_q(v_owner, 'jsonb_array_length(public.get_accounting_credit_notes(''womber''))');
  IF g::int < 6 THEN RAISE EXCEPTION 'SMOKE_FAIL cas 12 : % avoirs pour le club', g; END IF;

  -- 13. Filet horaire : une vente remboursée il y a plus de 15 min est rattrapée ; une remboursée à l'instant attend.
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_evB, v_gold, 'sw1@test', 300, 100, 4, 'paid', now(), 'smk18-sw1', false, 'online',
            '[{"kind":"deposit","cents":10000},{"kind":"fee","cents":400}]'::jsonb, 104) RETURNING id INTO r5;
  PERFORM issue_sale_invoice(NULL, r5, NULL);
  INSERT INTO table_reservations (event_id, pack_id, user_email, total_price, deposit, management_fee, status, paid_at, qr_code, fee_absorbed, payment_mode, charged_lines, charged_total)
    VALUES (v_evB, v_gold, 'sw2@test', 300, 100, 4, 'paid', now(), 'smk18-sw2', false, 'online',
            '[{"kind":"deposit","cents":10000},{"kind":"fee","cents":400}]'::jsonb, 104) RETURNING id INTO r6;
  PERFORM issue_sale_invoice(NULL, r6, NULL);
  UPDATE table_reservations SET refund_amount = 30, refunded_at = now() - interval '1 hour' WHERE id = r5;
  UPDATE table_reservations SET refund_amount = 30, refunded_at = now() WHERE id = r6;
  PERFORM confirm_sale_refund('table', r5, 3000);  -- remboursement confirmé par Stripe (trace posée par l'edge)
  res := issue_missing_invoices();
  IF (res->'credit_notes'->>'issued')::int < 1 OR (res->'credit_notes'->>'failed')::int <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL cas 13 : %', res; END IF;
  IF NOT EXISTS (SELECT 1 FROM credit_notes WHERE table_reservation_id = r5 AND source = 'sweep') THEN RAISE EXCEPTION 'SMOKE_FAIL cas 13 : vente ancienne non rattrapée'; END IF;
  IF EXISTS (SELECT 1 FROM credit_notes WHERE table_reservation_id = r6) THEN RAISE EXCEPTION 'SMOKE_FAIL cas 13 : vente récente avoirée trop tôt'; END IF;
  -- Rejeu du filet : rien de plus.
  res := issue_missing_credit_notes();
  IF (res->>'issued')::int <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL cas 13 : rejeu %', res; END IF;

  -- 14. Droits : les fonctions d'émission ne sont pas ouvertes aux clients.
  g := pg_temp.try_q(v_owner, format('public.issue_credit_note(NULL, %L)', r1));
  PERFORM pg_temp.expect('issue client', g, 'ERR:42501');
  g := pg_temp.try_anon('public.issue_missing_credit_notes()');
  PERFORM pg_temp.expect('sweep anon', g, 'ERR:42501');

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
