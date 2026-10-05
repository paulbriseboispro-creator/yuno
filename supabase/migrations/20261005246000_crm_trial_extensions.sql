-- Yuno CRM : le réglage « Prolongations gratuites » (crm_pricing.trial_extensions)
-- agit enfin.
--
--   • crm_subscriptions.trial_extensions_used compte les prolongations de chaque
--     compte (pro ou admin, toutes confondues) ;
--   • le pro prolonge LUI-MÊME son essai de 7 jours (crm_request_trial_extension,
--     Compte › Facturation) tant qu'il lui en reste : refusé au-delà du réglage,
--     et réglage 0 = aucune prolongation côté pro ;
--   • un geste admin (crm_admin_extend_trial, motif obligatoire) reste possible
--     au-delà du réglage et incrémente QUAND MÊME le compteur ; le journal note
--     qu'il dépasse le réglage ;
--   • get_crm_billing rend used / left pour l'écran Facturation.

ALTER TABLE public.crm_subscriptions ADD COLUMN IF NOT EXISTS trial_extensions_used integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.crm_admin_extend_trial(p_scope_key text, p_days integer, p_reason text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_end timestamptz;
  v_used integer;
BEGIN
  PERFORM public._crm_admin_gate();
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 30 THEN RAISE EXCEPTION 'bad_days' USING ERRCODE = '22023'; END IF;
  UPDATE public.crm_subscriptions
     SET trial_ends_at = GREATEST(COALESCE(trial_ends_at, now()), now()) + p_days * interval '1 day', status = 'trialing', updated_at = now(),
         trial_extensions_used = trial_extensions_used + 1
   WHERE scope_key = p_scope_key AND stripe_subscription_id IS NULL AND status IN ('trialing', 'none', 'canceled', 'incomplete')
   RETURNING trial_ends_at, trial_extensions_used INTO v_end, v_used;
  IF v_end IS NULL THEN RAISE EXCEPTION 'not_extendable' USING ERRCODE = '22023'; END IF;
  PERFORM public._crm_admin_audit('crm_extend_trial', p_scope_key, jsonb_build_object('days', p_days, 'reason', left(trim(p_reason), 300), 'ends_at', v_end, 'extensions_used', v_used,
           'beyond_setting', v_used > COALESCE((public.crm_pricing_config()->>'trial_extensions')::int, 0)));
  RETURN v_end;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_admin_extend_trial(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_extend_trial(text, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_request_trial_extension(p_venue_id text DEFAULT NULL, p_organizer_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text;
  v_max integer := COALESCE((public.crm_pricing_config()->>'trial_extensions')::int, 0);
  v_end timestamptz;
  v_used integer;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN RAISE EXCEPTION 'one scope' USING ERRCODE = '22023'; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF public.is_support_session() THEN RAISE EXCEPTION 'support_session' USING ERRCODE = '42501'; END IF;
  -- Le titulaire seul (même porte que le paiement).
  IF NOT COALESCE(CASE WHEN p_venue_id IS NOT NULL
                       THEN EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND owner_id = auth.uid())
                       ELSE p_organizer_user_id = auth.uid() END, false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_scope := public.crm_scope_key(p_venue_id, p_organizer_user_id);
  UPDATE public.crm_subscriptions
     SET trial_ends_at = GREATEST(COALESCE(trial_ends_at, now()), now()) + interval '7 days',
         status = 'trialing', updated_at = now(), trial_extensions_used = trial_extensions_used + 1
   WHERE scope_key = v_scope AND stripe_subscription_id IS NULL AND status = 'trialing'
     AND trial_extensions_used < v_max
   RETURNING trial_ends_at, trial_extensions_used INTO v_end, v_used;
  IF v_end IS NULL THEN RAISE EXCEPTION 'no_extension_left' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('trial_ends_at', v_end, 'used', v_used, 'left', GREATEST(0, v_max - v_used));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_request_trial_extension(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_request_trial_extension(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_crm_billing(p_venue_id text DEFAULT NULL::text, p_organizer_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'granted', v_row.stripe_subscription_id IS NULL AND v_row.status = 'active',
      'trial_extensions_used', v_row.trial_extensions_used,
      'trial_extensions_left', GREATEST(0, COALESCE((cfg->>'trial_extensions')::int, 0) - v_row.trial_extensions_used)) END,
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
$function$;
REVOKE ALL ON FUNCTION public.get_crm_billing(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_billing(text, uuid) TO authenticated, service_role;
