-- Contrôle l'affichage des liens sociaux sur les linktrees des promoteurs.
-- 'promoter' (défaut) : chaque promoteur affiche ses propres liens.
-- 'agency'            : l'admin impose les liens de l'agence à la place.
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS promoter_social_mode text NOT NULL DEFAULT 'promoter'
    CHECK (promoter_social_mode IN ('promoter', 'agency'));
