-- Co-hôtes déjà acceptés sur une soirée à venir : leurs canaux (Instagram,
-- TikTok, Newsletter, WhatsApp) n'avaient jamais été semés à leur nom
-- (le trigger d'acceptation date de 20260929270000). Rejouable.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.event_id, c.venue_id, c.organizer_user_id
      FROM public.event_cohosts c
      JOIN public.events e ON e.id = c.event_id
     WHERE c.status = 'accepted' AND e.end_at > now() AND e.cancelled_at IS NULL
  LOOP
    BEGIN
      PERFORM public.seed_event_party_tracked_links(r.event_id, r.venue_id, r.organizer_user_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'party links backfill %: %', r.event_id, SQLERRM;
    END;
  END LOOP;
END $$;
