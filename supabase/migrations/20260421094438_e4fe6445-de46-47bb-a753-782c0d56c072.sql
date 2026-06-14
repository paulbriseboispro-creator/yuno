-- Add an explicit, dedicated INSERT policy for organizers creating their own events.
-- The existing "Organizers manage their own events" policy is FOR ALL with both qual and with_check,
-- but adding a dedicated INSERT policy removes any ambiguity and makes intent explicit.
-- Permissive policies are OR-ed, so this strictly broadens (or matches) what's already allowed.

DROP POLICY IF EXISTS "Organizers can create their own events" ON public.events;

CREATE POLICY "Organizers can create their own events"
ON public.events
FOR INSERT
TO authenticated
WITH CHECK (
  organizer_user_id = auth.uid()
  AND venue_id IS NULL  -- pure organizer-led event (private or solo public)
);

-- Also allow organizers to create co-events where they specify a partner_venue_id
DROP POLICY IF EXISTS "Organizers can create co-events with partner venue" ON public.events;

CREATE POLICY "Organizers can create co-events with partner venue"
ON public.events
FOR INSERT
TO authenticated
WITH CHECK (
  organizer_user_id = auth.uid()
  AND venue_id IS NULL
  AND partner_venue_id IS NOT NULL
);