-- Yuno CRM : le seuil des 50 comptes (crm_pricing.price_switch_at) agit, SANS
-- rien écrire chez Stripe.
--
--   • crm_price_state : l'état observé des prix publics chez Stripe (actifs ou
--     pas), écrit par l'edge seulement (lecture Stripe : action crm_price_status
--     du super admin, et chaque checkout qui retombe sur le lancement) ;
--   • crm_price_tier() : 'launch' tant que le nombre de comptes payants
--     distincts est < price_switch_at, OU tant que les prix publics ne sont pas
--     actifs chez Stripe ; 'public' ensuite. Lisible par la page Tarifs ;
--   • crm_price_tier_for(scope) : un abonné existant (founder = true) garde
--     TOUJOURS le lancement ; sinon crm_price_tier() ;
--   • get_crm_billing rend le prix du niveau du compte (annuel public = 12 ×
--     le mensuel public, miroir des prix Stripe 34 € / 408 €).
-- Le checkout (club-subscription/crm.ts) choisit la lookup_key par ce niveau et
-- retombe sur le lancement si le prix public est absent ou inactif : jamais un
-- paiement qui échoue.

CREATE TABLE IF NOT EXISTS public.crm_price_state (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  public_active boolean NOT NULL DEFAULT false,
  checked_at    timestamptz
);
INSERT INTO public.crm_price_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.crm_price_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_price_state FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_paying_accounts()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(DISTINCT s.scope_key)::int FROM public.crm_subscriptions s
   WHERE s.stripe_subscription_id IS NOT NULL AND s.status IN ('active', 'past_due');
$$;
REVOKE ALL ON FUNCTION public.crm_paying_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_paying_accounts() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_price_tier()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.crm_paying_accounts() >= COALESCE((public.crm_pricing_config()->>'price_switch_at')::int, 50)
                   AND COALESCE((SELECT public_active FROM public.crm_price_state WHERE id), false)
              THEN 'public' ELSE 'launch' END;
$$;
REVOKE ALL ON FUNCTION public.crm_price_tier() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_price_tier() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_price_tier_for(p_scope_key text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.crm_subscriptions s WHERE s.scope_key = p_scope_key AND s.founder)
              THEN 'launch' ELSE public.crm_price_tier() END;
$$;
REVOKE ALL ON FUNCTION public.crm_price_tier_for(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_price_tier_for(text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_set_price_state(p_public_active boolean)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.crm_price_state SET public_active = COALESCE(p_public_active, false), checked_at = now() WHERE id;
$$;
REVOKE ALL ON FUNCTION public.crm_set_price_state(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_set_price_state(boolean) TO service_role;

-- Pour l'Admin › Argent : où en est le seuil.
CREATE OR REPLACE FUNCTION public.crm_admin_price_tier()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._crm_admin_gate();
  RETURN jsonb_build_object('tier', public.crm_price_tier(), 'paying', public.crm_paying_accounts(),
    'switch_at', COALESCE((public.crm_pricing_config()->>'price_switch_at')::int, 50),
    'public_active', (SELECT public_active FROM public.crm_price_state WHERE id),
    'checked_at', (SELECT checked_at FROM public.crm_price_state WHERE id));
END;
$$;
REVOKE ALL ON FUNCTION public.crm_admin_price_tier() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_admin_price_tier() TO authenticated, service_role;

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
  v_tier text;
BEGIN
  IF (p_venue_id IS NULL) = (p_organizer_user_id IS NULL) THEN
    RAISE EXCEPTION 'one scope' USING ERRCODE = '22023';
  END IF;
  IF NOT public.crm_scope_allowed(p_venue_id, p_organizer_user_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.crm_subscriptions WHERE scope_key = v_scope;
  v_tier := public.crm_price_tier_for(v_scope);
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
      -- Prix du niveau de CE compte (lancement garanti à un abonné existant).
      'tier', v_tier,
      'price_month', CASE WHEN v_tier = 'public' THEN (cfg->>'price_month_next')::numeric ELSE (cfg->>'price_month')::numeric END,
      'price_year', CASE WHEN v_tier = 'public' THEN (cfg->>'price_month_next')::numeric * 12 ELSE (cfg->>'price_year')::numeric END,
      'price_month_launch', (cfg->>'price_month')::numeric,
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
