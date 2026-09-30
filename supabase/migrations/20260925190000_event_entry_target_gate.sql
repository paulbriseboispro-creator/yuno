-- L'objectif de soirée : une porte, qui dit aussi si le bouton doit exister
-- (2026-09-25).
--
-- Avant : le Rapport écrivait `events.entry_target` directement, sous la RLS
-- d'`events`. Un club qui ne fait qu'ACCUEILLIR la soirée d'un organisateur,
-- un manager sans le droit « soirées » ou un membre d'équipe en lecture
-- voyaient le bouton « Poser un objectif »… et un refus au moment
-- d'enregistrer. Une seule fonction décide désormais ET sert l'écriture :
-- l'écran ne montre le bouton que si elle répond oui.
--
-- Qui pose l'objectif : ceux qui font la soirée — le club qui la porte
-- (propriétaire, co-propriétaire rattaché, manager « soirées »),
-- l'organisateur et son équipe (éditeur ou plus), et, sur une co-soirée, le
-- partenaire (club hôte ou organisateur partenaire) : l'objectif est un
-- chiffre partagé du travail commun. L'objectif ne touche à aucun argent.

CREATE OR REPLACE FUNCTION public.can_set_event_entry_target(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id
      AND (
        public.is_super_admin()
        OR e.organizer_user_id = auth.uid()
        OR (e.organizer_user_id IS NOT NULL AND public.is_org_team_member(auth.uid(), e.organizer_user_id, 'editor'))
        OR (e.venue_id IS NOT NULL AND (
              public.is_venue_owner(auth.uid(), e.venue_id)
              OR public.manager_has_permission(auth.uid(), e.venue_id, 'events')
              OR (public.has_role(auth.uid(), 'owner'::public.app_role)
                  AND e.venue_id = public.get_user_venue_id(auth.uid()))))
        OR public.is_event_partner_organizer(auth.uid(), e.id)
        OR public.is_event_partner_venue_owner(auth.uid(), e.id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.set_event_entry_target(p_event_id uuid, p_target integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.can_set_event_entry_target(p_event_id) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF p_target IS NOT NULL AND (p_target < 1 OR p_target > 100000) THEN
    RAISE EXCEPTION 'invalid_target' USING ERRCODE = '22023';
  END IF;
  UPDATE public.events SET entry_target = p_target WHERE id = p_event_id;
  RETURN p_target;
END;
$$;

REVOKE ALL ON FUNCTION public.can_set_event_entry_target(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_event_entry_target(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_set_event_entry_target(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_event_entry_target(uuid, integer) TO authenticated, service_role;
