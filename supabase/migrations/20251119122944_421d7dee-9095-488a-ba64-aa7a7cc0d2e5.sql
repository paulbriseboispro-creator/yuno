-- Create a view to see user roles with their email addresses
CREATE OR REPLACE VIEW public.user_roles_with_email AS
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

-- Grant select permission to authenticated users
GRANT SELECT ON public.user_roles_with_email TO authenticated;