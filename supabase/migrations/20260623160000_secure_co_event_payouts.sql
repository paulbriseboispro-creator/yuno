-- ============================================================================
-- P0-6 — Sécuriser les remboursements co-event (posture « retenir les payouts »).
--
-- RISQUE R1 : aujourd'hui le webhook vire la part de chaque partie IMMÉDIATEMENT à
-- l'encaissement. Si un remboursement arrive APRÈS le payout Stripe vers le compte
-- partenaire, le clawback (createReversal) échoue en silence → l'orga garde l'argent,
-- la plateforme absorbe la perte.
--
-- POSTURE CHOISIE : on RETIENT les transferts partenaire sur le solde plateforme
-- jusqu'à la fin d'une fenêtre de remboursement (fin d'event + 2 jours, =
-- auto_release_at du contrat). Un remboursement AVANT release = aucun transfert n'a
-- eu lieu → annulation propre, zéro perte. Un échec de clawback APRÈS release est
-- inscrit dans un ledger (jamais de perte silencieuse).
--
-- Mécanique :
--   1. revenue_distributions.transfers_release_at + statut 'scheduled' (transfert en
--      attente de libération).
--   2. pg_cron → edge stripe-webhook (task 'release_held_transfers') libère les
--      transferts dont release_at est passé et dont la vente n'a pas été remboursée.
--   3. table transfer_clawbacks : trace tout reversal raté (dette à recouvrer).
-- ============================================================================

-- 1) Colonne de date de libération + statuts 'scheduled' / 'cancelled' / 'partially_refunded'
ALTER TABLE public.revenue_distributions
  ADD COLUMN IF NOT EXISTS transfers_release_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_rev_dist_release
  ON public.revenue_distributions (transfers_release_at)
  WHERE transfers_release_at IS NOT NULL;

-- Le statut secondaire avait un CHECK figé. On l'élargit pour autoriser :
--  - 'scheduled'           : transfert retenu, en attente de libération ;
--  - 'cancelled'           : vente remboursée avant libération (aucun transfert émis) ;
--  - 'partially_refunded'  : déjà écrit par le webhook sur remboursement partiel
--                            (valeur jusqu'ici non autorisée par le CHECK = bug latent).
ALTER TABLE public.revenue_distributions
  DROP CONSTRAINT IF EXISTS revenue_distributions_secondary_transfer_status_check;
ALTER TABLE public.revenue_distributions
  ADD CONSTRAINT revenue_distributions_secondary_transfer_status_check
  CHECK (secondary_transfer_status IN (
    'not_required','pending','scheduled','succeeded','failed','refunded','partially_refunded','cancelled'));

-- primary_transfer_status n'a pas de CHECK (DEFAULT 'not_required') → 'scheduled'/'cancelled' OK tel quel.

-- 2) Ledger des clawbacks ratés (dette à recouvrer, jamais de perte silencieuse)
CREATE TABLE IF NOT EXISTS public.transfer_clawbacks (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_intent_id        text NOT NULL,
  revenue_distribution_id  uuid REFERENCES public.revenue_distributions(id) ON DELETE SET NULL,
  role                     text NOT NULL CHECK (role IN ('primary','secondary')),
  account_id               text,
  transfer_id              text,
  amount_cents             integer NOT NULL DEFAULT 0,
  reason                   text,
  error                    text,
  status                   text NOT NULL DEFAULT 'open' CHECK (status IN ('open','recovered','written_off')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  resolved_at              timestamptz
);

CREATE INDEX IF NOT EXISTS idx_transfer_clawbacks_status ON public.transfer_clawbacks (status, created_at);
CREATE INDEX IF NOT EXISTS idx_transfer_clawbacks_pi ON public.transfer_clawbacks (payment_intent_id);

ALTER TABLE public.transfer_clawbacks ENABLE ROW LEVEL SECURITY;

-- Finance interne : super admin uniquement en lecture. Les écritures passent par le
-- webhook en service_role (qui bypass RLS).
DROP POLICY IF EXISTS transfer_clawbacks_admin_select ON public.transfer_clawbacks;
CREATE POLICY transfer_clawbacks_admin_select ON public.transfer_clawbacks
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- 3) pg_cron — libération des transferts retenus (toutes les heures).
--    Réutilise l'edge stripe-webhook (verify_jwt=false) + x-cron-secret, exactement
--    comme dj-booking-auto-release (pas de nouvelle fonction edge → pas de cap 402).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'release-held-co-event-transfers',
      '7 * * * *',
      $cron$
        SELECT net.http_post(
          url := 'https://fulawxvdlwtdlpkycixe.supabase.co/functions/v1/stripe-webhook',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', private.get_cron_secret()
          ),
          body := jsonb_build_object('task', 'release_held_transfers')
        );
      $cron$
    );
  END IF;
END $$;
