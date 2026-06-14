-- Allow organizers to insert/delete DJs on their own events (private or public)
DROP POLICY IF EXISTS "Organizers can insert event_djs" ON public.event_djs;
CREATE POLICY "Organizers can insert event_djs"
ON public.event_djs
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_djs.event_id
      AND (
        e.organizer_user_id = auth.uid()
        OR e.partner_organizer_id = auth.uid()
        OR public.is_org_team_member(auth.uid(), COALESCE(e.organizer_user_id, e.partner_organizer_id), 'editor')
      )
  )
);

DROP POLICY IF EXISTS "Organizers can delete event_djs" ON public.event_djs;
CREATE POLICY "Organizers can delete event_djs"
ON public.event_djs
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_djs.event_id
      AND (
        e.organizer_user_id = auth.uid()
        OR e.partner_organizer_id = auth.uid()
        OR public.is_org_team_member(auth.uid(), COALESCE(e.organizer_user_id, e.partner_organizer_id), 'editor')
      )
  )
);

DROP POLICY IF EXISTS "Organizers can update event_djs" ON public.event_djs;
CREATE POLICY "Organizers can update event_djs"
ON public.event_djs
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_djs.event_id
      AND (
        e.organizer_user_id = auth.uid()
        OR e.partner_organizer_id = auth.uid()
        OR public.is_org_team_member(auth.uid(), COALESCE(e.organizer_user_id, e.partner_organizer_id), 'editor')
      )
  )
);