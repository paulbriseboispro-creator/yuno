-- Le plan d'une soirée PRIVÉE (accessible par lien) doit être lisible par ses
-- visiteurs, comme ses zones et ses packs (`table_zones` : true, `table_packs` :
-- is_active). La policy ne connaissait que public / unlisted : sur une soirée
-- privée, la page rendait les formules mais jamais le plan (RLS silencieuse).
DROP POLICY IF EXISTS "Public can view event-scoped floor plans for active events" ON public.venue_floor_plans;
CREATE POLICY "Public can view event-scoped floor plans for active events"
  ON public.venue_floor_plans FOR SELECT
  USING (
    event_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.events e
       WHERE e.id = venue_floor_plans.event_id
         AND e.is_active = true
    )
  );
