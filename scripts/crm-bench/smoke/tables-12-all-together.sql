-- Smoke ANNULÉ GLOBAL — tables vague A : TOUTES les migrations 20261225* rejouées à la suite, puis un parcours qui les traverse.
--   cd <worktree> && node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-12-all-together.sql $(cd supabase/migrations && ls 20261225*.sql)
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
CREATE OR REPLACE FUNCTION pg_temp.rts(p_event uuid, p_zone uuid, p_pack uuid, p_email text, p_table text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  BEGIN
    v := public.reserve_table_slot(
      _event_id => p_event, _zone_id => p_zone, _capacity_zone_id => p_zone, _pack_id => p_pack, _user_id => NULL, _user_email => p_email,
      _is_guest => true, _guest_count => 3, _deposit => 10, _total_price => 100, _management_fee => 1, _status => 'pending',
      _qr_code => 'smk12-' || p_email, _full_name => 'Test ' || p_email, _phone => NULL, _remarks => NULL, _newsletter_opt_in => false,
      _sms_opt_in => false, _requested_table_id => p_table, _placement_status => CASE WHEN p_table IS NULL THEN 'none' ELSE 'requested' END,
      _purchase_source => NULL);
    RETURN v::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'ERR:' || SQLSTATE || ':' || SQLERRM;
  END;
END $f$;
DO $smoke$
DECLARE
  v_owner uuid := 'a810aed8-1b10-4e41-b325-4bf07f657d72';
  v_evB   uuid := '135bab45-ebfb-4b87-bf34-28ade93e1ed1';
  v_gold  uuid := '6fe30ed6-994b-45bb-8e66-69917f0ca6bf';
  v_zone  uuid := 'af1f18ef-ced9-4a2b-b191-1e18164f9b4b';
  v_plan  uuid;
  t text[]; r text; j jsonb; out jsonb := '{}'::jsonb; ra uuid; rb uuid; inv record; n int;
BEGIN
  DELETE FROM table_reservations WHERE event_id = v_evB;
  UPDATE events SET start_at = now() + interval '10 days', end_at = now() + interval '10 days 6 hours' WHERE id = v_evB;
  SELECT id INTO v_plan FROM venue_floor_plans WHERE venue_id = 'womber' AND event_id IS NULL;
  SELECT array_agg(e->>'id' ORDER BY ord) INTO t FROM venue_floor_plans f, jsonb_array_elements(f.layout->'tables') WITH ORDINALITY AS x(e, ord) WHERE f.id = v_plan;

  -- 1. P3.1 : une formule fausse est refusée (YU002).
  BEGIN
    INSERT INTO table_packs (venue_id, zone_id, name, base_price, deposit, deposit_type) VALUES ('womber', v_zone, 'fausse', 100, 500, 'fixed');
    RAISE EXCEPTION 'SMOKE_FAIL formule fausse acceptée';
  EXCEPTION WHEN SQLSTATE 'YU002' THEN NULL;
  END;
  -- 2. P2.8 + P6.3 : la réservation passe par reserve_table_slot (service) ; le client n'insère plus rien.
  r := pg_temp.try_dml('c9559229-023c-470e-b5e2-339c0708b061', format($q$INSERT INTO table_reservations (event_id, user_id, user_email, total_price, status, qr_code) VALUES (%L, 'c9559229-023c-470e-b5e2-339c0708b061', 'x@t', 1, 'pending', 'smk12-direct')$q$, v_evB));
  PERFORM pg_temp.expect('plus d''insert client', r, 'ERR:42501');
  ra := pg_temp.rts(v_evB, v_zone, v_gold, 'a@t', t[1])::uuid;
  UPDATE table_reservations SET status = 'paid', paid_at = now() WHERE id = ra;
  -- 3. P2.3 : facture d'acompte.
  PERFORM issue_sale_invoice(NULL, ra, NULL);
  SELECT * INTO inv FROM invoices WHERE table_reservation_id = ra;
  IF inv.amount <> 11 OR inv.invoice_kind <> 'deposit' OR inv.remaining_on_site <> 90 THEN RAISE EXCEPTION 'SMOKE_FAIL facture : %', to_jsonb(inv) - 'qr_code'; END IF;
  -- 4. P1.1 / 1.2 : reçu et laissez-passer sans compte.
  j := pg_temp.try_anon(format('public.get_table_receipt(%L, %L)', ra, 'smk12-a@t'))::jsonb;
  IF j->>'status' <> 'paid' OR jsonb_array_length(j->'guests') <> 3 OR j->>'requested_table_id' <> t[1] THEN RAISE EXCEPTION 'SMOKE_FAIL reçu : %', j; END IF;
  j := pg_temp.try_anon(format('public.get_table_guest_pass(%L)', (SELECT qr_code FROM table_reservation_guests WHERE reservation_id = ra AND guest_number = 1)))::jsonb;
  IF (j->>'scannable')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'SMOKE_FAIL laissez-passer : %', j; END IF;
  -- 5. P4.1 : attribution ; P3.2 : la table vendue ne quitte pas le plan.
  j := pg_temp.try_q(v_owner, format('public.vip_set_table_placement(%L, ''assign'', %L, NULL, NULL, ''requested'')', ra, t[1]))::jsonb;
  IF j->>'placement_status' <> 'approved' THEN RAISE EXCEPTION 'SMOKE_FAIL assign : %', j; END IF;
  r := pg_temp.try_dml(v_owner, format($q$UPDATE venue_floor_plans SET layout = jsonb_set(layout, '{tables}', (SELECT jsonb_agg(e) FROM jsonb_array_elements(layout->'tables') e WHERE e->>'id' <> %L)) WHERE id = %L$q$, t[1], v_plan));
  PERFORM pg_temp.expect('table vendue', r, 'ERR:YU003:table_has_reservation:' || t[1]);
  -- 6. Placement à l'arrivée : la table se libère, le plan peut la retirer.
  j := pg_temp.try_q(v_owner, format('public.vip_set_table_placement(%L, ''on_arrival'')', ra))::jsonb;
  IF j->>'placement_status' <> 'assign_on_arrival' THEN RAISE EXCEPTION 'SMOKE_FAIL on_arrival : %', j; END IF;
  r := pg_temp.try_dml(v_owner, format($q$UPDATE venue_floor_plans SET layout = jsonb_set(layout, '{tables}', (SELECT jsonb_agg(e) FROM jsonb_array_elements(layout->'tables') e WHERE e->>'id' <> %L)) WHERE id = %L$q$, t[1], v_plan));
  PERFORM pg_temp.expect('table libérée retirable', r, 'OK:1');
  -- 7. P4.3 : une table sur place s'annule ; une table payée en ligne renvoie vers le remboursement.
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, deposit, status, paid_at, qr_code, payment_mode, guest_count)
    VALUES (v_evB, v_gold, v_zone, 'b@t', 300, 0, 'paid', now(), 'smk12-b@t', 'on_site', 2) RETURNING id INTO rb;
  j := pg_temp.try_q(v_owner, format('public.cancel_unpaid_table_reservation(%L, ''x'')', rb))::jsonb;
  IF j->>'previous_status' <> 'paid' THEN RAISE EXCEPTION 'SMOKE_FAIL cancel : %', j; END IF;
  UPDATE table_reservations SET stripe_payment_intent_id = 'pi_x' WHERE id = ra;
  PERFORM pg_temp.expect('payée en ligne', pg_temp.try_q(v_owner, format('public.cancel_unpaid_table_reservation(%L, ''x'')', ra)), 'ERR:YU006:use_refund');
  -- 8. Droits : seuls les reçus / laissez-passer / disponibilité sont ouverts à anon.
  FOR n IN 1..6 LOOP
    r := (ARRAY['public.vip_set_table_placement(uuid,text,text,text,numeric,text)', 'public.cancel_unpaid_table_reservation(uuid,text)',
                'public._can_manage_table_reservation(uuid,uuid,uuid,boolean)', 'public._table_resa_holds(text,timestamptz)',
                'public.reserve_table_slot(uuid,uuid,uuid,uuid,uuid,text,boolean,integer,numeric,numeric,numeric,text,text,text,text,text,boolean,boolean,text,text,text,boolean)',
                'public.save_invoice_on_creation()'])[n];
    IF has_function_privilege('anon', r, 'EXECUTE') THEN RAISE EXCEPTION 'SMOKE_FAIL anon peut exécuter %', r; END IF;
  END LOOP;
  IF NOT has_function_privilege('anon', 'public.get_table_receipt(uuid,text)', 'EXECUTE') OR NOT has_function_privilege('anon', 'public.get_table_guest_pass(text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.get_event_table_availability(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'SMOKE_FAIL anon doit lire reçu / pass / disponibilité'; END IF;
  out := out || jsonb_build_object('journey', 'pack YU002 → reserve → invoice → receipt → assign → YU003 → on_arrival → cancel → YU006', 'migrations_applied', true);

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
