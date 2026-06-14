-- Update is_super_admin function to include both admin emails
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.jwt() ->> 'email' IN ('antoine.music@outlook.fr', 'paul.brisebois@free.fr')
$$;