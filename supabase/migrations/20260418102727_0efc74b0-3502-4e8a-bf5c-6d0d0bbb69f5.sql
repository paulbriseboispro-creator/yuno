
-- Allow standalone organizers to view tickets of their own events
DO $$ BEGIN
  CREATE POLICY "Organizers view their event tickets"
    ON public.tickets
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = tickets.event_id
          AND e.organizer_user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Allow standalone organizers to update entry scan fields on their tickets
DO $$ BEGIN
  CREATE POLICY "Organizers scan their event tickets"
    ON public.tickets
    FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = tickets.event_id
          AND e.organizer_user_id = auth.uid()
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = tickets.event_id
          AND e.organizer_user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
