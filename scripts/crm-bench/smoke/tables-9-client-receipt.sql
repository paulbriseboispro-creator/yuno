-- Smoke ANNULÉ — tables vague A, P1.1 / P1.2 : get_table_receipt + get_table_guest_pass (preuve = QR, anon compris).
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-9-client-receipt.sql 20261225180000_tables_placement_columns.sql 20261225190000_tables_client_receipt.sql
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
  v_evB uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';
  v_gold uuid := '6fe30ed6-994b-45bb-8e66-69917f0ca6bf';
  v_zone uuid := 'af1f18ef-ced9-4a2b-b191-1e18164f9b4b';
  v_c1 uuid := 'a810aed8-1b10-4e41-b325-4bf07f657d72';
  t text[]; tn text[]; r1 uuid; r2 uuid; r3 uuid; j jsonb; got text; n int; out jsonb := '{}'::jsonb;
BEGIN
  DELETE FROM table_reservations WHERE event_id = v_evB;
  SELECT array_agg(e->>'id' ORDER BY ord), array_agg(e->>'name' ORDER BY ord) INTO t, tn
    FROM venue_floor_plans f, jsonb_array_elements(f.layout->'tables') WITH ORDINALITY AS x(e, ord) WHERE f.venue_id = 'womber' AND f.event_id IS NULL;

  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, full_name, total_price, deposit, service_fee, management_fee, guest_count,
                                  status, paid_at, qr_code, requested_table_id, assigned_table_id, placement_status, placement_adjustment, placement_adjustment_amount)
    VALUES (v_evB, v_gold, v_zone, 'buyer@test', 'Jean Titulaire', 500, 140, 0, 5.6, 3, 'paid', now(), 'smk9-qr', t[1]::uuid, t[2]::uuid, 'modified', 'pay_on_site', 40)
    RETURNING id INTO r1;
  INSERT INTO table_reservations (event_id, pack_id, user_email, full_name, total_price, deposit, guest_count, status, qr_code)
    VALUES (v_evB, v_gold, 'other@test', 'Autre Client', 300, 100, 2, 'paid', 'smk9-other') RETURNING id INTO r2;
  INSERT INTO table_reservations (event_id, pack_id, user_email, full_name, total_price, deposit, guest_count, status, qr_code)
    VALUES (v_evB, v_gold, 'cancel@test', 'Annulé', 300, 100, 2, 'cancelled', 'smk9-cancel') RETURNING id INTO r3;
  SELECT count(*) INTO n FROM table_reservation_guests WHERE reservation_id = r1;
  IF n <> 3 THEN RAISE EXCEPTION 'SMOKE_FAIL les QR invités ne sont pas nés (%)', n; END IF;

  -- Reçu : bonne preuve (anon) → tout.
  got := pg_temp.try_anon(format('public.get_table_receipt(%L, %L)', r1, 'smk9-qr'));
  IF got LIKE 'ERR:%' OR got = '<null>' THEN RAISE EXCEPTION 'SMOKE_FAIL reçu anon : %', got; END IF;
  j := got::jsonb;
  IF j->>'status' <> 'paid' OR (j->>'scannable')::boolean IS NOT TRUE OR j->>'qr_code' <> 'smk9-qr'
     OR j->'event'->>'title' IS NULL OR j->'venue'->>'name' IS NULL OR j->'pack'->>'name' <> 'Gold Vip' OR j->'zone'->>'name' IS NULL
     OR j->>'requested_table_name' <> tn[1] OR j->>'assigned_table_name' <> tn[2]
     OR j->>'placement_status' <> 'modified' OR j->>'placement_adjustment' <> 'pay_on_site' OR (j->>'placement_adjustment_amount')::numeric <> 40
     OR (j->>'guest_count')::int <> 3 OR (j->>'total_price')::numeric <> 500 OR (j->>'deposit')::numeric <> 140
     OR (j->>'remaining_on_site')::numeric <> 360 OR j->'holder'->>'full_name' <> 'Jean Titulaire'
     OR jsonb_array_length(j->'guests') <> 3 OR (j->'guests'->0->>'guest_number')::int <> 0 OR (j->'guests'->2->>'guest_number')::int <> 2
     OR j->'guests'->0->>'full_name' <> 'Jean Titulaire' OR j->'guests'->1->>'qr_code' <> 'smk9-qr-2' THEN
    RAISE EXCEPTION 'SMOKE_FAIL contenu du reçu : %', j;
  END IF;
  out := out || jsonb_build_object('receipt_keys', (SELECT count(*) FROM jsonb_object_keys(j)), 'guests', jsonb_array_length(j->'guests'));
  -- Même reçu pour un utilisateur connecté.
  got := pg_temp.try_q(v_c1, format('public.get_table_receipt(%L, %L)', r1, 'smk9-qr'));
  IF got LIKE 'ERR:%' OR got = '<null>' THEN RAISE EXCEPTION 'SMOKE_FAIL reçu connecté : %', got; END IF;

  -- Mauvaises preuves : rien (NULL), jamais une erreur.
  PERFORM pg_temp.expect('mauvais qr', pg_temp.try_anon(format('public.get_table_receipt(%L, %L)', r1, 'smk9-nope')), '<null>');
  PERFORM pg_temp.expect('qr d''une autre résa', pg_temp.try_anon(format('public.get_table_receipt(%L, %L)', r1, 'smk9-other')), '<null>');
  PERFORM pg_temp.expect('qr nul', pg_temp.try_anon(format('public.get_table_receipt(%L, NULL)', r1)), '<null>');
  PERFORM pg_temp.expect('id inconnu', pg_temp.try_anon(format('public.get_table_receipt(%L, %L)', gen_random_uuid(), 'smk9-qr')), '<null>');
  PERFORM pg_temp.expect('qr d''un invité ne vaut pas preuve', pg_temp.try_anon(format('public.get_table_receipt(%L, %L)', r1, 'smk9-qr-2')), '<null>');
  out := out || jsonb_build_object('bad_proofs_return_null', 5);
  -- Un reçu d'une résa annulée se lit, mais n'est plus scannable.
  j := pg_temp.try_anon(format('public.get_table_receipt(%L, %L)', r3, 'smk9-cancel'))::jsonb;
  IF (j->>'scannable')::boolean IS NOT FALSE OR j->>'status' <> 'cancelled' THEN RAISE EXCEPTION 'SMOKE_FAIL reçu annulé : %', j; END IF;

  -- Laissez-passer d'un invité : seulement CE QR, rien sur l'acheteur ni le prix.
  got := pg_temp.try_anon(format('public.get_table_guest_pass(%L)', 'smk9-qr-3'));
  j := got::jsonb;
  IF j->>'qr_code' <> 'smk9-qr-3' OR (j->>'guest_number')::int <> 2 OR (j->>'is_holder')::boolean IS NOT FALSE OR (j->>'scannable')::boolean IS NOT TRUE
     OR j->'event'->>'title' IS NULL OR j->'event'->>'start_at' IS NULL OR j->'event'->>'timezone' IS NULL OR j->'event'->>'city' IS NULL
     OR j->>'pack_name' <> 'Gold Vip' THEN
    RAISE EXCEPTION 'SMOKE_FAIL laissez-passer : %', j;
  END IF;
  IF got ~* 'buyer@test|Jean Titulaire|total_price|deposit|user_email|full_name|"reservation_id"|smk9-qr"' THEN
    RAISE EXCEPTION 'SMOKE_FAIL le laissez-passer en dit trop : %', got;
  END IF;
  out := out || jsonb_build_object('guest_pass_keys', (SELECT array_agg(k) FROM jsonb_object_keys(j) k));
  -- Titulaire (invité 0) : pas de nom.
  j := pg_temp.try_anon(format('public.get_table_guest_pass(%L)', 'smk9-qr-1'))::jsonb;
  IF (j->>'is_holder')::boolean IS NOT TRUE OR j::text ~* 'Titulaire' THEN RAISE EXCEPTION 'SMOKE_FAIL invité 0 : %', j; END IF;
  -- Le QR de la réservation n'est pas un QR d'invité ; un QR inconnu ne donne rien ; une résa annulée n'est plus scannable.
  PERFORM pg_temp.expect('qr de la résa', pg_temp.try_anon(format('public.get_table_guest_pass(%L)', 'smk9-qr')), '<null>');
  PERFORM pg_temp.expect('qr inconnu', pg_temp.try_anon(format('public.get_table_guest_pass(%L)', 'zzz')), '<null>');
  PERFORM pg_temp.expect('qr nul', pg_temp.try_anon('public.get_table_guest_pass(NULL)'), '<null>');
  j := pg_temp.try_anon(format('public.get_table_guest_pass(%L)', 'smk9-cancel-2'))::jsonb;
  IF (j->>'scannable')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'SMOKE_FAIL invité d''une résa annulée scannable : %', j; END IF;
  out := out || jsonb_build_object('guest_pass_cancelled_not_scannable', true);

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
