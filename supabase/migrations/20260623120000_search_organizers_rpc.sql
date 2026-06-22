-- Recherche d'organisateurs pour les invitations de collaboration (owner -> orga).
--
-- BUG : sur /owner/collaborations, la recherche d'orga partenaire ne renvoyait
-- jamais rien. La table `profiles` n'a aucune policy RLS qui laisse un owner de
-- club lire les profils organisateurs : les seules policies SELECT sont
--   - "Users can view own profile"        (auth.uid() = id)
--   - "Owners view venue staff profiles"  (venue_id IN owner's venues)
--   - "Managers view venue profiles"
--   - "Super admins can view all profiles"
-- Les profils orga ont venue_id IS NULL -> aucune ne matche -> 0 ligne, sans
-- erreur (RLS filtre les lignes, ne lève pas). La recherche échouait en silence.
--
-- FIX : RPC SECURITY DEFINER qui n'expose que les colonnes annuaire sûres
-- (id, nom, avatar — jamais email / legal_name / siret / vat). Même patron que
-- search_djs_marketplace. Cherche dans `profiles` (tous les orgas, même ceux
-- sans page publique organizer_profiles) et complète le nom/avatar via la
-- fiche publique quand elle existe.

CREATE OR REPLACE FUNCTION public.search_organizers(search_term text)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  organization_name text,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.first_name,
    p.last_name,
    COALESCE(NULLIF(btrim(p.organization_name), ''), op.display_name) AS organization_name,
    COALESCE(p.avatar_url, op.avatar_url) AS avatar_url
  FROM public.profiles p
  LEFT JOIN public.organizer_profiles op ON op.user_id = p.id
  WHERE p.profile_type = 'organizer'
    AND auth.uid() IS NOT NULL
    AND char_length(btrim(search_term)) >= 2
    AND (
      p.organization_name ILIKE '%' || search_term || '%'
      OR p.first_name      ILIKE '%' || search_term || '%'
      OR p.last_name       ILIKE '%' || search_term || '%'
      OR op.display_name   ILIKE '%' || search_term || '%'
    )
  ORDER BY
    (COALESCE(p.organization_name, op.display_name) ILIKE search_term || '%') DESC,
    COALESCE(p.organization_name, op.display_name) ASC
  LIMIT 10;
$$;

-- Réservé aux utilisateurs authentifiés (annuaire orga, pas d'accès anon).
REVOKE ALL ON FUNCTION public.search_organizers(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_organizers(text) TO authenticated;
