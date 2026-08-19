-- ─────────────────────────────────────────────────────────────────────────────
-- Porte de vente « paiements prêts » — exposée au client.
--
-- Contexte (rejet App Store 2.1(a) du 2026-08-18) : les trois checkouts
-- (billets, tables, boissons) refusent côté serveur toute vente quand le club
-- n'a pas de compte Stripe Connect actif (stripe_account_id NULL ou charges
-- désactivées). Le front, lui, ne savait pas : il affichait un parcours d'achat
-- complet qui se terminait par un message d'erreur au clic « Payer » — c'est
-- exactement ce que le reviewer Apple a vu.
--
-- Ces deux RPC lecture seule donnent au front la même vérité que le serveur,
-- pour présenter la vente comme « pas encore ouverte » AVANT le formulaire.
-- SECURITY DEFINER obligatoire : les colonnes stripe_* de venues/profiles ne
-- sont pas lisibles par anon/authenticated (grants par colonne) — et ne doivent
-- pas le devenir. On n'expose qu'un booléen.
--
-- Miroir exact de create-ticket-checkout : payout venue si events.venue_id est
-- renseigné, sinon payout organisateur (organizer_user_id, à défaut
-- partner_organizer_id). Le serveur reste le juge final — ces RPC ne sont
-- qu'une prévisualisation UX, jamais une autorisation.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.venue_payments_ready(p_venue_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT v.stripe_account_id IS NOT NULL AND COALESCE(v.stripe_charges_enabled, false)
    FROM public.venues v
    WHERE v.id = p_venue_id
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.event_payments_ready(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN e.venue_id IS NOT NULL THEN (
        SELECT v.stripe_account_id IS NOT NULL AND COALESCE(v.stripe_charges_enabled, false)
        FROM public.venues v
        WHERE v.id = e.venue_id
      )
      ELSE (
        SELECT p.stripe_connect_account_id IS NOT NULL AND COALESCE(p.stripe_connect_charges_enabled, false)
        FROM public.profiles p
        WHERE p.id = COALESCE(e.organizer_user_id, e.partner_organizer_id)
      )
    END
    FROM public.events e
    WHERE e.id = p_event_id
  ), false);
$$;

REVOKE ALL ON FUNCTION public.venue_payments_ready(text) FROM public;
REVOKE ALL ON FUNCTION public.event_payments_ready(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.venue_payments_ready(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_payments_ready(uuid) TO anon, authenticated;
