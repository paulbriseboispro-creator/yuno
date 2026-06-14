-- ============================================================
-- FIX: Storage RLS pour affiliate-media
--
-- Le problème : la policy storage fait un sub-SELECT sur affiliates
-- mais le contexte RLS de Supabase Storage bloque ce sub-SELECT.
--
-- Solution : fonction SECURITY DEFINER qui tourne avec les droits
-- du propriétaire (postgres) et bypass le RLS sur affiliates.
-- ============================================================

-- 1. Fonction : retourne l'affiliate_id de l'utilisateur connecté
CREATE OR REPLACE FUNCTION public.current_affiliate_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id::text FROM public.affiliates WHERE user_id = auth.uid()
$$;

-- Accorder l'exécution à tous les rôles Supabase
GRANT EXECUTE ON FUNCTION public.current_affiliate_id() TO authenticated, anon;

-- 2. Fonction : vérifier si l'utilisateur est un affilié actif
CREATE OR REPLACE FUNCTION public.is_active_affiliate()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.affiliates
    WHERE user_id = auth.uid() AND is_active = true
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_active_affiliate() TO authenticated, anon;

-- 3. Remplacement des policies storage avec la fonction SECURITY DEFINER
DROP POLICY IF EXISTS "Public read affiliate media" ON storage.objects;
DROP POLICY IF EXISTS "Affiliates can upload own media" ON storage.objects;
DROP POLICY IF EXISTS "Affiliates can update own media" ON storage.objects;
DROP POLICY IF EXISTS "Affiliates can delete own media" ON storage.objects;

-- Lecture publique : tout le monde peut voir les médias affiliés
CREATE POLICY "Public read affiliate media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'affiliate-media');

-- Upload : l'affilié peut uploader dans son propre dossier {affiliate_id}/...
CREATE POLICY "Affiliates can upload own media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'affiliate-media'
    AND public.is_active_affiliate()
    AND (string_to_array(name, '/'))[1] = public.current_affiliate_id()
  );

-- Update : l'affilié peut modifier ses propres fichiers
CREATE POLICY "Affiliates can update own media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'affiliate-media'
    AND (string_to_array(name, '/'))[1] = public.current_affiliate_id()
  );

-- Delete : l'affilié peut supprimer ses propres fichiers
CREATE POLICY "Affiliates can delete own media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'affiliate-media'
    AND (string_to_array(name, '/'))[1] = public.current_affiliate_id()
  );

-- 4. S'assurer que le bucket est bien public (lecture sans auth)
UPDATE storage.buckets
SET public = true
WHERE id = 'affiliate-media';
