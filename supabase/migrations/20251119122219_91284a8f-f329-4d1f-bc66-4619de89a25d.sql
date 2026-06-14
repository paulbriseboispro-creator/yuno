-- Ensure the trigger exists to assign 'client' role by default to new users
DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;

CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW 
  EXECUTE FUNCTION public.handle_new_user_role();

-- Add a unique constraint to prevent duplicate role assignments
ALTER TABLE public.user_roles 
  DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;

ALTER TABLE public.user_roles 
  ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);