-- Drop the problematic policies that cause infinite recursion
DROP POLICY IF EXISTS "Owners can view staff profiles" ON public.profiles;
DROP POLICY IF EXISTS "Owners can manage staff" ON public.profiles;

-- Recreate simple policies without recursion
-- Users can view their own profile
CREATE POLICY "Users can view own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = id);

-- Owners can view all profiles (using the has_role function to avoid recursion)
CREATE POLICY "Owners can view all profiles" 
ON public.profiles 
FOR SELECT 
USING (has_role(auth.uid(), 'owner'::app_role));

-- Owners can update all profiles (using the has_role function to avoid recursion)
CREATE POLICY "Owners can update all profiles" 
ON public.profiles 
FOR UPDATE 
USING (has_role(auth.uid(), 'owner'::app_role));