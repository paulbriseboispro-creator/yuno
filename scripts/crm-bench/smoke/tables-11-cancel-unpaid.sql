-- Smoke ANNULÉ — tables vague A, P4.3 : cancel_unpaid_table_reservation (+ pass Wallet, commission promoteur, QR invités).
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-11-cancel-unpaid.sql 20261225130000_tables_can_manage_team.sql 20261225170000_tables_pending_31min.sql 20261225180000_tables_placement_columns.sql 20261225190000_tables_client_receipt.sql 20261225200000_tables_set_placement.sql 20261225210000_tables_cancel_unpaid.sql
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
CREATE OR REPLACE FUNCTION pg_temp.cancel_as(p_uid uuid, p_resa uuid, p_reason text DEFAULT 'cancelled_by_organizer') RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_q(p_uid, format('public.cancel_unpaid_table_reservation(%L, %L)', p_resa, p_reason));
$f$;
DO $smoke$
DECLARE
  v_owner uuid := 'a810aed8-1b10-4e41-b325-4bf07f657d72';
  v_host  uuid := '95958e40-117d-4302-960d-652864d1bb9b';  -- hôte VIP : place, n'annule pas
  v_bar   uuid := 'd9f3f907-0167-46dd-bd12-be1e5942e339';
  v_partner uuid := 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';
  v_evB   uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';
  v_gold  uuid := '6fe30ed6-994b-45bb-8e66-69917f0ca6bf';
  v_zone  uuid := 'af1f18ef-ced9-4a2b-b191-1e18164f9b4b';
  v_promoter uuid := '318efd99-57a1-4576-b05e-fb2e04932af4';
  t text[]; r text; j jsonb; out jsonb := '{}'::jsonb; n int; b boolean;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid; r8 uuid; conv uuid;
BEGIN
  DELETE FROM table_reservations WHERE event_id = v_evB;
  UPDATE profiles SET venue_id = 'womber' WHERE id = v_host;
  SELECT array_agg(e->>'id' ORDER BY ord) INTO t FROM venue_floor_plans f, jsonb_array_elements(f.layout->'tables') WITH ORDINALITY AS x(e, ord) WHERE f.venue_id = 'womber' AND f.event_id IS NULL;

  -- r1 : table sur place, installée à t1, avec un pass Wallet et une commission promoteur en attente.
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, guest_count, status, paid_at, qr_code, payment_mode, assigned_table_id, placement_status)
    VALUES (v_evB, v_gold, v_zone, 'r1@t', 'R1', 500, 0, 3, 'paid', now(), 'smk11-1', 'on_site', t[1]::uuid, 'approved') RETURNING id INTO r1;
  INSERT INTO wallet_passes (serial, pass_type, reference_id, auth_token) VALUES ('v-' || r1, 'vip', r1, 'tok-smk11');
  INSERT INTO promoter_conversions (promoter_id, conversion_type, amount, commission, status, table_reservation_id) VALUES (v_promoter, 'table', 100, 10, 'pending', r1) RETURNING id INTO conv;
  -- r2 : ajout manuel (payée « au club », aucun paiement Stripe) ; r3 : payée en ligne ; r4 : payée avec seulement une session ; r5 : pending ; r6 : déjà annulée ; r7 : remboursée.
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, deposit, status, paid_at, qr_code, payment_mode, assigned_table_id)
    VALUES (v_evB, v_gold, v_zone, 'r2@t', 300, 0, 'paid', now(), 'smk11-2', 'online', t[2]::uuid) RETURNING id INTO r2;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, deposit, status, paid_at, qr_code, stripe_payment_intent_id)
    VALUES (v_evB, v_gold, v_zone, 'r3@t', 300, 100, 'paid', now(), 'smk11-3', 'pi_test_123') RETURNING id INTO r3;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, deposit, status, paid_at, qr_code, stripe_session_id)
    VALUES (v_evB, v_gold, v_zone, 'r4@t', 300, 100, 'paid', now(), 'smk11-4', 'cs_test_123') RETURNING id INTO r4;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, deposit, status, qr_code)
    VALUES (v_evB, v_gold, v_zone, 'r5@t', 300, 100, 'pending', 'smk11-5') RETURNING id INTO r5;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, deposit, status, qr_code)
    VALUES (v_evB, v_gold, v_zone, 'r6@t', 300, 100, 'cancelled', 'smk11-6') RETURNING id INTO r6;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, deposit, status, qr_code)
    VALUES (v_evB, v_gold, v_zone, 'r7@t', 300, 100, 'refunded', 'smk11-7') RETURNING id INTO r7;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, deposit, status, paid_at, qr_code, payment_mode)
    VALUES (v_evB, v_gold, v_zone, 'r8@t', 300, 0, 'paid', now(), 'smk11-8', 'on_site') RETURNING id INTO r8;

  -- Droits : hôte VIP pur, barman, anonyme refusés.
  PERFORM pg_temp.expect('hôte VIP pur', pg_temp.cancel_as(v_host, r1), 'ERR:42501:not_allowed');
  PERFORM pg_temp.expect('barman', pg_temp.cancel_as(v_bar, r1), 'ERR:42501:not_allowed');
  PERFORM pg_temp.expect('anon', pg_temp.try_anon(format('public.cancel_unpaid_table_reservation(%L, ''x'')', r1)), 'ERR:42501');
  out := out || jsonb_build_object('rights_refused', 3);

  -- Refus métier.
  PERFORM pg_temp.expect('payée en ligne (payment intent)', pg_temp.cancel_as(v_owner, r3), 'ERR:YU006:use_refund');
  PERFORM pg_temp.expect('payée en ligne (session)', pg_temp.cancel_as(v_owner, r4), 'ERR:YU006:use_refund');
  PERFORM pg_temp.expect('en attente de paiement', pg_temp.cancel_as(v_owner, r5), 'ERR:YU008:reservation_not_active');
  PERFORM pg_temp.expect('déjà annulée', pg_temp.cancel_as(v_owner, r6), 'ERR:YU008:reservation_not_active');
  PERFORM pg_temp.expect('remboursée', pg_temp.cancel_as(v_owner, r7), 'ERR:YU008:reservation_not_active');
  PERFORM pg_temp.expect('inconnue', pg_temp.cancel_as(v_owner, gen_random_uuid()), 'ERR:P0002:reservation_not_found');
  SELECT count(*) INTO n FROM table_reservations WHERE id IN (r3, r4, r5) AND status <> 'cancelled';
  IF n <> 3 THEN RAISE EXCEPTION 'SMOKE_FAIL une résa refusée a bougé'; END IF;
  out := out || jsonb_build_object('refused', 'YU006 x2, YU008 x3, P0002');

  -- Annulation d'une table sur place par le propriétaire.
  j := pg_temp.cancel_as(v_owner, r1, 'cancelled_by_organizer')::jsonb;
  IF j->>'previous_status' <> 'paid' OR j->>'released_table' <> t[1] OR (j->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'SMOKE_FAIL retour : %', j; END IF;
  IF NOT EXISTS (SELECT 1 FROM table_reservations WHERE id = r1 AND status = 'cancelled' AND assigned_table_id IS NULL AND placement_status = 'none' AND refund_reason = 'cancelled_by_organizer') THEN
    RAISE EXCEPTION 'SMOKE_FAIL état après annulation';
  END IF;
  -- Pass Wallet invalidé, commission promoteur annulée.
  SELECT voided INTO b FROM wallet_passes WHERE serial = 'v-' || r1;
  IF b IS NOT TRUE THEN RAISE EXCEPTION 'SMOKE_FAIL le pass Wallet n''est pas invalidé'; END IF;
  IF (SELECT status FROM promoter_conversions WHERE id = conv) <> 'cancelled' THEN RAISE EXCEPTION 'SMOKE_FAIL commission promoteur non annulée'; END IF;
  out := out || jsonb_build_object('wallet_voided', true, 'promoter_conversion', 'cancelled');
  -- Rejouer = déjà annulée.
  PERFORM pg_temp.expect('rejouée', pg_temp.cancel_as(v_owner, r1), 'ERR:YU008:reservation_not_active');

  -- QR des invités : plus scannables (le garde ne laisse passer qu'une résa « paid »).
  SELECT count(*) INTO n FROM table_reservation_guests WHERE reservation_id = r1;
  IF n <> 3 THEN RAISE EXCEPTION 'SMOKE_FAIL invités attendus 3, vus %', n; END IF;
  UPDATE table_reservation_guests SET entry_scanned = true WHERE reservation_id = r1 AND guest_number = 1;
  SELECT count(*) INTO n FROM table_reservation_guests WHERE reservation_id = r1 AND entry_scanned;
  IF n <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL un QR invité d''une table annulée a été scanné'; END IF;
  j := pg_temp.try_anon(format('public.get_table_guest_pass(%L)', 'smk11-1-2'))::jsonb;
  IF (j->>'scannable')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'SMOKE_FAIL scannable : %', j; END IF;
  -- Contrôle : la même manipulation sur une résa payée passe.
  UPDATE table_reservation_guests SET entry_scanned = true WHERE reservation_id = r8 AND guest_number = 0;
  out := out || jsonb_build_object('guests_not_scannable', true);

  -- La table libérée : un autre client peut la prendre (t1) ; l'ajout manuel annulé par le partenaire (t2 libérée aussi).
  j := pg_temp.try_q(v_owner, format('public.vip_set_table_placement(%L, ''assign'', %L)', r8, t[1]))::jsonb;
  IF j->>'new_table' <> t[1] THEN RAISE EXCEPTION 'SMOKE_FAIL table libérée non attribuable : %', j; END IF;
  j := pg_temp.cancel_as(v_partner, r2)::jsonb;
  IF j->>'released_table' <> t[2] THEN RAISE EXCEPTION 'SMOKE_FAIL partenaire : %', j; END IF;
  -- Disponibilité publique : r1 et r2 n'y sont plus.
  SELECT count(*) INTO n FROM get_event_table_availability(v_evB) WHERE status = 'cancelled';
  IF n <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL disponibilité montre une annulée'; END IF;

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
