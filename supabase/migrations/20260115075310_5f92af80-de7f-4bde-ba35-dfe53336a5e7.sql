-- Update is_super_admin function to check role instead of hardcoded email
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
    AND role = 'admin'::app_role
  )
  OR auth.jwt() ->> 'email' = 'owner@womber.fr';
$$;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Admins can upload drink images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update drink images" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete drink images" ON storage.objects;

-- Create storage policy for drink-images bucket uploads (for admins)
CREATE POLICY "Admins can upload drink images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'drink-images' 
  AND public.is_super_admin()
);

-- Create storage policy for drink-images bucket updates (for admins)
CREATE POLICY "Admins can update drink images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'drink-images' 
  AND public.is_super_admin()
);

-- Create storage policy for drink-images bucket deletes (for admins)
CREATE POLICY "Admins can delete drink images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'drink-images' 
  AND public.is_super_admin()
);