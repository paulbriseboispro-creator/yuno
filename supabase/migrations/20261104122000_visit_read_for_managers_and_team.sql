-- ============================================================================
-- Direct : un manager de club et un membre d'équipe d'organisation voient les
-- visiteurs présents comme le propriétaire / le fondateur.
--
-- Le panneau « Visiteurs en direct » (soirée en collab, Live Night, page live
-- d'une soirée d'organisateur) lit `live_visitor_pings` directement (et en
-- Realtime), sous une RLS qui ne connaissait que le propriétaire du club
-- (`is_venue_owner`) et le compte fondateur : un manager ou un éditeur
-- d'équipe y voyait 0 visiteur. Mêmes portes que les RPC d'analyse
-- (`analytics_scope_gate`, `event_analytics_scope`) : `can_manage_venue`,
-- `is_org_team_member(…, 'editor')`. Lecture seule.
--
-- Pas sur `visitor_sessions` : répété le 20/10, une politique de plus évaluée
-- ligne à ligne y fait dépasser le délai de lecture sur un gros club ; ses
-- chiffres passent par les RPC (`get_visit_analytics`, `get_live_view`…). La
-- table des battements, elle, est petite (purge à 2 jours).
-- ============================================================================

-- Une porte, évaluée sous le propriétaire (les tables lues ont leur RLS).
CREATE OR REPLACE FUNCTION public.can_read_visit_scope(p_venue_id text, p_organizer_user_id uuid, p_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
       (p_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), p_venue_id))
    OR (p_organizer_user_id IS NOT NULL AND public.is_org_team_member(auth.uid(), p_organizer_user_id, 'editor'))
    OR (p_event_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.events e
           WHERE e.id = p_event_id
             AND (   (e.venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), e.venue_id))
                  OR (e.partner_venue_id IS NOT NULL AND public.can_manage_venue(auth.uid(), e.partner_venue_id))
                  OR (e.organizer_user_id IS NOT NULL AND public.is_org_team_member(auth.uid(), e.organizer_user_id, 'editor'))
                  OR (e.partner_organizer_id IS NOT NULL AND public.is_org_team_member(auth.uid(), e.partner_organizer_id, 'editor')))))
  )
$function$;

REVOKE ALL ON FUNCTION public.can_read_visit_scope(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_visit_scope(text, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Managers and team read live pings" ON public.live_visitor_pings;
CREATE POLICY "Managers and team read live pings" ON public.live_visitor_pings
  FOR SELECT TO authenticated
  USING (public.can_read_visit_scope(venue_id, organizer_user_id, event_id));
