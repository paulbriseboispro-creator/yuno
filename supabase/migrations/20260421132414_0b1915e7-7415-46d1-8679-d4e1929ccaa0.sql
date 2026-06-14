-- Allow all event managers (lead venue, partner venue, lead organizer, partner organizer)
-- to manage ticket rounds for events they have rights on.
-- Mirrors the pattern used for table_zones/table_packs (Event-scoped manageable by event managers).
CREATE POLICY "Ticket rounds manageable by event managers"
ON public.ticket_rounds
FOR ALL
USING (public.can_manage_event_tables(auth.uid(), event_id))
WITH CHECK (public.can_manage_event_tables(auth.uid(), event_id));

-- Same for ticket_presets event-scoped (organizer_user_id null + venue_id check is current limit;
-- partner venues should be able to read venue's presets and presets shared by lead orga).
-- We grant read to partner venue too.
CREATE POLICY "Ticket presets visible to event partners"
ON public.ticket_presets
FOR SELECT
USING (
  (venue_id IS NOT NULL AND public.is_venue_owner(auth.uid(), venue_id))
  OR (organizer_user_id IS NOT NULL AND organizer_user_id = auth.uid())
);