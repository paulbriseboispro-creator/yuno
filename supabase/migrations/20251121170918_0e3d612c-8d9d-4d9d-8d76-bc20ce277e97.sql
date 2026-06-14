-- Drop and recreate the view with SECURITY INVOKER
-- This ensures the view respects RLS policies of the querying user
DROP VIEW IF EXISTS public.user_roles_with_email;

CREATE VIEW public.user_roles_with_email
WITH (security_invoker=on)
AS
SELECT 
  ur.id,
  ur.user_id,
  ur.role,
  ur.created_at,
  p.email,
  p.first_name,
  p.last_name
FROM public.user_roles ur
LEFT JOIN public.profiles p ON ur.user_id = p.id;