-- SÉCURITÉ — le mot de passe de maintenance (2026-09-25).
--
-- La base avait dérivé du dépôt : `update_maintenance_password` n'y portait
-- plus la garde super admin de 20260503133945, et les trois fonctions étaient
-- exécutables par `anon`. Tant que pgcrypto était hors du search_path, rien ne
-- marchait ; 20260925185000 l'a réparé, et un visiteur NON CONNECTÉ pouvait
-- alors poser le mot de passe qui contourne la maintenance. On remet la garde
-- et on ferme les droits : poser = super admin ; vérifier = l'edge
-- `verify-maintenance-password` seule (service_role, qui porte la limite par
-- IP) ; hacher = interne.

CREATE OR REPLACE FUNCTION public.update_maintenance_password(new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF new_password IS NULL OR length(new_password) < 8 OR length(new_password) > 200 THEN
    RAISE EXCEPTION 'Invalid password length';
  END IF;

  UPDATE public.app_settings
  SET maintenance_password_hash = public.hash_maintenance_password(new_password),
      maintenance_password = NULL,
      updated_at = now()
  WHERE id = 'global';
END;
$function$;

REVOKE ALL ON FUNCTION public.update_maintenance_password(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_maintenance_password(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.verify_maintenance_password(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_maintenance_password(text) TO service_role;

REVOKE ALL ON FUNCTION public.hash_maintenance_password(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hash_maintenance_password(text) TO service_role;
