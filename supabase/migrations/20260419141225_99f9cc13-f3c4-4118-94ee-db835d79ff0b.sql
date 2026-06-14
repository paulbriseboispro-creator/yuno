-- Allow organizers to manage waitlist on their own events
CREATE POLICY "Organizers can manage their event waitlist"
ON public.event_waitlist
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_waitlist.event_id
      AND e.organizer_user_id = auth.uid()
      AND e.venue_id IS NULL
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_waitlist.event_id
      AND e.organizer_user_id = auth.uid()
      AND e.venue_id IS NULL
  )
);