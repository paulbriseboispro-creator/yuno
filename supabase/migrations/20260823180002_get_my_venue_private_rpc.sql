-- ============================================================================
-- P0 SÉCURITÉ (étape 1/2) — RPC privée owner/admin pour les colonnes sensibles
-- de venues.
--
-- Contexte : 20260703140000 a retiré les colonnes légales/Stripe de venues au
-- rôle `anon` seulement. Le rôle `authenticated` (n'importe quel compte client
-- gratuit) lit encore stripe_account_id, les drapeaux d'onboarding Stripe et
-- l'invoice_prefix de tous les clubs (vérifié en prod le 2026-08-23 via
-- information_schema.column_privileges : grant table-level complet).
--
-- La migration 20260823180003 (étape 2/2) retire ces colonnes au rôle
-- authenticated. Les surfaces OWNER légitimes (onboarding, formulaire
-- facturation, gate Stripe collab) et les pages super admin basculent sur
-- cette RPC. Elle est ADDITIVE et sans risque : déployable immédiatement,
-- AVANT le patch front.
--
-- Périmètre du retour : les 5 colonnes retirées à authenticated par 180003
-- (stripe_account_id, stripe_onboarding_complete, stripe_charges_enabled,
-- stripe_payouts_enabled, invoice_prefix) + le bloc d'identité légale
-- (legal_name, legal_address, siret, vat_number) pour que les écrans owner
-- « facturation / légal » se servent en un seul appel. L'identité légale
-- reste par ailleurs lisible par authenticated (reçus d'achat et contrats de
-- collab l'exigent) — voir l'en-tête de 20260823180003.
--
-- Accès : propriétaire du club ou super admin. Rien pour anon.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_my_venue_private(p_venue_id text)
RETURNS TABLE (
  id                         text,
  stripe_account_id          text,
  stripe_onboarding_complete boolean,
  stripe_charges_enabled     boolean,
  stripe_payouts_enabled     boolean,
  invoice_prefix             text,
  legal_name                 text,
  legal_address              text,
  siret                      text,
  vat_number                 text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT (public.is_venue_owner(auth.uid(), p_venue_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT v.id,
         v.stripe_account_id,
         v.stripe_onboarding_complete,
         v.stripe_charges_enabled,
         v.stripe_payouts_enabled,
         v.invoice_prefix,
         v.legal_name,
         v.legal_address,
         v.siret,
         v.vat_number
    FROM public.venues v
   WHERE v.id = p_venue_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_venue_private(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_venue_private(text) TO authenticated;
