-- ============================================================================
-- Périmètre clubs externes par promoteur : un membre du bras affilié peut être
-- limité à CERTAINS clubs externes de l'agence, au lieu de tous.
--
--   • affiliate_members.venue_scope : uuid[] des affiliate_venues autorisés.
--     NULL = tous les clubs (comportement historique, aucun backfill requis).
--   • affiliate_invitations_meta.venue_scope : le périmètre choisi à
--     l'invitation, recopié sur le membre à l'acceptation (nouvel utilisateur).
--
-- Le scope est appliqué côté lecture : les assignations « tous les promoteurs »
-- (member_id NULL) ne remontent au membre que si la soirée a lieu dans un club
-- de son périmètre, et la sélection individuelle côté agence filtre de même.
-- ============================================================================

ALTER TABLE public.affiliate_members
  ADD COLUMN IF NOT EXISTS venue_scope uuid[];

COMMENT ON COLUMN public.affiliate_members.venue_scope IS
  'Clubs externes (affiliate_venues.id) sur lesquels ce membre travaille. NULL = tous.';

ALTER TABLE public.affiliate_invitations_meta
  ADD COLUMN IF NOT EXISTS venue_scope uuid[];

COMMENT ON COLUMN public.affiliate_invitations_meta.venue_scope IS
  'Périmètre clubs externes choisi à l''invitation — recopié sur affiliate_members à l''acceptation.';
