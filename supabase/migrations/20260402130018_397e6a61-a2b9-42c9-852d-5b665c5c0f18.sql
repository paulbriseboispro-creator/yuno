CREATE POLICY "Public can view enabled venue floor plans"
ON public.venue_floor_plans
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.venues v
    WHERE v.id = venue_floor_plans.venue_id
      AND v.vip_placement_enabled = true
  )
);