-- Recreate user_roles_with_email view with security_invoker to enforce RLS
DROP VIEW IF EXISTS public.user_roles_with_email;

CREATE VIEW public.user_roles_with_email 
WITH (security_invoker = true) AS
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