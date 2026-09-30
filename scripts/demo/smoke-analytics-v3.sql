-- Smoke Analytics v3 — « au centime » et portée (plan ANALYTICS_REBUILD_PLAN.md, phase 1).
--
-- Rejouable, annulé par RAISE EXCEPTION 'SMOKE_OK' : rien n'est écrit.
-- Joue le club démo (owner@womber.fr) sur ses 3 dernières soirées TERMINÉES :
--   1. get_analytics_overview(event) rend, au centime, la même somme que les
--      tables de vente (formules de fees.ts, statuts de la compta, remboursements
--      déduits) — pour les billets, les tables et le bar.
--   2. Les billets vendus = somme des quantités payées.
--   3. Le même compte, sur la période qui couvre ces 3 soirées, additionne
--      exactement les 3.
--   4. Un promoteur (compte promoteur démo) n'obtient RIEN sur la portée du club
--      (forbidden), et un organisateur démo ne lit pas les soirées du club.
--
--   supabase db query --linked -f scripts/demo/smoke-analytics-v3.sql
DO $$
DECLARE
  v_owner uuid;
  v_promoter uuid;
  v_org uuid;
  v_ev record;
  v_res jsonb;
  v_expected numeric;
  v_got numeric;
  v_tickets int;
  v_sum numeric := 0;
  v_from timestamptz; v_to timestamptz;
  v_n int := 0;
BEGIN
  SELECT id INTO v_owner FROM auth.users WHERE email = 'owner@womber.fr';
  SELECT id INTO v_promoter FROM auth.users WHERE email = 'promoter@womber.fr';
  SELECT id INTO v_org FROM auth.users WHERE email = 'organizer@womber.fr';
  IF v_owner IS NULL THEN RAISE EXCEPTION 'owner@womber.fr introuvable'; END IF;

  -- Jouer le propriétaire du club.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  FOR v_ev IN
    SELECT e.id, e.title, e.start_at
      FROM public.events e
     WHERE e.venue_id = 'womber' AND coalesce(e.end_at, e.start_at + interval '8 hours') <= now()
       AND e.cancelled_at IS NULL
     ORDER BY e.start_at DESC LIMIT 3
  LOOP
    v_n := v_n + 1;
    v_res := public.get_analytics_overview('womber', NULL, v_ev.id, NULL, NULL, 'none');
    IF NOT (v_res ->> 'ok')::boolean THEN RAISE EXCEPTION 'overview refusé : %', v_res ->> 'reason'; END IF;

    -- 1. CA au centime : billets + tables + bar, formules de fees.ts.
    SELECT round(
      coalesce((SELECT sum(greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)
                          - least(greatest(coalesce(t.refund_amount, 0), 0), greatest(t.total_price - coalesce(t.service_fee, 0) - coalesce(t.insurance_fee, 0), 0)))
                  FROM public.tickets t WHERE t.event_id = v_ev.id AND t.status IN ('paid', 'used')), 0)
    + coalesce((SELECT sum(greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)
                          - least(greatest(coalesce(r.refund_amount, 0), 0), greatest(r.total_price - coalesce(r.service_fee, 0) - (CASE WHEN coalesce(r.fee_absorbed, false) THEN coalesce(r.management_fee, 0) ELSE 0 END), 0)))
                  FROM public.table_reservations r WHERE r.event_id = v_ev.id AND r.status IN ('paid', 'confirmed')), 0)
    + coalesce((SELECT sum(greatest(o.total - coalesce(o.service_fee, 0), 0)
                          - least(greatest(coalesce(o.refund_amount, 0), 0), greatest(o.total - coalesce(o.service_fee, 0), 0)))
                  FROM public.orders o WHERE o.event_id = v_ev.id AND o.venue_id = 'womber' AND o.status IN ('paid', 'served')), 0), 2)
    INTO v_expected;
    v_got := (v_res #>> '{current,revenue}')::numeric;
    IF v_got IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'CA % (%): attendu %, rendu %', v_ev.title, v_ev.id, v_expected, v_got;
    END IF;
    v_sum := v_sum + v_expected;

    -- 2. Billets = quantités payées.
    SELECT coalesce(sum(greatest(coalesce(t.quantity, 1), 1)), 0) INTO v_tickets
      FROM public.tickets t WHERE t.event_id = v_ev.id AND t.status IN ('paid', 'used');
    IF (v_res #>> '{current,tickets}')::int <> v_tickets THEN
      RAISE EXCEPTION 'billets % : attendu %, rendu %', v_ev.title, v_tickets, v_res #>> '{current,tickets}';
    END IF;
    RAISE NOTICE 'OK % · CA % · % billets', v_ev.title, v_expected, v_tickets;
    v_from := least(coalesce(v_from, v_ev.start_at), v_ev.start_at);
    v_to := greatest(coalesce(v_to, v_ev.start_at), v_ev.start_at);
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'aucune soirée terminée sur la démo'; END IF;

  -- 3. La période qui couvre ces soirées : la somme des soirées rendues = le total,
  --    et chacune des 3 soirées y figure avec le CA de son appel individuel.
  v_res := public.get_analytics_overview('womber', NULL, NULL, v_from - interval '13 hours', v_to + interval '1 hour', 'none');
  IF (v_res #>> '{current,nights}')::int < v_n THEN
    RAISE EXCEPTION 'période : au moins % soirées attendues, % rendues', v_n, v_res #>> '{current,nights}';
  END IF;
  SELECT round(coalesce(sum((x ->> 'revenue')::numeric), 0), 2) INTO v_got FROM jsonb_array_elements(v_res #> '{current,per_night}') x;
  IF (v_res #>> '{current,revenue}')::numeric IS DISTINCT FROM v_got THEN
    RAISE EXCEPTION 'période : total % ≠ somme des soirées %', v_res #>> '{current,revenue}', v_got;
  END IF;
  FOR v_ev IN
    SELECT e.id, e.title FROM public.events e
     WHERE e.venue_id = 'womber' AND coalesce(e.end_at, e.start_at + interval '8 hours') <= now() AND e.cancelled_at IS NULL
     ORDER BY e.start_at DESC LIMIT 3
  LOOP
    SELECT (x ->> 'revenue')::numeric INTO v_got FROM jsonb_array_elements(v_res #> '{current,per_night}') x WHERE (x ->> 'id')::uuid = v_ev.id;
    v_expected := (public.get_analytics_overview('womber', NULL, v_ev.id, NULL, NULL, 'none') #>> '{current,revenue}')::numeric;
    IF v_got IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'période : % rend % dans la liste, % seule', v_ev.title, v_got, v_expected;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK période · % soirées · total % = somme des soirées', v_res #>> '{current,nights}', v_res #>> '{current,revenue}';

  -- 4. Portée : un promoteur et un organisateur ne lisent pas le club.
  IF v_promoter IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_promoter, 'role', 'authenticated')::text, true);
    v_res := public.get_analytics_promoters('womber', NULL, NULL, now() - interval '90 days', now());
    IF (v_res ->> 'ok')::boolean THEN RAISE EXCEPTION 'un promoteur lit les stats du club'; END IF;
    RAISE NOTICE 'OK promoteur refusé (%)', v_res ->> 'reason';
  END IF;
  IF v_org IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
    v_res := public.get_analytics_overview('womber', NULL, NULL, now() - interval '30 days', now(), 'none');
    IF (v_res ->> 'ok')::boolean THEN RAISE EXCEPTION 'un organisateur lit la portée du club'; END IF;
    RAISE NOTICE 'OK organisateur refusé sur le club (%)', v_res ->> 'reason';
  END IF;

  RAISE EXCEPTION 'SMOKE_OK';
END $$;
