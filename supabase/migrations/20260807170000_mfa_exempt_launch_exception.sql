-- ============================================================================
-- Exception A2F par compte (lancement Madrid, comptes partagés fondateurs).
--
-- Les comptes marqués mfa_exempt=true ne sont PAS forcés d'enrôler la 2FA
-- sur les routes owner/affilié (RequireMFA côté front). Ils peuvent toujours
-- l'activer volontairement ; si mfa_enabled=true, la vérification du code
-- reste demandée — l'exemption ne porte que sur l'enrôlement obligatoire.
--
-- Défaut false : aucun changement de comportement pour tous les autres
-- comptes, actuels et futurs. Le flag n'est posé que par le super admin.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mfa_exempt boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.mfa_exempt IS
  'Exception explicite à la 2FA obligatoire (comptes partagés du lancement). Ne dispense pas de la vérification quand mfa_enabled=true.';
