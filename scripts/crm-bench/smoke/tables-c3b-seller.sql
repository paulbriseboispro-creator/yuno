-- Smoke ANNULÉ — tables vague C3b, point 7 : le vendeur du reçu et de la facture est celui qui a ENCAISSÉ la vente.
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-c3b-seller.sql 20261228100000_event_seller_collector.sql
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
  v_orga uuid := 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';           -- organisateur démo
  v_ev uuid := 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';             -- soirée d'organisateur (démo)
  v_gold uuid := '6fe30ed6-994b-45bb-8e66-69917f0ca6bf';
  v_zgold uuid := 'af1f18ef-ced9-4a2b-b191-1e18164f9b4b';
  v_orga_name text; v_club_name text;
  r_org uuid; r_club uuid; r_none uuid; r_tr uuid;
  q_org text := 'smkc3b-org'; q_club text := 'smkc3b-club'; q_none text := 'smkc3b-none'; q_tr text := 'smkc3b-tr';
  s text; k text;
  out jsonb := '{}'::jsonb;
BEGIN
  DELETE FROM table_reservations WHERE event_id = v_ev;
  UPDATE events SET partner_venue_id = 'womber', event_mode = 'org_hosted', tables_mode = 'elite', tables_enabled = true,
                    start_at = now() + interval '5 days', end_at = now() + interval '5 days 6 hours', is_active = true, cancelled_at = NULL,
                    revenue_split_rules = '{"agreement":"external","tickets":{"organizer_pct":100,"venue_pct":0},"tables":{"organizer_pct":100,"venue_pct":0},"drinks":{"organizer_pct":0,"venue_pct":100}}'::jsonb
   WHERE id = v_ev;
  UPDATE venues SET stripe_account_id = 'acct_smokeclub', stripe_charges_enabled = true WHERE id = 'womber';
  UPDATE profiles SET stripe_connect_account_id = 'acct_smokeorga', stripe_connect_charges_enabled = true WHERE id = v_orga;
  SELECT COALESCE(NULLIF(o.legal_name, ''), o.display_name) INTO v_orga_name FROM organizer_profiles o WHERE o.user_id = v_orga;
  SELECT COALESCE(NULLIF(v.legal_name, ''), v.name) INTO v_club_name FROM venues v WHERE v.id = 'womber';
  IF v_orga_name IS NULL OR v_club_name IS NULL OR v_orga_name = v_club_name THEN RAISE EXCEPTION 'SMOKE_FAIL données de démo (orga %, club %)', v_orga_name, v_club_name; END IF;

  -- A. Quatre ventes de la même soirée : encaissée par l'organisateur, par le club, sans compte (sur place / démo), en virement vers l'orga.
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, deposit, status, paid_at, qr_code, guest_count, stripe_connected_account_id, payment_mode)
    VALUES (v_ev, v_gold, v_zgold, 'a@test.fr', 300, 100, 'paid', now(), q_org, 4, 'acct_smokeorga', 'online') RETURNING id INTO r_org;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, deposit, status, paid_at, qr_code, guest_count, stripe_connected_account_id, payment_mode)
    VALUES (v_ev, v_gold, v_zgold, 'b@test.fr', 300, 100, 'paid', now(), q_club, 4, 'acct_smokeclub', 'online') RETURNING id INTO r_club;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, deposit, status, paid_at, qr_code, guest_count, payment_mode)
    VALUES (v_ev, v_gold, v_zgold, 'c@test.fr', 300, 100, 'paid', now(), q_none, 4, 'on_site') RETURNING id INTO r_none;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, deposit, status, paid_at, qr_code, guest_count, stripe_connected_account_id, payment_mode, collab_split)
    VALUES (v_ev, v_gold, v_zgold, 'd@test.fr', 300, 100, 'paid', now(), q_tr, 4, 'acct_smokeclub', 'online', '{"mode":"transfer","collector":"organizer"}'::jsonb) RETURNING id INTO r_tr;

  -- B. Reçu : l'organisateur pour sa vente et pour le virement vers lui, le club pour la sienne, le club (règle d'avant) quand rien ne dit qui a encaissé.
  s := (SELECT x.name FROM get_event_seller(v_ev, q_org) x LIMIT 1);  IF s IS DISTINCT FROM v_orga_name THEN RAISE EXCEPTION 'SMOKE_FAIL reçu encaissé par l''orga : %', s; END IF;
  s := (SELECT x.name FROM get_event_seller(v_ev, q_club) x LIMIT 1); IF s IS DISTINCT FROM v_club_name THEN RAISE EXCEPTION 'SMOKE_FAIL reçu encaissé par le club : %', s; END IF;
  s := (SELECT x.name FROM get_event_seller(v_ev, q_none) x LIMIT 1); IF s IS DISTINCT FROM v_club_name THEN RAISE EXCEPTION 'SMOKE_FAIL reçu sans encaisseur connu (règle d''avant) : %', s; END IF;
  s := (SELECT x.name FROM get_event_seller(v_ev, q_tr) x LIMIT 1);   IF s IS DISTINCT FROM v_orga_name THEN RAISE EXCEPTION 'SMOKE_FAIL reçu virement vers l''orga : %', s; END IF;
  out := out || jsonb_build_object('receipt_org', v_orga_name, 'receipt_club', v_club_name);

  -- C. Facture : même vendeur que le reçu, numérotée dans la suite de CE vendeur.
  PERFORM issue_sale_invoice(NULL, r_org, NULL);
  PERFORM issue_sale_invoice(NULL, r_club, NULL);
  PERFORM issue_sale_invoice(NULL, r_tr, NULL);
  k := (SELECT seller_kind FROM invoice_numbers WHERE table_reservation_id = r_org);  IF k <> 'organizer' THEN RAISE EXCEPTION 'SMOKE_FAIL facture encaissée par l''orga : %', k; END IF;
  k := (SELECT seller_kind FROM invoice_numbers WHERE table_reservation_id = r_club); IF k <> 'venue' THEN RAISE EXCEPTION 'SMOKE_FAIL facture encaissée par le club : %', k; END IF;
  k := (SELECT seller_kind FROM invoice_numbers WHERE table_reservation_id = r_tr);   IF k <> 'organizer' THEN RAISE EXCEPTION 'SMOKE_FAIL facture virement vers l''orga : %', k; END IF;
  k := (SELECT seller_kind FROM invoices WHERE table_reservation_id = r_org);        IF k <> 'organizer' THEN RAISE EXCEPTION 'SMOKE_FAIL ligne invoices (orga) : %', k; END IF;
  out := out || jsonb_build_object('invoice_org', (SELECT invoice_number FROM invoice_numbers WHERE table_reservation_id = r_org),
                                   'invoice_club', (SELECT invoice_number FROM invoice_numbers WHERE table_reservation_id = r_club));

  -- D. La fonction du collecteur est fermée aux clients.
  s := pg_temp.try_q(gen_random_uuid(), format('public._sale_collector_kind(%L, ''acct_smokeorga'', NULL)', v_ev)); PERFORM pg_temp.expect('collecteur fermé aux clients', s, 'ERR:42501');
  s := pg_temp.try_anon(format('(SELECT count(*) FROM public.get_event_seller(%L, %L))', v_ev, q_org)); PERFORM pg_temp.expect('reçu lisible par le client sans compte (preuve = QR)', s, '1');

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
