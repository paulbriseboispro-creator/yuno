-- Plan de salle event-scopé : visible aussi pour une soirée « non listée ».
-- Une soirée unlisted se réserve par lien direct ; sa page et son checkout
-- chargent le plan interactif comme une soirée publique. La policy ne
-- laissait passer que visibility = 'public' : le client voyait le pack mais
-- jamais le plan pour choisir sa table. Les soirées privées restent fermées.
DROP POLICY IF EXISTS "Public can view event-scoped floor plans for active events" ON public.venue_floor_plans;
CREATE POLICY "Public can view event-scoped floor plans for active events"
  ON public.venue_floor_plans FOR SELECT
  USING (
    event_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = venue_floor_plans.event_id
        AND e.is_active = true
        AND COALESCE(e.visibility, 'public'::event_visibility) IN ('public'::event_visibility, 'unlisted'::event_visibility)
    )
  );
