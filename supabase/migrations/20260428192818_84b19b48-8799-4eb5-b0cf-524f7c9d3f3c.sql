CREATE POLICY "Public can view event-scoped floor plans for active events"
ON public.venue_floor_plans
FOR SELECT
USING (
  event_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = venue_floor_plans.event_id
      AND e.is_active = true
      AND COALESCE(e.visibility, 'public') = 'public'
  )
);