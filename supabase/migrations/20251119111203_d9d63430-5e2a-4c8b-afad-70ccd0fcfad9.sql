-- Create trigger to automatically assign 'client' role to new users
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Assign 'client' role by default to new users
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'client')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();

-- Update orders RLS policies
DROP POLICY IF EXISTS "Barmen can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Barmen can update orders" ON public.orders;

CREATE POLICY "Barmen can view all orders"
ON public.orders
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'barman'::app_role) OR public.has_role(auth.uid(), 'owner'::app_role));

CREATE POLICY "Barmen can update orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'barman'::app_role) OR public.has_role(auth.uid(), 'owner'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'barman'::app_role) OR public.has_role(auth.uid(), 'owner'::app_role));

-- Owners can view all orders
CREATE POLICY "Owners can view all orders"
ON public.orders
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'owner'::app_role));

-- Update drinks RLS policies
DROP POLICY IF EXISTS "Owners can insert drinks" ON public.drinks;
DROP POLICY IF EXISTS "Owners can update drinks" ON public.drinks;
DROP POLICY IF EXISTS "Owners can delete drinks" ON public.drinks;

CREATE POLICY "Owners can insert drinks"
ON public.drinks
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'owner'::app_role));

CREATE POLICY "Owners can update drinks"
ON public.drinks
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'owner'::app_role));

CREATE POLICY "Owners can delete drinks"
ON public.drinks
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'owner'::app_role));