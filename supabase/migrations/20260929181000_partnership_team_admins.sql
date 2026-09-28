-- Partenariats club × organisation : un ADMIN d'équipe agit pour l'organisation,
-- comme dans le contrat collab (collab_org_can_act, 20260929180000). Sans ça,
-- l'admin ouvrait « Proposer une soirée » sur une liste de clubs partenaires
-- vide (la lecture était réservée au fondateur) et ne pouvait pas demander de
-- partenariat. Un éditeur ou un scanner n'y a toujours pas accès.

CREATE OR REPLACE FUNCTION public.can_access_partnership(_user_id uuid, _venue_id text, _organizer_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.is_venue_owner(_user_id, _venue_id)
    OR _organizer_user_id = _user_id
    OR public.is_org_team_member(_user_id, _organizer_user_id, 'admin')
    OR public.is_super_admin();
$function$;

DROP POLICY IF EXISTS "Parties can initiate partnership" ON public.venue_organizer_partnerships;
CREATE POLICY "Parties can initiate partnership" ON public.venue_organizer_partnerships
  FOR INSERT TO authenticated
  WITH CHECK (
    (initiated_by = 'venue'::partnership_initiator AND public.is_venue_owner(auth.uid(), venue_id))
    OR (initiated_by = 'organizer'::partnership_initiator
        AND (organizer_user_id = auth.uid()
             OR public.is_org_team_member(auth.uid(), organizer_user_id, 'admin')))
  );
