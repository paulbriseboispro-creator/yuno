-- Add venue_id and employee_pin to profiles table
ALTER TABLE public.profiles 
ADD COLUMN venue_id TEXT REFERENCES public.venues(id),
ADD COLUMN employee_pin TEXT;

-- Create index for faster PIN lookups
CREATE INDEX idx_profiles_employee_pin ON public.profiles(employee_pin) WHERE employee_pin IS NOT NULL;

-- Update RLS policies for profiles to include venue-based access
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can view their own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = id);

CREATE POLICY "Owners can view staff profiles" 
ON public.profiles 
FOR SELECT 
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND venue_id IN (
    SELECT venue_id 
    FROM public.profiles 
    WHERE id = auth.uid()
  )
);

CREATE POLICY "Owners can manage staff" 
ON public.profiles 
FOR ALL
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND venue_id IN (
    SELECT venue_id 
    FROM public.profiles 
    WHERE id = auth.uid()
  )
);