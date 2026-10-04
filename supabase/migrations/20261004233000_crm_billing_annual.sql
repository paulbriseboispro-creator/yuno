-- Yuno CRM — abonnement (lot 4b, partie Stripe) : ce que l'annuel donne, et ce
-- que l'écran « Abonnement et facturation » lit.
--
-- 1. crm_yunits_ensure_allowance : un abonné ANNUEL reçoit aussi ses 10 000
--    Yunits chaque mois (un lot par mois civil, jamais au-delà de sa période
--    payée). Avant, le lot « mensuel » d'un annuel durait toute l'année : un
--    seul lot de 10 000 pour douze mois.
-- 2. crm_apply_stripe_subscription : quand une période annuelle est PAYÉE
--    (statut active), le bonus de 30 000 Yunits tombe d'un coup, valable douze
--    mois, une fois par période (source_ref = abonnement + fin de période :
--    les rejeux et les deux endpoints Stripe retombent sur le même lot). Puis
--    l'allocation du mois est servie tout de suite, sans attendre le balayage.
--    Aucun nouvel événement Stripe : `customer.subscription.updated` arrive à
--    chaque renouvellement (la période change) et au passage essai → payé.
-- 3. get_crm_billing : le solde de Yunits et la grille (prix, Yunits inclus,
--    bonus annuel) pour que l'écran n'écrive aucun chiffre en dur.

CREATE OR REPLACE FUNCTION public.crm_yunits_ensure_allowance(p_scope_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s public.crm_subscriptions%ROWTYPE;
  cfg jsonb := public.crm_pricing_config();
  v_month_end timestamptz := (date_trunc('month', now() AT TIME ZONE 'Europe/Paris') + interval '1 month') AT TIME ZONE 'Europe/Paris';
  v_end timestamptz;
BEGIN
  SELECT * INTO s FROM public.crm_subscriptions WHERE scope_key = p_scope_key;
  IF NOT FOUND OR NOT public.crm_scope_is_crm(p_scope_key) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'not_crm');
  END IF;

  IF s.status = 'trialing' AND s.trial_ends_at > now() THEN
    RETURN public.crm_yunits_credit(p_scope_key, 'trial', (cfg->>'trial_yunits')::int, s.trial_ends_at,
                                    'trial', 'Offerts pendant l’essai');
  END IF;

  IF s.status IN ('active', 'past_due') THEN
    IF s.stripe_subscription_id IS NOT NULL AND s.current_period_end IS NOT NULL AND s.current_period_end > now() THEN
      -- Mensuel : un lot par période payée. Annuel : un lot par mois civil,
      -- borné à la fin de la période payée.
      v_end := CASE WHEN s.billing_interval = 'year' THEN LEAST(v_month_end, s.current_period_end)
                    ELSE s.current_period_end END;
    ELSE
      -- Offre accordée à la main : un lot par mois civil, tant qu'elle court.
      IF s.current_period_end IS NOT NULL AND s.current_period_end < now() THEN
        RETURN jsonb_build_object('ok', true, 'skipped', 'expired');
      END IF;
      v_end := v_month_end;
    END IF;
    RETURN public.crm_yunits_credit(p_scope_key, 'monthly', (cfg->>'monthly_yunits')::int, v_end,
                                    'monthly:' || to_char(v_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24'),
                                    'Inclus dans l’abonnement');
  END IF;

  RETURN jsonb_build_object('ok', true, 'skipped', s.status);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_yunits_ensure_allowance(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_yunits_ensure_allowance(text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_apply_stripe_subscription(p_scope_key text, p_subscription_id text, p_customer_id text, p_stripe_status text, p_plan text, p_interval text, p_founder boolean, p_trial_end timestamp with time zone, p_period_end timestamp with time zone, p_cancel_at_period_end boolean, p_event_at timestamp with time zone, p_deleted boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
  v_row public.crm_subscriptions%ROWTYPE;
  v_venue text;
  v_org uuid;
  cfg jsonb := public.crm_pricing_config();
BEGIN
  -- p_plan est gardé dans la signature (anciens appels) mais il n'y a plus
  -- qu'une offre : le socle.
  IF p_scope_key !~ '^(venue|org):.+$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  IF p_scope_key LIKE 'venue:%' THEN v_venue := substr(p_scope_key, 7);
  ELSE v_org := substr(p_scope_key, 5)::uuid; END IF;

  v_status := CASE
    WHEN p_deleted THEN 'canceled'
    WHEN p_stripe_status IN ('trialing', 'active', 'past_due') THEN p_stripe_status
    WHEN p_stripe_status = 'unpaid' THEN 'past_due'
    WHEN p_stripe_status = 'incomplete' THEN 'incomplete'
    ELSE 'canceled'
  END;

  SELECT * INTO v_row FROM public.crm_subscriptions WHERE scope_key = p_scope_key FOR UPDATE;
  IF FOUND AND v_row.last_event_at IS NOT NULL AND p_event_at < v_row.last_event_at THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'older_event');
  END IF;
  IF FOUND AND v_row.stripe_subscription_id IS NOT NULL AND v_row.stripe_subscription_id <> p_subscription_id
     AND v_status IN ('canceled', 'incomplete') THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'other_subscription');
  END IF;

  INSERT INTO public.crm_subscriptions AS s (scope_key, venue_id, organizer_user_id, plan, status, billing_interval,
         founder, trial_ends_at, current_period_end, cancel_at_period_end, stripe_customer_id,
         stripe_subscription_id, last_event_at, updated_at)
  VALUES (p_scope_key, v_venue, v_org, 'base', v_status, p_interval,
          COALESCE(p_founder, false), p_trial_end, p_period_end, COALESCE(p_cancel_at_period_end, false), p_customer_id,
          p_subscription_id, p_event_at, now())
  ON CONFLICT (scope_key) DO UPDATE SET
    plan = 'base',
    status = EXCLUDED.status,
    billing_interval = EXCLUDED.billing_interval,
    founder = s.founder OR EXCLUDED.founder,
    -- L'essai offert par Yuno garde sa date ; Stripe ne la repousse pas.
    trial_ends_at = CASE WHEN EXCLUDED.status = 'trialing' THEN EXCLUDED.trial_ends_at ELSE s.trial_ends_at END,
    current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, s.stripe_customer_id),
    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
    granted_by = NULL,
    last_event_at = EXCLUDED.last_event_at,
    updated_at = now();

  PERFORM public.crm_sync_scope(p_scope_key);

  -- Une année payée : le bonus d'un coup, une fois par période.
  IF v_status = 'active' AND p_interval = 'year' AND p_period_end IS NOT NULL AND p_period_end > now() THEN
    PERFORM public.crm_yunits_credit(
      p_scope_key, 'annual_bonus', (cfg->>'annual_bonus_yunits')::int,
      now() + make_interval(months => COALESCE((cfg->>'purchase_validity_months')::int, 12)),
      'annual:' || p_subscription_id || ':' || to_char(p_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
      'Offerts avec l’abonnement annuel');
  END IF;
  -- L'allocation du mois (ou de l'essai) sans attendre le balayage horaire.
  IF v_status IN ('trialing', 'active', 'past_due') THEN
    PERFORM public.crm_yunits_ensure_allowance(p_scope_key);
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', v_status, 'effective_plan', public.crm_effective_plan(p_scope_key));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_apply_stripe_subscription(text, text, text, text, text, text, boolean, timestamptz, timestamptz, boolean, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_apply_stripe_subscription(text, text, text, text, text, text, boolean, timestamptz, timestamptz, boolean, timestamptz, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_crm_billing(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_scope text := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  v_row public.crm_subscriptions%ROWTYPE;
  v_plan text;
  v_limits jsonb;
  cfg jsonb := public.crm_pricing_config();
  v_members integer;
  v_auto integer;
  v_can_manage boolean;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'one scope' USING ERRCODE = '22023';
  END IF;
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.crm_subscriptions WHERE scope_key = v_scope;
  v_plan := public.crm_effective_plan(v_scope);
  v_limits := public.crm_plan_limits(v_plan);

  IF p_venue_id IS NOT NULL THEN
    SELECT count(*) INTO v_members FROM public.manager_permissions WHERE venue_id = p_venue_id;
    v_can_manage := EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND owner_id = auth.uid());
  ELSE
    SELECT count(*) INTO v_members FROM public.org_members m
     WHERE m.organizer_user_id = p_organizer_user_id
       AND (m.invitation_status = 'accepted'
            OR (m.invitation_status = 'pending' AND (m.expires_at IS NULL OR m.expires_at > now())));
    v_can_manage := p_organizer_user_id = auth.uid();
  END IF;
  SELECT count(*) INTO v_auto FROM public.email_automations a
   WHERE a.enabled AND a.venue_id IS NOT DISTINCT FROM p_venue_id
     AND a.organizer_user_id IS NOT DISTINCT FROM p_organizer_user_id;

  RETURN jsonb_build_object(
    'subscription', CASE WHEN v_row.scope_key IS NULL THEN NULL ELSE jsonb_build_object(
      'plan', v_row.plan, 'status', v_row.status, 'interval', v_row.billing_interval,
      'founder', v_row.founder, 'founder_until', v_row.founder_until,
      'trial_ends_at', v_row.trial_ends_at, 'current_period_end', v_row.current_period_end,
      'cancel_at_period_end', v_row.cancel_at_period_end,
      'has_stripe', v_row.stripe_subscription_id IS NOT NULL,
      'has_customer', v_row.stripe_customer_id IS NOT NULL,
      'granted', v_row.stripe_subscription_id IS NULL AND v_row.status = 'active') END,
    'effective_plan', v_plan,
    -- Le propriétaire seul paie : c'est la porte des actions crm_* de club-subscription.
    'can_manage', v_can_manage,
    'yunits_balance', public.crm_yunits_balance(v_scope),
    'pricing', jsonb_build_object(
      'price_month', (cfg->>'price_month')::numeric,
      'price_year', (cfg->>'price_year')::numeric,
      'price_month_next', (cfg->>'price_month_next')::numeric,
      'monthly_yunits', (cfg->>'monthly_yunits')::int,
      'annual_bonus_yunits', (cfg->>'annual_bonus_yunits')::int,
      'trial_yunits', (cfg->>'trial_yunits')::int,
      'trial_days', (cfg->>'trial_days')::int,
      'vat_rate', (cfg->>'vat_rate')::numeric),
    'usage', jsonb_build_object(
      'members', COALESCE(v_members, 0),
      'sync_minutes', (v_limits->>'sync_minutes')::int,
      'automations_on', COALESCE(v_auto, 0))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_crm_billing(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_billing(text, uuid) TO authenticated, service_role;
