-- DJ Secured Bookings (option) — contrat numérique + séquestre + payout auto via Stripe.
--
-- Couche OPTIONNELLE par-dessus le booking DJ existant (dj_sets / dj_booking_requests).
-- Le flux par défaut (owner marque le cachet "payé" à la main) reste intact. Quand un
-- booker active la sécurisation : le club paie le cachet, l'argent dort sur le solde Yuno,
-- puis est versé au DJ après la presta (clic "presta effectuée" OU auto X jours après).
--
-- Garde-fou identité (comme le marketplace) : un compte Stripe Connect = PAR PERSONNE,
-- donc clé sur user_id (table dj_stripe_accounts), jamais sur une ligne djs (N par personne).
--
-- Décisions produit : Yuno gratuit (le club paie les frais Stripe en plus, le DJ touche
-- 100% du cachet) · tout encaissé à la signature · acompte versé au DJ dès l'encaissement,
-- solde après la presta · annulation = le DJ garde l'acompte, le solde retourne au club.
--
-- Sécurité : toutes les ÉCRITURES passent par des RPC SECURITY DEFINER ou les edge
-- functions (stripe-connect / stripe-webhook) en service_role. RLS = LECTURE seulement.

-- =============================================================================
-- 1. dj_stripe_accounts — compte Stripe Connect du DJ, PAR PERSONNE (PK user_id)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.dj_stripe_accounts (
  user_id             uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_account_id   text UNIQUE,
  status              text NOT NULL DEFAULT 'none' CHECK (status IN ('none','pending','active','restricted')),
  charges_enabled     boolean NOT NULL DEFAULT false,
  payouts_enabled     boolean NOT NULL DEFAULT false,
  onboarding_complete boolean NOT NULL DEFAULT false,
  onboarded_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dj_stripe_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dj_stripe_accounts_self_select ON public.dj_stripe_accounts;
CREATE POLICY dj_stripe_accounts_self_select ON public.dj_stripe_accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS dj_stripe_accounts_admin_all ON public.dj_stripe_accounts;
CREATE POLICY dj_stripe_accounts_admin_all ON public.dj_stripe_accounts
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP TRIGGER IF EXISTS update_dj_stripe_accounts_updated_at ON public.dj_stripe_accounts;
CREATE TRIGGER update_dj_stripe_accounts_updated_at
  BEFORE UPDATE ON public.dj_stripe_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 2. dj_booking_contracts — contrat sécurisé attaché à un dj_set (1:1)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.dj_booking_contracts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dj_set_id          uuid NOT NULL UNIQUE REFERENCES public.dj_sets(id) ON DELETE CASCADE,
  booking_request_id uuid REFERENCES public.dj_booking_requests(id) ON DELETE SET NULL,
  dj_id              uuid NOT NULL REFERENCES public.djs(id) ON DELETE CASCADE,
  dj_user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,  -- bénéficiaire (personne)

  venue_id           text REFERENCES public.venues(id) ON DELETE CASCADE,
  organizer_user_id  uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by         uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,

  status             text NOT NULL DEFAULT 'draft' CHECK (status IN (
                       'draft','pending_dj_setup','pending_signatures','pending_payment',
                       'funds_held','released','cancelled','refunded')),
  currency           text NOT NULL DEFAULT 'eur',

  cachet_cents       integer NOT NULL CHECK (cachet_cents > 0),
  acompte_cents      integer NOT NULL DEFAULT 0 CHECK (acompte_cents >= 0 AND acompte_cents <= cachet_cents),
  stripe_fee_cents   integer NOT NULL DEFAULT 0,                          -- frais payés EN PLUS par le club
  cancellation_policy text NOT NULL DEFAULT 'acompte_to_dj'
                       CHECK (cancellation_policy IN ('acompte_to_dj','full_refund')),
  terms_snapshot     jsonb,                                              -- figé à la signature complète
  contract_pdf_url   text,

  -- signatures électroniques simples (clic + horodatage + IP + user-agent)
  club_signed_at     timestamptz, club_signed_by uuid, club_signed_ip text, club_signed_user_agent text,
  dj_signed_at       timestamptz, dj_signed_by uuid, dj_signed_ip text, dj_signed_user_agent text,

  -- traçabilité Stripe
  payment_intent_id  text,
  charge_id          text,
  acompte_transfer_id text, acompte_released_at timestamptz,
  balance_transfer_id text, released_at timestamptz,
  refund_id          text, refunded_at timestamptz,

  auto_release_at    timestamptz,                                        -- = fin du set + délai (filet DJ)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dj_booking_contracts_scope_check CHECK (
    (venue_id IS NOT NULL AND organizer_user_id IS NULL)
    OR (venue_id IS NULL AND organizer_user_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS dj_booking_contracts_dj_idx       ON public.dj_booking_contracts (dj_user_id, status);
CREATE INDEX IF NOT EXISTS dj_booking_contracts_venue_idx    ON public.dj_booking_contracts (venue_id);
CREATE INDEX IF NOT EXISTS dj_booking_contracts_org_idx      ON public.dj_booking_contracts (organizer_user_id);
CREATE INDEX IF NOT EXISTS dj_booking_contracts_release_idx  ON public.dj_booking_contracts (status, auto_release_at)
  WHERE status = 'funds_held';

ALTER TABLE public.dj_booking_contracts ENABLE ROW LEVEL SECURITY;

-- Table 2 parties : LECTURE seulement (booker + DJ + admin). Écritures via RPC / edge.
DROP POLICY IF EXISTS dj_booking_contracts_booker_select ON public.dj_booking_contracts;
CREATE POLICY dj_booking_contracts_booker_select ON public.dj_booking_contracts
  FOR SELECT TO authenticated USING (
    created_by = auth.uid()
    OR (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
    OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
  );
DROP POLICY IF EXISTS dj_booking_contracts_dj_select ON public.dj_booking_contracts;
CREATE POLICY dj_booking_contracts_dj_select ON public.dj_booking_contracts
  FOR SELECT TO authenticated USING (dj_user_id = auth.uid());
DROP POLICY IF EXISTS dj_booking_contracts_admin_all ON public.dj_booking_contracts;
CREATE POLICY dj_booking_contracts_admin_all ON public.dj_booking_contracts
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP TRIGGER IF EXISTS update_dj_booking_contracts_updated_at ON public.dj_booking_contracts;
CREATE TRIGGER update_dj_booking_contracts_updated_at
  BEFORE UPDATE ON public.dj_booking_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 3. Storage bucket pour les PDF de contrat signés
-- =============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('dj-contracts', 'dj-contracts', false)
ON CONFLICT (id) DO NOTHING;

-- Booker et DJ peuvent lire/écrire les PDF de leurs contrats (chemin = <contract_id>/...).
DROP POLICY IF EXISTS dj_contracts_read ON storage.objects;
CREATE POLICY dj_contracts_read ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'dj-contracts' AND EXISTS (
      SELECT 1 FROM public.dj_booking_contracts c
      WHERE c.id::text = split_part(name, '/', 1)
        AND (c.created_by = auth.uid() OR c.dj_user_id = auth.uid()
             OR (c.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), c.venue_id))
             OR (c.organizer_user_id IS NOT NULL AND c.organizer_user_id = auth.uid()))
    ));
DROP POLICY IF EXISTS dj_contracts_write ON storage.objects;
CREATE POLICY dj_contracts_write ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'dj-contracts' AND EXISTS (
      SELECT 1 FROM public.dj_booking_contracts c
      WHERE c.id::text = split_part(name, '/', 1)
        AND (c.created_by = auth.uid() OR c.dj_user_id = auth.uid()
             OR (c.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), c.venue_id))
             OR (c.organizer_user_id IS NOT NULL AND c.organizer_user_id = auth.uid()))
    ));

-- =============================================================================
-- 4. RPC — création du contrat (booker)
--    Grille frais Stripe alignée sur _shared/payment-split.ts (1,5% + 0,25€), gross-up
--    pour que la plateforme récupère son coût réel → DJ touche 100% du cachet.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.create_dj_booking_contract(
  p_dj_set_id          uuid,
  p_cachet_cents       integer,
  p_acompte_cents      integer DEFAULT 0,
  p_cancellation_policy text   DEFAULT 'acompte_to_dj'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_set       public.dj_sets%ROWTYPE;
  v_dj_user   uuid;
  v_payouts   boolean;
  v_total     integer;
  v_fee       integer;
  v_status    text;
  v_id        uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_cachet_cents IS NULL OR p_cachet_cents <= 0 THEN RAISE EXCEPTION 'Invalid cachet'; END IF;
  IF COALESCE(p_acompte_cents,0) < 0 OR COALESCE(p_acompte_cents,0) > p_cachet_cents THEN
    RAISE EXCEPTION 'Invalid acompte';
  END IF;
  IF p_cancellation_policy NOT IN ('acompte_to_dj','full_refund') THEN
    RAISE EXCEPTION 'Invalid cancellation policy';
  END IF;

  SELECT * INTO v_set FROM public.dj_sets WHERE id = p_dj_set_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DJ set not found'; END IF;

  -- Autorisation : le caller doit posséder le scope du set (venue owner OU organizer).
  IF v_set.venue_id IS NOT NULL THEN
    IF NOT public.is_venue_owner(auth.uid(), v_set.venue_id) THEN
      RAISE EXCEPTION 'Unauthorized: not the venue owner';
    END IF;
  ELSIF v_set.organizer_user_id IS NOT NULL THEN
    IF v_set.organizer_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized: organizer scope mismatch';
    END IF;
  ELSE
    RAISE EXCEPTION 'DJ set has no scope';
  END IF;

  IF EXISTS (SELECT 1 FROM public.dj_booking_contracts c
              WHERE c.dj_set_id = p_dj_set_id
                AND c.status NOT IN ('cancelled','refunded')) THEN
    RAISE EXCEPTION 'A secured contract already exists for this set';
  END IF;

  SELECT user_id INTO v_dj_user FROM public.djs WHERE id = v_set.dj_id;
  IF v_dj_user IS NULL THEN RAISE EXCEPTION 'DJ has no linked account'; END IF;

  -- Gross-up des frais Stripe (1,5% + 0,25€) sur le total chargé.
  v_total := ceil((p_cachet_cents + 25)::numeric / (1 - 0.015));
  v_fee   := v_total - p_cachet_cents;

  -- Le DJ peut-il déjà recevoir un payout ? Sinon, on gate sur l'onboarding.
  SELECT payouts_enabled INTO v_payouts FROM public.dj_stripe_accounts WHERE user_id = v_dj_user;
  v_status := CASE WHEN COALESCE(v_payouts,false) THEN 'pending_signatures' ELSE 'pending_dj_setup' END;

  INSERT INTO public.dj_booking_contracts (
    dj_set_id, dj_id, dj_user_id, venue_id, organizer_user_id, created_by,
    status, cachet_cents, acompte_cents, stripe_fee_cents, cancellation_policy, auto_release_at
  ) VALUES (
    p_dj_set_id, v_set.dj_id, v_dj_user, v_set.venue_id, v_set.organizer_user_id, auth.uid(),
    v_status, p_cachet_cents, COALESCE(p_acompte_cents,0), v_fee, p_cancellation_policy,
    COALESCE(v_set.end_time, v_set.start_time) + interval '2 days'
  ) RETURNING id INTO v_id;

  -- Garder dj_sets.fee aligné sur le cachet (le flux par défaut et l'UI s'en servent).
  UPDATE public.dj_sets SET fee = p_cachet_cents::numeric / 100 WHERE id = p_dj_set_id;

  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_dj_booking_contract(uuid, integer, integer, text) TO authenticated;

-- =============================================================================
-- 5. RPC — signature (club OU DJ ; rôle déduit de auth.uid())
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sign_dj_booking_contract(
  p_contract_id uuid,
  p_ip          text DEFAULT NULL,
  p_user_agent  text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  c          public.dj_booking_contracts%ROWTYPE;
  v_is_club  boolean;
  v_is_dj    boolean;
  v_both     boolean;
BEGIN
  SELECT * INTO c FROM public.dj_booking_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF c.status <> 'pending_signatures' THEN
    RAISE EXCEPTION 'Contract is not awaiting signatures (status=%)', c.status;
  END IF;

  v_is_dj   := (c.dj_user_id = auth.uid());
  v_is_club := (c.created_by = auth.uid())
               OR (c.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), c.venue_id))
               OR (c.organizer_user_id IS NOT NULL AND c.organizer_user_id = auth.uid());
  IF NOT (v_is_dj OR v_is_club) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF v_is_club THEN
    UPDATE public.dj_booking_contracts
       SET club_signed_at = COALESCE(club_signed_at, now()),
           club_signed_by = COALESCE(club_signed_by, auth.uid()),
           club_signed_ip = COALESCE(club_signed_ip, p_ip),
           club_signed_user_agent = COALESCE(club_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
  ELSE
    UPDATE public.dj_booking_contracts
       SET dj_signed_at = COALESCE(dj_signed_at, now()),
           dj_signed_by = COALESCE(dj_signed_by, auth.uid()),
           dj_signed_ip = COALESCE(dj_signed_ip, p_ip),
           dj_signed_user_agent = COALESCE(dj_signed_user_agent, p_user_agent)
     WHERE id = p_contract_id;
  END IF;

  SELECT * INTO c FROM public.dj_booking_contracts WHERE id = p_contract_id;
  v_both := c.club_signed_at IS NOT NULL AND c.dj_signed_at IS NOT NULL;

  IF v_both THEN
    UPDATE public.dj_booking_contracts
       SET status = 'pending_payment',
           terms_snapshot = jsonb_build_object(
             'cachet_cents', c.cachet_cents,
             'acompte_cents', c.acompte_cents,
             'stripe_fee_cents', c.stripe_fee_cents,
             'currency', c.currency,
             'cancellation_policy', c.cancellation_policy,
             'club_signed_at', c.club_signed_at,
             'dj_signed_at', c.dj_signed_at,
             'dj_user_id', c.dj_user_id,
             'created_by', c.created_by,
             'dj_set_id', c.dj_set_id,
             'frozen_at', now()
           )
     WHERE id = p_contract_id;
    RETURN 'pending_payment';
  END IF;

  RETURN 'pending_signatures';
END; $$;

GRANT EXECUTE ON FUNCTION public.sign_dj_booking_contract(uuid, text, text) TO authenticated;

-- =============================================================================
-- 6. RPC — annulation AVANT encaissement (post-encaissement = remboursement via edge)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_dj_booking_contract(p_contract_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c public.dj_booking_contracts%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.dj_booking_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract not found'; END IF;
  IF NOT (c.created_by = auth.uid() OR c.dj_user_id = auth.uid()
          OR (c.venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), c.venue_id))
          OR (c.organizer_user_id IS NOT NULL AND c.organizer_user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF c.status NOT IN ('draft','pending_dj_setup','pending_signatures','pending_payment') THEN
    RAISE EXCEPTION 'Cannot cancel after funds are held (use refund)';
  END IF;
  UPDATE public.dj_booking_contracts SET status = 'cancelled' WHERE id = p_contract_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.cancel_dj_booking_contract(uuid) TO authenticated;

-- =============================================================================
-- 7. Helper appelé par l'edge stripe-connect quand le DJ finit son onboarding :
--    fait avancer ses contrats en attente d'onboarding vers la signature.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.advance_dj_contracts_after_onboarding(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.dj_booking_contracts
     SET status = 'pending_signatures'
   WHERE dj_user_id = p_user_id AND status = 'pending_dj_setup';
END; $$;

-- Called only by the edge functions (stripe-connect status sync + webhook) in
-- service_role, never by end users — so lock it down but keep service_role EXECUTE.
REVOKE ALL ON FUNCTION public.advance_dj_contracts_after_onboarding(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_dj_contracts_after_onboarding(uuid) TO service_role;

-- =============================================================================
-- 8. Cron — libération automatique X jours après la presta (filet DJ).
--    pg_cron appelle l'edge stripe-webhook (verify_jwt=false) avec x-cron-secret,
--    qui transfère le solde des contrats funds_held dont auto_release_at est passé.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'dj-booking-auto-release',
      '0 4 * * *',
      $cron$
        SELECT net.http_post(
          url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/stripe-webhook',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', private.get_cron_secret()
          ),
          body := jsonb_build_object('task', 'dj_booking_auto_release')
        );
      $cron$
    );
  END IF;
END $$;
