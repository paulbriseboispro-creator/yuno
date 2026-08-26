-- ============================================================================
-- Comptes vitrine ORGANISATEUR — marqueur du compte fantôme.
--
-- Pendant du système club (20260826100000), adapté au modèle orga : là où une
-- venue a un id stable et un owner_id transférable, l'identité d'un
-- organisateur EST son user (organizer_profiles.user_id = PK). Le « fantôme »
-- est donc un user jetable qui PORTE le profil orga ; la réclamation est un
-- re-parentage complet (handoff_showcase_organizer, 20260826114000).
--
-- is_showcase_shadow est LA source de vérité « ce profil orga est une vitrine
-- en attente de réclamation » : posé à la création du fantôme
-- (admin-account-recovery, action create-showcase-organizer), remis à false
-- par le handoff. Le redeem du lien preview et la RLS de protection des events
-- (20260826111000) s'appuient sur CE marqueur, jamais sur is_public.
-- ============================================================================

ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS is_showcase_shadow boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizer_profiles.is_showcase_shadow IS
  'Profil orga vitrine de prospection porté par un compte fantôme. Remis à '
  'false par handoff_showcase_organizer à la réclamation.';

-- Sonde utilisée par la policy RESTRICTIVE sur events et par les feeds :
-- « ce user est-il un fantôme vitrine ? ». SECURITY DEFINER : évaluée dans les
-- policies au nom du lecteur (anon compris), qui n'a pas le droit de lire les
-- profils privés.
CREATE OR REPLACE FUNCTION public.is_showcase_organizer(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT op.is_showcase_shadow FROM public.organizer_profiles op WHERE op.user_id = _user_id),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_showcase_organizer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_showcase_organizer(uuid) TO anon, authenticated, service_role;

-- L'invitation plateforme peut porter la vitrine à réclamer : à l'acceptation,
-- accept-platform-invitation déclenche le handoff au lieu de créer un profil
-- orga vierge. (La branche « user existant » d'invite-platform-user, qui
-- convertit sans acceptation, appelle le handoff directement.)
ALTER TABLE public.platform_invitations
  ADD COLUMN IF NOT EXISTS showcase_shadow_user_id uuid NULL;
