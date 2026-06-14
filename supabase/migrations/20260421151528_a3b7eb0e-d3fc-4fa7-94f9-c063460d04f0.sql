CREATE POLICY "Organizers can view their event ticket attendees"
ON public.ticket_attendees
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.id = ticket_attendees.ticket_id
      AND (
        e.organizer_user_id = auth.uid()
        OR public.is_event_partner_organizer(auth.uid(), e.id)
      )
  )
);

CREATE POLICY "Organizers can update their event ticket attendees"
ON public.ticket_attendees
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.id = ticket_attendees.ticket_id
      AND (
        e.organizer_user_id = auth.uid()
        OR public.is_event_partner_organizer(auth.uid(), e.id)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.tickets t
    JOIN public.events e ON e.id = t.event_id
    WHERE t.id = ticket_attendees.ticket_id
      AND (
        e.organizer_user_id = auth.uid()
        OR public.is_event_partner_organizer(auth.uid(), e.id)
      )
  )
);

CREATE POLICY "Organizers can view their event reservations"
ON public.table_reservations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = table_reservations.event_id
      AND (
        e.organizer_user_id = auth.uid()
        OR public.is_event_partner_organizer(auth.uid(), e.id)
      )
  )
);

CREATE POLICY "Organizers can update their event reservations"
ON public.table_reservations
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = table_reservations.event_id
      AND (
        e.organizer_user_id = auth.uid()
        OR public.is_event_partner_organizer(auth.uid(), e.id)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = table_reservations.event_id
      AND (
        e.organizer_user_id = auth.uid()
        OR public.is_event_partner_organizer(auth.uid(), e.id)
      )
  )
);