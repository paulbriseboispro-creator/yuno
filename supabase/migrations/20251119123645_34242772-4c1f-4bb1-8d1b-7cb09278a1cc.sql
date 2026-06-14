-- Add email column to user_roles so it can be used for filtering in the Cloud UI
ALTER TABLE public.user_roles
ADD COLUMN IF NOT EXISTS email text;

-- Update the trigger function so new users automatically get their email stored with their role
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Assign 'client' role by default to new users, including their email for easier admin filtering
  INSERT INTO public.user_roles (user_id, role, email)
  VALUES (NEW.id, 'client', NEW.email)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$function$;