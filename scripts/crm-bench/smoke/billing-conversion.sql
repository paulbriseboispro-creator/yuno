-- Répétition annulée de 20261118100000_crm_billing_conversion.sql :
--   node scripts/crm-bench/rehearse.mjs smoke/billing-conversion.sql 20261118100000_crm_billing_conversion.sql
DO $$
DECLARE
  v_3am uuid := '10764c3b-f312-42da-be99-4d57d7c6c0c5';
  v_demo uuid := '6a958c46-680d-4c6a-aec0-15301af47e1f';
  b jsonb;
  p jsonb;
  d jsonb;
  n jsonb;
  v_def text;
  t0 timestamptz;
BEGIN
  -- Prix : annuel 240, plus de bonus annuel.
  IF (public.crm_pricing_config()->>'price_year')::numeric <> 240 OR (public.crm_pricing_config()->>'annual_bonus_yunits')::int <> 0 THEN
    RAISE EXCEPTION 'prix non posés';
  END IF;
  v_def := pg_get_functiondef('public.crm_yunits_ensure_allowance(text)'::regprocedure);
  IF position('skipped'', ''annual''' IN v_def) > 0 THEN RAISE EXCEPTION 'annuel encore sauté'; END IF;
  v_def := pg_get_functiondef('public.crm_apply_stripe_subscription(text, text, text, text, text, text, boolean, timestamp with time zone, timestamp with time zone, boolean, timestamp with time zone, boolean)'::regprocedure);
  IF position('''unpaid'' THEN ''canceled''' IN v_def) = 0 THEN RAISE EXCEPTION 'unpaid non corrigé'; END IF;

  -- En titulaire de 3 AM.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_3am, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_3am::text, true);
  b := public.get_crm_billing(NULL, v_3am);
  t0 := clock_timestamp();
  p := public.crm_pause_summary(NULL, v_3am);
  n := public.crm_nudge_owner_subscribe(NULL, v_3am);
  IF n->>'reason' IS DISTINCT FROM 'is_owner' THEN RAISE EXCEPTION 'le titulaire ne se prévient pas lui-même : %', n; END IF;

  -- Le compte démo.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_demo, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_demo::text, true);
  d := public.get_crm_billing(NULL, v_demo);
  IF d->>'effective_plan' <> 'base' THEN RAISE EXCEPTION 'démo encore en pause : %', d->'subscription'; END IF;

  PERFORM public._crm_notif_list(NULL, v_3am, v_3am, false);

  RAISE EXCEPTION 'SMOKE_OK 3am pricing=% | pause_summary(% ms)=% | demo=%',
    b->'pricing', round(extract(epoch FROM clock_timestamp() - t0) * 1000), p, d->>'effective_plan';
END $$;
