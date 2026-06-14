-- Allow owners to insert manager roles for users they're adding to their venue
CREATE POLICY "Owners can add manager roles"
ON public.user_roles
FOR INSERT
WITH CHECK (
  role = 'manager' AND
  has_role(auth.uid(), 'owner'::app_role)
);

-- Allow owners to delete manager roles they created
CREATE POLICY "Owners can delete manager roles"
ON public.user_roles
FOR DELETE
USING (
  role = 'manager' AND
  has_role(auth.uid(), 'owner'::app_role) AND
  user_id IN (
    SELECT mp.user_id FROM manager_permissions mp
    JOIN venues v ON mp.venue_id = v.id
    WHERE v.owner_id = auth.uid()
  )
);