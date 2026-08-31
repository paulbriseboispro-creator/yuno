-- ============================================================
-- FIX : upload d'images bloqué dans l'Email Studio
--
-- Symptôme : « new row violates row-level security policy » sur
-- TOUT téléversement du Studio (logo du header ET bloc Image) —
-- les deux passent par le bucket `email-assets`.
--
-- Cause : la policy INSERT exigeait
--   has_role(auth.uid(), 'organizer')
-- alors que l'application ne pose JAMAIS ce rôle : un organisateur
-- est identifié par `profiles.profile_type = 'organizer'` et sa ligne
-- `organizer_profiles` (c'est ce que lit OrgAppRoute/useProfileType).
-- Résultat : 1 organisateur sur 3 en prod (dont WOH) n'avait le droit
-- d'uploader aucune image, et un admin en session support héritait de
-- l'identité du pro, donc du même refus (is_super_admin() est faux
-- pendant une session support — c'est le pro qui est authentifié).
--
-- Correctif : une seule porte, `can_manage_email_assets()`, alignée sur
-- la définition applicative du périmètre (propriétaire de club,
-- organisateur, super admin).
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_manage_email_assets()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.venues WHERE owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'organizer'::app_role)
    OR EXISTS (SELECT 1 FROM public.organizer_profiles WHERE user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND profile_type = 'organizer'
    )
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_email_assets() TO authenticated;

DROP POLICY IF EXISTS "Owners and organizers can upload email assets" ON storage.objects;
CREATE POLICY "Owners and organizers can upload email assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'email-assets' AND public.can_manage_email_assets());

DROP POLICY IF EXISTS "Owners and organizers can update email assets" ON storage.objects;
CREATE POLICY "Owners and organizers can update email assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'email-assets' AND public.can_manage_email_assets())
  WITH CHECK (bucket_id = 'email-assets' AND public.can_manage_email_assets());

DROP POLICY IF EXISTS "Owners and organizers can delete email assets" ON storage.objects;
CREATE POLICY "Owners and organizers can delete email assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'email-assets' AND public.can_manage_email_assets());
