
-- ============================================================
-- DJs : masquer montants financiers au public anonyme
-- ============================================================
REVOKE SELECT (pending_amount, total_paid) ON public.djs FROM anon;

-- ============================================================
-- Organizer profiles : masquer toutes les infos légales/billing
-- ============================================================
REVOKE SELECT (legal_name, legal_address, siret, vat_number, billing_email)
  ON public.organizer_profiles FROM anon;

-- ============================================================
-- Promoters : masquer IBAN, BIC, montants financiers
-- ============================================================
-- Inspecter d'abord les colonnes financières existantes via DO block défensif
DO $$
DECLARE
  cols text[];
  col text;
BEGIN
  SELECT array_agg(column_name)
    INTO cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'promoters'
      AND column_name IN ('iban','bic','pending_amount','total_paid','total_earned',
                          'ticket_commission_value','table_commission_value');
  IF cols IS NOT NULL THEN
    FOREACH col IN ARRAY cols LOOP
      EXECUTE format('REVOKE SELECT (%I) ON public.promoters FROM anon', col);
    END LOOP;
  END IF;
END $$;

-- ============================================================
-- Venues : masquer SIRET, adresse légale, Stripe Connect ID
-- ============================================================
DO $$
DECLARE
  cols text[];
  col text;
BEGIN
  SELECT array_agg(column_name)
    INTO cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'venues'
      AND column_name IN ('siret','legal_address','stripe_account_id','vat_number','billing_email');
  IF cols IS NOT NULL THEN
    FOREACH col IN ARRAY cols LOOP
      EXECUTE format('REVOKE SELECT (%I) ON public.venues FROM anon', col);
    END LOOP;
  END IF;
END $$;

-- ============================================================
-- Events : masquer access_code (validation côté edge function uniquement)
--           et location_address quand l'événement est secret (révocation
--           globale puis on remet via une vue publique scrubée)
-- Note : on retire seulement access_code (car location_address est utile
--         pour les events normaux). La validation des events à lieu secret
--         se fait dans le code applicatif qui utilise location_is_secret.
-- ============================================================
REVOKE SELECT (access_code) ON public.events FROM anon;

-- ============================================================
-- Venue subscriptions : masquer identifiants Stripe au public
-- ============================================================
DO $$
DECLARE
  cols text[];
  col text;
BEGIN
  SELECT array_agg(column_name)
    INTO cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'venue_subscriptions'
      AND column_name IN ('stripe_customer_id','stripe_subscription_id','stripe_price_id');
  IF cols IS NOT NULL THEN
    FOREACH col IN ARRAY cols LOOP
      EXECUTE format('REVOKE SELECT (%I) ON public.venue_subscriptions FROM anon', col);
    END LOOP;
  END IF;
END $$;
