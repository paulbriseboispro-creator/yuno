-- Allow owners to update tickets for their venue events (entry scanning and drink redemption)
CREATE POLICY "Owners can update tickets for their venue"
ON public.tickets
FOR UPDATE
USING (
  has_role(auth.uid(), 'owner'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.venues v ON e.venue_id = v.id
    WHERE e.id = tickets.event_id
      AND v.owner_id = auth.uid()
  )
);