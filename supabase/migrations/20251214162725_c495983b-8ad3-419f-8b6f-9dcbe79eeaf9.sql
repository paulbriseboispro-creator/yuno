-- Allow bouncers to view VIP table reservations for events at their venue
CREATE POLICY "Bouncers can view reservations for their venue"
ON public.table_reservations
FOR SELECT
USING (
  has_role(auth.uid(), 'bouncer'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = table_reservations.event_id
      AND e.venue_id = get_user_venue_id(auth.uid())
  )
);
