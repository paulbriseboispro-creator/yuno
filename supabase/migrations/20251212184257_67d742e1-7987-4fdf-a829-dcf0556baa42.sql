-- Relax RLS for owners creating events to also allow owners linked via profiles.venue_id
DROP POLICY IF EXISTS "Owners can create events for their venue" ON public.events;

CREATE POLICY "Owners can create events for their venue"
ON public.events
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'owner'::app_role)
  AND (
    is_venue_owner(auth.uid(), venue_id)
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.venue_id = public.events.venue_id
    )
  )
);