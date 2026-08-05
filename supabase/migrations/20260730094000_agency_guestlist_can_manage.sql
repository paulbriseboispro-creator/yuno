-- =====================================================================
-- can_manage_guest_list_part — le chef d'agence gère l'enveloppe agence ET les
-- sous-parts promoteur qu'il a distribuées.
--
-- Sans ça, une sous-part promoteur est scopée sur le venue du club : le chef
-- d'agence (ni owner du club, ni titulaire user_id de la part) ne pourrait pas
-- y ajouter d'invité, poser un lien public ou un lien unique via guest-list-manage.
-- On ajoute donc deux voies :
--   • part 'agency'  → is_agency_owner sur l'agence de la part.
--   • sous-part 'promoter' d'un promoteur d'AGENCE → is_agency_owner sur cette agence.
-- On n'accorde PAS aux promoteurs de terrain la gestion de la part pool : leur
-- ajout passe par leur chemin self-service (promoter-add-guest), pas ici.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.can_manage_guest_list_part(_user_id uuid, _guest_list_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.guest_lists gl
    WHERE gl.id = _guest_list_id
      AND (
        -- Part maison : suit le domaine operations (même verrou que le trigger).
        (gl.holder_type = 'club'
         AND public.can_manage_event_guestlist_house(_user_id, gl.event_id))
        -- Part d'allocation organisateur : l'organisateur seul.
        OR (gl.holder_type = 'organizer' AND gl.organizer_user_id = _user_id)
        -- Enveloppe agence : le chef d'agence.
        OR (gl.holder_type = 'agency' AND public.is_agency_owner(_user_id, gl.agency_id))
        -- Parts déléguées : le détenteur…
        OR (gl.holder_type = 'dj' AND EXISTS (
              SELECT 1 FROM public.djs d
              WHERE d.id = gl.dj_id AND d.user_id = _user_id))
        OR (gl.holder_type = 'promoter' AND EXISTS (
              SELECT 1 FROM public.promoters p
              WHERE p.id = gl.promoter_id AND p.user_id = _user_id))
        -- …ET la partie qui a accordé la part (scope des colonnes), custom incluse.
        OR (gl.holder_type IN ('dj','promoter','custom') AND (
              (gl.venue_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.venues v
                 WHERE v.id = gl.venue_id
                   AND (v.owner_id = _user_id OR public.can_manage_venue(_user_id, v.id))))
              OR gl.organizer_user_id = _user_id))
        -- Sous-part promoteur distribuée par une agence : le chef d'agence la gère.
        OR (gl.holder_type = 'promoter' AND EXISTS (
              SELECT 1 FROM public.promoters p
              WHERE p.id = gl.promoter_id
                AND p.agency_id IS NOT NULL
                AND public.is_agency_owner(_user_id, p.agency_id)))
        OR public.is_super_admin()
      )
  )
$$;

REVOKE ALL ON FUNCTION public.can_manage_guest_list_part(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_guest_list_part(uuid, uuid) TO authenticated, service_role;
