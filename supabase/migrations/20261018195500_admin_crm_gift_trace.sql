-- Offrir Yuno CRM depuis le super admin : le don se voit et se trace.
--
-- Constaté le 17/10 sur Amoris : « Offrir Yuno CRM » avait bien accordé le
-- socle (crm_subscriptions active, sans Stripe, granted_by posé, 10 000 Yunits
-- de bienvenue), mais la fenêtre « Produits » rouverte affichait toujours le
-- bouton « Offrir » et un historique sans le don. admin_grant_crm_plan
-- n'écrivait ni l'historique des produits ni le journal d'audit, et
-- admin_account_products ne rendait pas l'état de l'abonnement CRM.
--
-- 1. account_product_events accepte deux actions de plus : 'gifted' (CRM offert)
--    et 'grant_ended' (CRM mis en pause par un admin).
-- 2. admin_grant_crm_plan écrit une ligne d'historique ET une ligne
--    admin_audit_log (entity_type 'crm_account', comme les autres gestes de
--    l'Admin CRM : crm_grant_plan / crm_end_grant) — seulement quand l'état
--    change : un deuxième clic sur un don identique n'écrit rien.
-- 3. admin_account_products rend en plus `crm`, l'état de l'abonnement CRM par
--    portée (statut, offert, par qui, depuis quand, jusqu'à quand, Yunits).
-- 4. Rattrapage : la ligne d'historique des dons déjà faits (Amoris, 17/10).
--
-- Corps repartis de pg_get_functiondef de la prod (17/10). Aucune règle de
-- facturation ne change : même écriture de crm_subscriptions, même synchro.

ALTER TABLE public.account_product_events DROP CONSTRAINT IF EXISTS account_product_events_action_check;
ALTER TABLE public.account_product_events ADD CONSTRAINT account_product_events_action_check
  CHECK (action = ANY (ARRAY['added'::text, 'invited'::text, 'gifted'::text, 'grant_ended'::text]));

CREATE OR REPLACE FUNCTION public.admin_grant_crm_plan(p_scope_key text, p_plan text, p_until timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pause boolean;
  v_prev public.crm_subscriptions%ROWTYPE;
  v_found boolean;
  v_changed boolean;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF p_plan NOT IN ('base', 'paused', 'free', 'essential', 'pro', 'business') OR p_scope_key !~ '^(venue|org):.+$' THEN
    RAISE EXCEPTION 'bad_input' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.crm_subscriptions WHERE scope_key = p_scope_key AND stripe_subscription_id IS NOT NULL
               AND status IN ('trialing', 'active', 'past_due')) THEN
    RAISE EXCEPTION 'has_stripe_subscription' USING ERRCODE = 'P0001';
  END IF;
  v_pause := p_plan IN ('paused', 'free');

  SELECT * INTO v_prev FROM public.crm_subscriptions WHERE scope_key = p_scope_key;
  v_found := FOUND;
  -- Un don identique déjà en place, ou une pause sur un compte déjà en pause :
  -- rien de neuf à tracer.
  v_changed := CASE
    WHEN v_pause THEN v_found AND v_prev.status IS DISTINCT FROM 'none'
    ELSE NOT (v_found AND v_prev.stripe_subscription_id IS NULL AND v_prev.status = 'active'
              AND v_prev.granted_by IS NOT NULL AND v_prev.current_period_end IS NOT DISTINCT FROM p_until)
  END;

  INSERT INTO public.crm_subscriptions AS s (scope_key, venue_id, organizer_user_id, plan, status, current_period_end, granted_by)
  VALUES (p_scope_key,
          CASE WHEN p_scope_key LIKE 'venue:%' THEN substr(p_scope_key, 7) END,
          CASE WHEN p_scope_key LIKE 'org:%' THEN substr(p_scope_key, 5)::uuid END,
          'base', CASE WHEN v_pause THEN 'none' ELSE 'active' END, p_until, auth.uid())
  ON CONFLICT (scope_key) DO UPDATE SET plan = 'base', status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end, granted_by = EXCLUDED.granted_by, updated_at = now();
  PERFORM public.crm_sync_scope(p_scope_key);

  IF v_changed THEN
    INSERT INTO public.account_product_events (scope_key, venue_id, organizer_user_id, product, action, via, actor)
    VALUES (p_scope_key,
            CASE WHEN p_scope_key LIKE 'venue:%' THEN substr(p_scope_key, 7) END,
            CASE WHEN p_scope_key LIKE 'org:%' THEN substr(p_scope_key, 5)::uuid END,
            'crm', CASE WHEN v_pause THEN 'grant_ended' ELSE 'gifted' END, 'admin', auth.uid());
    PERFORM public._crm_admin_audit(CASE WHEN v_pause THEN 'crm_end_grant' ELSE 'crm_grant_plan' END, p_scope_key,
      jsonb_build_object('until', p_until,
                         'previous_status', CASE WHEN v_found THEN v_prev.status END,
                         'previous_until', CASE WHEN v_found THEN v_prev.current_period_end END));
  END IF;

  RETURN jsonb_build_object('ok', true, 'changed', v_changed, 'effective_plan', public.crm_effective_plan(p_scope_key));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_grant_crm_plan(text, text, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_crm_plan(text, text, timestamp with time zone) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_account_products(p_scope_keys text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('scope_key', e.scope_key, 'product', e.product, 'action', e.action,
                                          'via', e.via, 'email', e.email, 'created_at', e.created_at)
                       ORDER BY e.created_at DESC)
        FROM public.account_product_events e
       WHERE p_scope_keys IS NULL OR e.scope_key = ANY (p_scope_keys)), '[]'::jsonb),
    'open_invites', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('scope_key', i.scope_key, 'product', i.product, 'email', i.email,
                                          'created_at', i.created_at, 'expires_at', i.expires_at))
        FROM public.account_product_invites i
       WHERE i.accepted_at IS NULL AND i.canceled_at IS NULL AND i.expires_at > now()
         AND (p_scope_keys IS NULL OR i.scope_key = ANY (p_scope_keys))), '[]'::jsonb),
    -- L'abonnement CRM de chaque portée. « Offert » = actif sans abonnement
    -- Stripe, la règle de get_crm_billing ; `expired` = offre datée échue
    -- (crm_effective_plan la rend alors en pause).
    'crm', COALESCE((
      SELECT jsonb_object_agg(s.scope_key, jsonb_build_object(
               'status', s.status,
               'plan', s.plan,
               'stripe', s.stripe_subscription_id IS NOT NULL,
               'granted', s.stripe_subscription_id IS NULL AND s.status = 'active',
               'expired', s.stripe_subscription_id IS NULL AND s.status = 'active'
                          AND s.current_period_end IS NOT NULL AND s.current_period_end < now(),
               'granted_by', s.granted_by,
               'granted_by_name', CASE WHEN s.granted_by IS NOT NULL THEN
                   COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email) END,
               'granted_at', CASE WHEN s.stripe_subscription_id IS NULL AND s.status = 'active' THEN
                   COALESCE((SELECT max(g.created_at) FROM public.account_product_events g
                              WHERE g.scope_key = s.scope_key AND g.product = 'crm' AND g.action = 'gifted'),
                            s.updated_at) END,
               'until', s.current_period_end,
               'trial_ends_at', s.trial_ends_at,
               'yunits', public.crm_yunits_balance(s.scope_key)))
        FROM public.crm_subscriptions s
        LEFT JOIN public.profiles p ON p.id = s.granted_by
       WHERE p_scope_keys IS NULL OR s.scope_key = ANY (p_scope_keys)), '{}'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_account_products(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_account_products(text[]) TO authenticated, service_role;

-- Rattrapage : chaque don déjà en place (aujourd'hui Amoris, 17/10) reçoit sa
-- ligne d'historique. Date = le lot de bienvenue posé par le même admin
-- (premier clic), sinon la dernière écriture de l'abonnement.
INSERT INTO public.account_product_events (scope_key, venue_id, organizer_user_id, product, action, via, actor, created_at)
SELECT s.scope_key, s.venue_id, s.organizer_user_id, 'crm', 'gifted', 'admin', s.granted_by,
       LEAST(s.updated_at, COALESCE((SELECT min(l.created_at) FROM public.crm_yunit_lots l
                                      WHERE l.scope_key = s.scope_key AND l.kind = 'grant'
                                        AND l.source_ref = 'welcome' AND l.created_by = s.granted_by), s.updated_at))
  FROM public.crm_subscriptions s
 WHERE s.stripe_subscription_id IS NULL AND s.status = 'active' AND s.granted_by IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.account_product_events e
                    WHERE e.scope_key = s.scope_key AND e.product = 'crm' AND e.action = 'gifted');
