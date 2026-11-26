-- Smoke ANNULÉ — tables vague C1, point 7 (D9) : soirée d'organisateur chez un club Yuno, tables du club, encaisseur = club.
--   node scripts/crm-bench/rehearse.mjs scripts/crm-bench/smoke/tables-c1-5-partner-club.sql 20261226100000_sale_email_queue_effects.sql 20261226110000_tables_capacity_eve_recap.sql 20261226120000_tables_manual_reservation_guest_count.sql 20261226130000_tables_bottle_menu_preorder.sql 20261226140000_tables_collector.sql
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
  v_club_owner uuid := 'a810aed8-1b10-4e41-b325-4bf07f657d72';   -- owner@ du club womber (club partenaire)
  v_orga uuid := 'ef75f0ee-5c1a-4c6b-9659-81aa63d9fce9';           -- organisateur démo
  v_ev uuid := 'c0ffee00-25a9-4d3e-9c1a-0000000000a1';             -- soirée d'organisateur
  v_gold uuid := '6fe30ed6-994b-45bb-8e66-69917f0ca6bf';
  v_zgold uuid := 'af1f18ef-ced9-4a2b-b191-1e18164f9b4b';
  j jsonb; r text; v_res uuid; v_qr text := 'smkc5-qr'; n int;
  out jsonb := '{}'::jsonb;
BEGIN
  DELETE FROM table_reservations WHERE event_id = v_ev;
  DELETE FROM table_packs WHERE event_id = v_ev; DELETE FROM table_zones WHERE event_id = v_ev; DELETE FROM venue_floor_plans WHERE event_id = v_ev;
  -- Soirée menée par l'organisateur, chez le club womber (club partenaire), tables du club en élite, « réglé entre vous » :
  -- billets 100 % organisateur, tables 100 % club.
  UPDATE events SET partner_venue_id = 'womber', event_mode = 'org_hosted', tables_mode = 'elite', tables_enabled = true,
                    start_at = now() + interval '5 days', end_at = now() + interval '5 days 6 hours', is_active = true, cancelled_at = NULL,
                    revenue_split_rules = '{"agreement":"external","tickets":{"organizer_pct":100,"venue_pct":0},"tables":{"organizer_pct":0,"venue_pct":100},"drinks":{"organizer_pct":0,"venue_pct":100}}'::jsonb,
                    revenue_split_proposal = NULL
   WHERE id = v_ev;
  UPDATE venues SET stripe_account_id = 'acct_smokeclub', stripe_charges_enabled = true WHERE id = 'womber';
  UPDATE profiles SET stripe_connect_account_id = NULL, stripe_connect_charges_enabled = false WHERE id = v_orga;

  -- A. Les tables sont encaissées par le CLUB, prêtes ; les billets (organisateur sans Stripe) ne le sont pas.
  j := _event_pillar_collector(v_ev, 'tables');
  IF j->>'collector' <> 'venue' OR j->>'mode' <> 'direct' OR j->>'agreement' <> 'external' OR (j->>'ready')::boolean IS NOT TRUE OR j->>'blocked' IS NOT NULL OR j->>'venue_id' <> 'womber' THEN
    RAISE EXCEPTION 'SMOKE_FAIL collecteur tables : %', j;
  END IF;
  IF event_pillar_payments_ready(v_ev, 'tables') IS NOT TRUE THEN RAISE EXCEPTION 'SMOKE_FAIL tables prêtes (club Stripe actif, orga sans Stripe)'; END IF;
  IF event_pillar_payments_ready(v_ev, 'tickets') IS NOT FALSE THEN RAISE EXCEPTION 'SMOKE_FAIL billets non prêts (orga sans Stripe)'; END IF;
  j := _event_pillar_collector(v_ev, 'tickets');
  IF j->>'collector' <> 'organizer' OR j->>'ready_party' <> 'organizer' THEN RAISE EXCEPTION 'SMOKE_FAIL collecteur billets : %', j; END IF;
  out := out || jsonb_build_object('event_payments_ready_global', event_payments_ready(v_ev), 'collector_tables', 'venue');

  -- B. Droits : le propriétaire du club partenaire et l'organisateur lisent le collecteur ; un tiers non.
  r := pg_temp.try_q(v_club_owner, format('public.get_event_tables_collector(%L)->>''collector''', v_ev)); PERFORM pg_temp.expect('club lit le collecteur', r, 'venue');
  r := pg_temp.try_q(v_orga, format('public.get_event_tables_collector(%L)->>''collector''', v_ev)); PERFORM pg_temp.expect('orga lit le collecteur', r, 'venue');
  r := pg_temp.try_q(gen_random_uuid(), format('public.get_event_tables_collector(%L)', v_ev)); PERFORM pg_temp.expect('tiers refusé', r, 'ERR:42501');
  r := pg_temp.try_anon(format('public.get_event_tables_collector(%L)', v_ev)); PERFORM pg_temp.expect('anon refusé', r, 'ERR:42501');
  r := pg_temp.try_anon(format('public.event_pillar_payments_ready(%L, ''tables'')', v_ev)); PERFORM pg_temp.expect('anon lit la porte par pilier', r, 'true');

  -- C. Autres contrats : tables 100 % organisateur sans Stripe → pas prêt (c'est l'organisateur qui manque) ; virement ; barème ; partage ; pilier sorti.
  UPDATE events SET revenue_split_rules = jsonb_set(revenue_split_rules, '{tables}', '{"organizer_pct":100,"venue_pct":0}') WHERE id = v_ev;
  j := _event_pillar_collector(v_ev, 'tables');
  IF j->>'collector' <> 'organizer' OR (j->>'ready')::boolean IS NOT FALSE OR j->>'ready_party' <> 'organizer' THEN RAISE EXCEPTION 'SMOKE_FAIL tables à l''orga : %', j; END IF;
  UPDATE events SET revenue_split_rules = jsonb_set(revenue_split_rules, '{tables}', '{"organizer_pct":40,"venue_pct":60}') WHERE id = v_ev;
  j := _event_pillar_collector(v_ev, 'tables');
  IF j->>'collector' <> 'both' OR j->>'blocked' <> 'stripe_split_unavailable' OR (j->>'ready')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'SMOKE_FAIL partage Stripe bloqué : %', j; END IF;
  UPDATE events SET revenue_split_rules = '{"settlement":{"mode":"transfer","collector":"organizer"},"tables":{"organizer_pct":30,"venue_pct":70}}'::jsonb WHERE id = v_ev;
  j := _event_pillar_collector(v_ev, 'tables');
  IF j->>'collector' <> 'organizer' OR j->>'mode' <> 'transfer' THEN RAISE EXCEPTION 'SMOKE_FAIL virement : %', j; END IF;
  UPDATE events SET revenue_split_rules = '{"remuneration":{"mode":"tiered_total","tiers":[{"from":0,"pct":10}]}}'::jsonb WHERE id = v_ev;
  j := _event_pillar_collector(v_ev, 'tables');
  IF j->>'collector' <> 'venue' OR j->>'mode' <> 'tiered' OR j->>'blocked' <> 'stripe_split_unavailable' THEN RAISE EXCEPTION 'SMOKE_FAIL barème : %', j; END IF;
  UPDATE events SET revenue_split_rules = '{"tables":{"enabled":false}}'::jsonb WHERE id = v_ev;
  j := _event_pillar_collector(v_ev, 'tables');
  IF j->>'blocked' <> 'pillar_disabled' THEN RAISE EXCEPTION 'SMOKE_FAIL pilier sorti : %', j; END IF;
  UPDATE events SET revenue_split_rules = NULL WHERE id = v_ev;
  j := _event_pillar_collector(v_ev, 'tables');
  IF j->>'blocked' <> 'no_contract' THEN RAISE EXCEPTION 'SMOKE_FAIL pas de contrat : %', j; END IF;
  -- soirée solo : club hôte
  UPDATE events SET partner_venue_id = NULL, event_mode = 'solo_organizer' WHERE id = v_ev;
  j := _event_pillar_collector(v_ev, 'tables');
  IF j->>'mode' <> 'solo' OR j->>'collector' <> 'organizer' THEN RAISE EXCEPTION 'SMOKE_FAIL solo orga : %', j; END IF;
  out := out || jsonb_build_object('contracts', 'ok');

  -- D. Le parcours du club partenaire : réservation sur une formule du club, visibilité et gestion des deux côtés.
  UPDATE events SET partner_venue_id = 'womber', event_mode = 'org_hosted',
         revenue_split_rules = '{"agreement":"external","tickets":{"organizer_pct":100,"venue_pct":0},"tables":{"organizer_pct":0,"venue_pct":100},"drinks":{"organizer_pct":0,"venue_pct":100}}'::jsonb WHERE id = v_ev;
  INSERT INTO table_reservations (event_id, pack_id, zone_id, user_email, total_price, deposit, status, paid_at, qr_code, guest_count, stripe_connected_account_id, payment_mode)
    VALUES (v_ev, v_gold, v_zgold, 'client@test.fr', 300, 100, 'paid', now(), v_qr, 4, 'acct_smokeclub', 'online') RETURNING id INTO v_res;
  IF NOT public.can_manage_event_tables(v_club_owner, v_ev) THEN RAISE EXCEPTION 'SMOKE_FAIL le club partenaire ne gère pas les tables de SA formule sur cette soirée'; END IF;
  IF NOT public.can_manage_event_tables(v_orga, v_ev) THEN RAISE EXCEPTION 'SMOKE_FAIL l''organisateur ne gère pas les tables de sa soirée'; END IF;
  r := pg_temp.try_q(v_club_owner, format('(SELECT count(*) FROM table_reservations WHERE id = %L)', v_res)); PERFORM pg_temp.expect('le club voit la réservation', r, '1');
  r := pg_temp.try_q(v_orga, format('(SELECT count(*) FROM table_reservations WHERE id = %L)', v_res)); PERFORM pg_temp.expect('l''orga voit la réservation', r, '1');
  out := out || jsonb_build_object('club_manage', public.can_manage_event_tables(v_club_owner, v_ev), 'orga_manage', public.can_manage_event_tables(v_orga, v_ev));

  -- E. Reçu : vendeur = le club (c'est lui qui a encaissé) ; le Service VIP du club voit la table ; la capacité compte les tables du club.
  SELECT count(*) INTO n FROM get_event_seller(v_ev, v_qr) s WHERE s.name IS NOT NULL;
  out := out || jsonb_build_object('seller_rows', n, 'seller', (SELECT s.name FROM get_event_seller(v_ev, v_qr) s LIMIT 1));
  out := out || jsonb_build_object('capacity', _event_table_capacity(v_ev), 'tables_left', _event_tables_left(v_ev));

  RAISE EXCEPTION 'SMOKE_OK %', out::text;
END
$smoke$;
