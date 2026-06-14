-- Lot C: Allow promoters to read their own guest list entries via promoter_id
DROP POLICY IF EXISTS "Users can view own entries or owners can view all" ON public.guest_list_entries;

CREATE POLICY "Users promoters owners can view entries"
ON public.guest_list_entries FOR SELECT
USING (
  (user_id = auth.uid())
  OR (promoter_id IN (SELECT id FROM public.promoters WHERE user_id = auth.uid()))
  OR (EXISTS (
    SELECT 1 FROM guest_lists gl
    WHERE gl.id = guest_list_entries.guest_list_id
    AND (is_venue_owner(auth.uid(), gl.venue_id)
      OR can_manage_venue(auth.uid(), gl.venue_id)
      OR is_venue_staff(auth.uid(), gl.venue_id))
  ))
);