-- Allow bouncers to update table reservations for their venue (for entry scanning)
CREATE POLICY "Bouncers can update reservations for their venue"
ON public.table_reservations
FOR UPDATE
USING (
  has_role(auth.uid(), 'bouncer'::app_role) 
  AND EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = table_reservations.event_id 
    AND e.venue_id = get_user_venue_id(auth.uid())
  )
);

-- Also allow owners to update their venue reservations
CREATE POLICY "Owners can update reservations for their venue"
ON public.table_reservations
FOR UPDATE
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND EXISTS (
    SELECT 1 FROM events e
    JOIN venues v ON e.venue_id = v.id
    WHERE e.id = table_reservations.event_id 
    AND v.owner_id = auth.uid()
  )
);