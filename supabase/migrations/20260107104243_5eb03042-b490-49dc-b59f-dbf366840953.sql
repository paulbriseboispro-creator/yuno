-- Allow owners to search profiles by email to add promoters
CREATE POLICY "Owners can search profiles by email"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'owner'::app_role)
);