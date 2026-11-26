-- Smoke ANNULÉ — tables vague C1, points 1-2 : file des e-mails de vente, effets rejouables, alerte « payée sans e-mail ».
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-c1-1-queue.sql 20261226100000_sale_email_queue_effects.sql
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
  v_ev uuid;
  v_res uuid; v_res2 uuid;
  v_id uuid; v_id2 uuid;
  n int; r record; t timestamptz;
  out jsonb := '{}'::jsonb;
BEGIN
  SELECT e.id INTO v_ev FROM events e WHERE NOT (e.id = ANY (demo_event_ids())) LIMIT 1;
  IF v_ev IS NULL THEN RAISE EXCEPTION 'SMOKE_FAIL aucune soirée non démo'; END IF;
  INSERT INTO table_reservations (event_id, user_email, total_price, status, paid_at, qr_code, stripe_session_id)
    VALUES (v_ev, 'real.client@gmail.com', 100, 'paid', now() - interval '2 hours', 'smkc1-a', 'cs_test_x') RETURNING id INTO v_res;

  -- P2.6 : enqueue + dédoublonnage + alerte du jour
  v_id := enqueue_sale_email('table', v_res, 'confirmed', '{}'::jsonb, '429 quota');
  IF v_id IS NULL THEN RAISE EXCEPTION 'SMOKE_FAIL enqueue a rendu NULL pour une vente réelle'; END IF;
  v_id2 := enqueue_sale_email('table', v_res, 'confirmed', '{}'::jsonb, '429 again');
  IF v_id2 <> v_id THEN RAISE EXCEPTION 'SMOKE_FAIL une seule ligne en attente par (vente,type)'; END IF;
  SELECT count(*) INTO n FROM sale_email_queue WHERE sale_id = v_res; IF n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL doublon %', n; END IF;
  SELECT count(*) INTO n FROM admin_notifications WHERE notification_type = 'admin_sale_email_quota' AND dedup_key = 'sale_email_quota:' || to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD');
  IF n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL alerte quota attendue 1, obtenu %', n; END IF;
  out := out || jsonb_build_object('enqueue', 'ok');

  -- démo : jamais de file
  IF enqueue_sale_email('table', v_res, 'confirmed', jsonb_build_object('email', 'x@demo.womber.fr'), 'e') IS NULL THEN RAISE EXCEPTION 'SMOKE_FAIL (réservation réelle ≠ démo)'; END IF;
  IF _is_demo_mail('guest@demo.womber.fr') IS NOT TRUE OR _is_demo_mail('a@womber.fr') IS NOT TRUE OR _is_demo_mail('real.client@gmail.com') THEN
    RAISE EXCEPTION 'SMOKE_FAIL _is_demo_mail';
  END IF;
  INSERT INTO table_reservations (event_id, user_email, total_price, status, paid_at, qr_code)
    VALUES (v_ev, 'visitor@demo.womber.fr', 100, 'paid', now(), 'smkc1-demo') RETURNING id INTO v_res2;
  IF enqueue_sale_email('table', v_res2, 'confirmed', '{}'::jsonb, 'e') IS NOT NULL THEN RAISE EXCEPTION 'SMOKE_FAIL la démo entre dans la file'; END IF;
  out := out || jsonb_build_object('demo', 'ok');

  -- pas encore due (+15 min) → rien à réclamer pour cette ligne
  SELECT count(*) INTO n FROM claim_sale_email_queue(50) c WHERE c.sale_id = v_res; IF n <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL réclamée trop tôt'; END IF;
  UPDATE sale_email_queue SET next_attempt_at = now() - interval '1 minute' WHERE id = v_id;
  SELECT count(*) INTO n FROM claim_sale_email_queue(50) c WHERE c.sale_id = v_res; IF n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL réclamation due: %', n; END IF;
  SELECT count(*) INTO n FROM claim_sale_email_queue(50) c WHERE c.sale_id = v_res; IF n <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL bail de 10 min ignoré'; END IF;

  -- échecs successifs : +1 h, puis 8 h Paris, puis abandon avec alerte
  PERFORM finish_sale_email_queue(v_id, 'retry', 'timeout');
  SELECT attempts, next_attempt_at INTO r FROM sale_email_queue WHERE id = v_id;
  IF r.attempts <> 1 OR r.next_attempt_at < now() + interval '55 minutes' OR r.next_attempt_at > now() + interval '65 minutes' THEN RAISE EXCEPTION 'SMOKE_FAIL +1h %', r; END IF;
  PERFORM finish_sale_email_queue(v_id, 'retry', 'timeout');
  SELECT next_attempt_at INTO t FROM sale_email_queue WHERE id = v_id;
  IF extract(hour FROM t AT TIME ZONE 'Europe/Paris') <> 8 OR t < now() + interval '1 hour' OR t > now() + interval '25 hours' THEN RAISE EXCEPTION 'SMOKE_FAIL 8h Paris %', t; END IF;
  PERFORM finish_sale_email_queue(v_id, 'retry', 'timeout');
  IF (SELECT status FROM sale_email_queue WHERE id = v_id) <> 'failed' THEN RAISE EXCEPTION 'SMOKE_FAIL doit échouer à la 3e relance'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_notifications WHERE dedup_key = 'sale_email_failed:' || v_id) THEN RAISE EXCEPTION 'SMOKE_FAIL alerte d''abandon'; END IF;
  out := out || jsonb_build_object('schedule', 'ok');

  -- remplacée : un e-mail plus récent est parti → close sans envoi
  v_id := enqueue_sale_email('table', v_res, 'confirmed', '{}'::jsonb, 'again');
  PERFORM record_sale_email_sent('table', v_res, 'real.client@gmail.com', 'rid');
  UPDATE sale_email_queue SET next_attempt_at = now() - interval '1 minute' WHERE id = v_id;
  SELECT count(*) INTO n FROM claim_sale_email_queue(50) c WHERE c.sale_id = v_res; IF n <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL superseded réclamée'; END IF;
  IF (SELECT status FROM sale_email_queue WHERE id = v_id) <> 'dropped' THEN RAISE EXCEPTION 'SMOKE_FAIL superseded non close'; END IF;
  out := out || jsonb_build_object('superseded', 'ok');

  -- P6.6 : payée il y a 2 h, e-mail « envoyé » → pas d'alerte ; sans suivi ni file → alerte, une fois
  DELETE FROM sale_email_deliveries WHERE kind = 'table' AND sale_id = v_res;
  DELETE FROM sale_email_queue WHERE sale_id = v_res;
  n := sale_effects_sweep();
  IF n < 1 OR NOT EXISTS (SELECT 1 FROM admin_notifications WHERE dedup_key = 'table_paid_no_email:' || v_res) THEN RAISE EXCEPTION 'SMOKE_FAIL alerte payée sans e-mail (n=%)', n; END IF;
  IF EXISTS (SELECT 1 FROM admin_notifications WHERE dedup_key = 'table_paid_no_email:' || v_res2) THEN RAISE EXCEPTION 'SMOKE_FAIL alerte pour la démo'; END IF;
  PERFORM sale_effects_sweep();
  SELECT count(*) INTO n FROM admin_notifications WHERE dedup_key = 'table_paid_no_email:' || v_res; IF n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL dedup %', n; END IF;
  out := out || jsonb_build_object('sweep', 'ok');

  -- P2.7 : effets. Sans 'started' (table d'avant) : jamais rejouée.
  SELECT count(*) INTO n FROM claim_table_effects_replays(50) c WHERE c.reservation_id = v_res; IF n <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL table sans started rejouée'; END IF;
  PERFORM table_effect_done(v_res, 'started');
  PERFORM table_effect_done(v_res, 'notify');
  PERFORM table_effect_done(v_res, 'notify');
  IF table_effects_done(v_res) <> ARRAY['started','notify']::text[] AND table_effects_done(v_res) <> ARRAY['notify','started']::text[] THEN RAISE EXCEPTION 'SMOKE_FAIL effects_done %', table_effects_done(v_res); END IF;
  SELECT count(*) INTO n FROM claim_table_effects_replays(50) c WHERE c.reservation_id = v_res; IF n <> 1 THEN RAISE EXCEPTION 'SMOKE_FAIL rejeu attendu'; END IF;
  SELECT count(*) INTO n FROM claim_table_effects_replays(50) c WHERE c.reservation_id = v_res; IF n <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL rejeu trop rapproché'; END IF;
  PERFORM table_effect_done(v_res, 'promoter'); PERFORM table_effect_done(v_res, 'email');
  UPDATE table_effects_replays SET last_at = now() - interval '1 hour' WHERE reservation_id = v_res;
  SELECT count(*) INTO n FROM claim_table_effects_replays(50) c WHERE c.reservation_id = v_res; IF n <> 0 THEN RAISE EXCEPTION 'SMOKE_FAIL tout fait, plus de rejeu'; END IF;
  out := out || jsonb_build_object('effects', 'ok');

  -- droits : ni anon ni authenticated
  IF pg_temp.try_anon('public.claim_sale_email_queue(1)') NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'SMOKE_FAIL anon peut réclamer'; END IF;
  IF pg_temp.try_q('a810aed8-1b10-4e41-b325-4bf07f657d72', 'public.enqueue_sale_email(''table'', gen_random_uuid(), ''x'', ''{}''::jsonb, ''e'')') NOT LIKE 'ERR:42501%' THEN RAISE EXCEPTION 'SMOKE_FAIL authenticated peut enqueue'; END IF;
  out := out || jsonb_build_object('grants', 'ok');

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
