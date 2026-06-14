-- Allow Click & Collect managers to update venue mode
CREATE POLICY "Click collect managers can update venues" 
ON public.venues
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.venue_id = venues.id
      AND p.is_click_collect_manager = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.venue_id = venues.id
      AND p.is_click_collect_manager = true
  )
);
