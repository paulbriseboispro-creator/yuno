-- 1. Ajouter la colonne is_hidden aux venues
ALTER TABLE venues ADD COLUMN is_hidden boolean NOT NULL DEFAULT false;

-- 2. Supprimer l'ancienne politique permissive
DROP POLICY IF EXISTS "Everyone can view venues" ON venues;

-- 3. Créer une nouvelle politique avec filtrage - seuls les clubs visibles sont affichés
-- Sauf pour: super admin, propriétaire de CE club spécifique, ou manager de CE club
CREATE POLICY "Everyone can view visible venues"
ON venues FOR SELECT
USING (
  is_hidden = false
  OR is_super_admin()
  OR (owner_id = auth.uid())
  OR can_manage_venue(auth.uid(), id)
);