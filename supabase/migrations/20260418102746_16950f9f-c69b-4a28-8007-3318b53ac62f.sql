
DO $$ BEGIN
  CREATE POLICY "Organizers manage their event ticket rounds"
    ON public.ticket_rounds
    FOR ALL
    USING (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = ticket_rounds.event_id
          AND e.organizer_user_id = auth.uid()
          AND e.venue_id IS NULL
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = ticket_rounds.event_id
          AND e.organizer_user_id = auth.uid()
          AND e.venue_id IS NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
