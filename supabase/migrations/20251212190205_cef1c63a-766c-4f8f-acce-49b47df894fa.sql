-- Drop existing owner policy
DROP POLICY IF EXISTS "Owners can manage their venue ticket rounds" ON public.ticket_rounds;

-- Create updated policy that also checks profiles.venue_id
CREATE POLICY "Owners can manage their venue ticket rounds" 
ON public.ticket_rounds 
FOR ALL 
USING (
  has_role(auth.uid(), 'owner'::app_role) AND (
    EXISTS (
      SELECT 1 FROM events e
      JOIN venues v ON e.venue_id = v.id
      WHERE e.id = ticket_rounds.event_id AND v.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM events e
      JOIN profiles p ON p.venue_id = e.venue_id
      WHERE e.id = ticket_rounds.event_id AND p.id = auth.uid()
    )
  )
)
WITH CHECK (
  has_role(auth.uid(), 'owner'::app_role) AND (
    EXISTS (
      SELECT 1 FROM events e
      JOIN venues v ON e.venue_id = v.id
      WHERE e.id = ticket_rounds.event_id AND v.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM events e
      JOIN profiles p ON p.venue_id = e.venue_id
      WHERE e.id = ticket_rounds.event_id AND p.id = auth.uid()
    )
  )
);