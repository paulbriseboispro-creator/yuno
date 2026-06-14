-- Drop the unused profiles_public view that exposes customer emails without proper access control
-- This view is not referenced anywhere in the application code
DROP VIEW IF EXISTS public.profiles_public;