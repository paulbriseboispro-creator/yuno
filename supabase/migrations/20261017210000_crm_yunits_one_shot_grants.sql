-- Yuno CRM — les Yunits offerts ne sont plus mensuels (décision de Paul, 06/10).
--
-- L'abonnement (24 € HT) est déjà rentable par ce que le CRM fait ; ce sont les
-- Yunits qui rémunèrent Yuno sur les outils marketing. Donc plus de 10 000
-- Yunits offerts chaque mois :
--   essai de 14 jours      →  2 000 Yunits (lot « trial », jusqu'à la fin de l'essai) ;
--   abonnement MENSUEL     → 10 000 Yunits UNE fois, à l'abonnement
--                            (lot « grant », source_ref 'welcome', valable 12 mois) ;
--   abonnement ANNUEL      → 30 000 Yunits d'un coup (inchangé, posé par
--                            crm_apply_stripe_subscription), plus rien chaque mois.
-- La clé `monthly_yunits` de crm_pricing garde son nom (lue par plusieurs
-- fonctions et l'Admin) mais veut dire « offerts à l'abonnement mensuel, une fois ».
--
-- Les comptes qui ont déjà reçu un lot mensuel ou le bonus annuel ne reçoivent
-- pas le cadeau d'accueil en plus.

-- low_balance passe de 2 000 à 1 000 : l'essai n'offre plus que 2 000 Yunits, le
-- solde serait « bas » dès la première campagne.
UPDATE public.crm_pricing
SET config = config || jsonb_build_object('trial_yunits', 2000, 'monthly_yunits', 10000, 'annual_bonus_yunits', 30000, 'low_balance', 1000),
    updated_at = now()
WHERE id;

CREATE OR REPLACE FUNCTION public.crm_yunits_ensure_allowance(p_scope_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.crm_subscriptions%ROWTYPE;
  cfg jsonb := public.crm_pricing_config();
BEGIN
  SELECT * INTO s FROM public.crm_subscriptions WHERE scope_key = p_scope_key;
  IF NOT FOUND OR NOT public.crm_scope_has_crm(p_scope_key) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'not_crm');
  END IF;

  IF s.status = 'trialing' AND s.trial_ends_at > now() THEN
    RETURN public.crm_yunits_credit(p_scope_key, 'trial', (cfg->>'trial_yunits')::int, s.trial_ends_at,
                                    'trial', 'Offerts pendant l’essai');
  END IF;

  IF s.status IN ('active', 'past_due') THEN
    -- Annuel : le bonus est posé à la période payée par crm_apply_stripe_subscription.
    IF s.billing_interval = 'year' THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'annual');
    END IF;
    -- Offre accordée à la main et échue : rien.
    IF s.stripe_subscription_id IS NULL AND s.current_period_end IS NOT NULL AND s.current_period_end < now() THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'expired');
    END IF;
    -- Une seule fois par compte, jamais en plus d'un ancien lot mensuel ou du bonus annuel.
    IF EXISTS (SELECT 1 FROM public.crm_yunit_lots
                WHERE scope_key = p_scope_key
                  AND (kind IN ('monthly', 'annual_bonus') OR (kind = 'grant' AND source_ref = 'welcome'))) THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'already_granted');
    END IF;
    RETURN public.crm_yunits_credit(p_scope_key, 'grant', (cfg->>'monthly_yunits')::int,
                                    now() + make_interval(months => COALESCE((cfg->>'purchase_validity_months')::int, 12)),
                                    'welcome', 'Offerts à l’abonnement');
  END IF;

  RETURN jsonb_build_object('ok', true, 'skipped', s.status);
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_yunits_ensure_allowance(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_yunits_ensure_allowance(text) TO service_role;
