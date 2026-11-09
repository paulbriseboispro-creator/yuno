-- Le déclencheur qui donne le rôle `organizer` à tout profil organisateur avait
-- disparu de la prod (constaté le 09/11 sur Lazslo / Booost : profile_type =
-- 'organizer' mais seul le rôle `client` dans user_roles). On le recrée à
-- l'identique de 20260421150210 et on rattrape les comptes restés sans rôle.

CREATE OR REPLACE FUNCTION public.sync_organizer_role_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.profile_type = 'organizer' THEN
    INSERT INTO public.user_roles (user_id, role, email)
    VALUES (NEW.id, 'organizer'::public.app_role, NEW.email)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_organizer_role_from_profile ON public.profiles;
CREATE TRIGGER trg_sync_organizer_role_from_profile
AFTER INSERT OR UPDATE OF profile_type, email ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_organizer_role_from_profile();

-- Rattrapage : les organisateurs sans rôle.
INSERT INTO public.user_roles (user_id, role, email)
SELECT p.id, 'organizer'::public.app_role, p.email
FROM public.profiles p
WHERE p.profile_type = 'organizer'
ON CONFLICT (user_id, role) DO NOTHING;
