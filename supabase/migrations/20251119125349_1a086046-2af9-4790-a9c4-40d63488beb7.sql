-- Ajouter une politique pour permettre aux owners de voir tous les user_roles
CREATE POLICY "Owners can view all user roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'owner'::app_role)
);