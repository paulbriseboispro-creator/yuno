-- Point 5 : la PORTE d'une co-soirée s'ouvre aux co-hôtes ÉDITEURS.
--
-- Avant, un co-hôte n'avait pas le manifeste de scan : le jour J, seule
-- l'équipe de l'hôte principal pouvait tenir la porte. is_event_door_staff est
-- la porte UNIQUE de tout le scan organisateur (manifeste, tickets, tables,
-- guest list, participants, synchro hors ligne, conversion promoteur) : l'ouvrir
-- ici suffit. Seul un co-hôte ACCEPTÉ en accès « édition » ouvre sa porte — un
-- co-hôte en lecture ne voit pas la liste nominative (règle de la revue du
-- 29/09), il ne la scanne pas davantage.
--   • co-hôte organisateur : le fondateur, son équipe (admin / éditeur /
--     scanner) et son staff de porte (org_staff bouncer) ;
--   • co-hôte club : le propriétaire et ses managers.

CREATE OR REPLACE FUNCTION public.is_event_door_staff(_user_id uuid, _event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.events e
     WHERE e.id = _event_id
       AND (
         EXISTS (
           SELECT 1 FROM public.org_members om
            WHERE om.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
              AND om.member_user_id = _user_id
              AND om.invitation_status = 'accepted'
              AND om.role IN ('admin', 'editor', 'scanner')
         )
         OR EXISTS (
           SELECT 1 FROM public.org_staff os
            WHERE os.organizer_user_id IN (e.organizer_user_id, e.partner_organizer_id)
              AND os.user_id = _user_id
              AND os.invitation_status = 'accepted'
              AND os.role = 'bouncer'
         )
         -- Co-hôtes ÉDITEURS acceptés de cette soirée.
         OR EXISTS (
           SELECT 1 FROM public.event_cohosts c
            WHERE c.event_id = e.id
              AND c.status = 'accepted'
              AND c.access = 'editor'
              AND (
                (c.organizer_user_id IS NOT NULL AND (
                   c.organizer_user_id = _user_id
                   OR EXISTS (SELECT 1 FROM public.org_members om2
                               WHERE om2.organizer_user_id = c.organizer_user_id
                                 AND om2.member_user_id = _user_id
                                 AND om2.invitation_status = 'accepted'
                                 AND om2.role IN ('admin', 'editor', 'scanner'))
                   OR EXISTS (SELECT 1 FROM public.org_staff os2
                               WHERE os2.organizer_user_id = c.organizer_user_id
                                 AND os2.user_id = _user_id
                                 AND os2.invitation_status = 'accepted'
                                 AND os2.role = 'bouncer')))
                OR (c.venue_id IS NOT NULL AND (
                   EXISTS (SELECT 1 FROM public.venues v WHERE v.id = c.venue_id AND v.owner_id = _user_id)
                   OR public.can_manage_venue(_user_id, c.venue_id)))
              )
         )
       )
  )
$function$;
