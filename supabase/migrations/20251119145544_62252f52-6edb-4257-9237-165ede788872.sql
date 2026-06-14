-- Allow owners to update venue visuals (logo & cover)
CREATE POLICY "Owners can update venues"
ON public.venues
FOR UPDATE
USING (has_role(auth.uid(), 'owner'::app_role))
WITH CHECK (has_role(auth.uid(), 'owner'::app_role));