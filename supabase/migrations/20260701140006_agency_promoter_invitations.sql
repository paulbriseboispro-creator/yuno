-- Système d'agence autonome — Phase 1 (6) : rattacher une invitation promoteur à
-- une agence. Un promoteur d'agence garde une ligne promoters par club (scope
-- venue/org inchangé) ; agency_id indique quelle agence le gère.

ALTER TABLE public.promoter_invitations
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_promoter_invitations_agency
  ON public.promoter_invitations(agency_id) WHERE agency_id IS NOT NULL;
