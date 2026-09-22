-- Un club INVITÉ par un organisateur (plan Collaboration, pas encore de compte
-- Stripe) tombait, à la seconde où il acceptait l'invitation, sur « Activez
-- la double authentification, obligatoire pour les propriétaires » — avant
-- même d'avoir vu la soirée ou le contrat. Un club qui découvre Yuno décroche
-- là. La 2FA reste obligatoire : elle devient DIFFÉRABLE 7 jours, une seule
-- fois, tant que le club n'a pas connecté Stripe — l'argent est la seule chose
-- que la 2FA protège, et il n'y en a pas encore. La page Paiements (Stripe)
-- reste derrière la 2FA même pendant le report (RequireMFA).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS mfa_deferred_until timestamptz;
COMMENT ON COLUMN public.profiles.mfa_deferred_until IS
  'Report ponctuel de l''enrôlement 2FA (7 j, une fois) pour un club au plan Collaboration sans compte Stripe. NULL = jamais reporté.';

-- Éligible ? (le front n'affiche « Plus tard » que si oui)
CREATE OR REPLACE FUNCTION public.mfa_deferral_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_prof record;
  v_eligible boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('eligible', false); END IF;
  SELECT mfa_enabled, mfa_exempt, mfa_deferred_until INTO v_prof FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN RETURN jsonb_build_object('eligible', false); END IF;

  -- Un club au plan Collaboration, sans Stripe, jamais reporté.
  SELECT EXISTS (
    SELECT 1
    FROM public.venues v
    JOIN public.venue_subscriptions s ON s.venue_id = v.id
    WHERE v.owner_id = v_uid
      AND s.subscription_plan = 'collab'
      AND v.stripe_account_id IS NULL
  ) INTO v_eligible;

  RETURN jsonb_build_object(
    'eligible', COALESCE(v_eligible, false) AND NOT COALESCE(v_prof.mfa_enabled, false)
                AND NOT COALESCE(v_prof.mfa_exempt, false) AND v_prof.mfa_deferred_until IS NULL,
    'deferred_until', v_prof.mfa_deferred_until,
    'active', v_prof.mfa_deferred_until IS NOT NULL AND v_prof.mfa_deferred_until > now()
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.defer_mfa_setup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_status jsonb;
  v_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_status := public.mfa_deferral_status();
  IF NOT COALESCE((v_status->>'eligible')::boolean, false) THEN RAISE EXCEPTION 'not_eligible'; END IF;
  v_until := now() + interval '7 days';
  UPDATE public.profiles SET mfa_deferred_until = v_until WHERE id = v_uid;
  RETURN jsonb_build_object('deferred_until', v_until);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.mfa_deferral_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.defer_mfa_setup() TO authenticated;
