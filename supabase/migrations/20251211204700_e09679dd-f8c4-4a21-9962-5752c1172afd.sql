-- Add owner_id to venues table to link venues with their owner
ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id);

-- Create function to get user's venue_id from profiles
CREATE OR REPLACE FUNCTION public.get_user_venue_id(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT venue_id FROM public.profiles WHERE id = _user_id
$$;

-- Create function to check if user is owner of a venue
CREATE OR REPLACE FUNCTION public.is_venue_owner(_user_id uuid, _venue_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.venues 
    WHERE id = _venue_id 
    AND owner_id = _user_id
  )
$$;

-- Update drinks RLS: owners can only manage their venue's drinks
DROP POLICY IF EXISTS "Owners can insert drinks" ON public.drinks;
DROP POLICY IF EXISTS "Owners can update drinks" ON public.drinks;
DROP POLICY IF EXISTS "Owners can delete drinks" ON public.drinks;

CREATE POLICY "Owners can insert drinks for their venue"
ON public.drinks FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'owner'::app_role) 
  AND is_venue_owner(auth.uid(), venue_id)
);

CREATE POLICY "Owners can update drinks for their venue"
ON public.drinks FOR UPDATE
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND is_venue_owner(auth.uid(), venue_id)
);

CREATE POLICY "Owners can delete drinks for their venue"
ON public.drinks FOR DELETE
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND is_venue_owner(auth.uid(), venue_id)
);

-- Update events RLS: owners can only manage their venue's events
DROP POLICY IF EXISTS "Owners can view all events" ON public.events;
DROP POLICY IF EXISTS "Owners can create events" ON public.events;
DROP POLICY IF EXISTS "Owners can update events" ON public.events;
DROP POLICY IF EXISTS "Owners can delete events" ON public.events;
DROP POLICY IF EXISTS "Barmen can view all events" ON public.events;

CREATE POLICY "Owners can view their venue events"
ON public.events FOR SELECT
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND is_venue_owner(auth.uid(), venue_id)
);

CREATE POLICY "Owners can create events for their venue"
ON public.events FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'owner'::app_role) 
  AND is_venue_owner(auth.uid(), venue_id)
);

CREATE POLICY "Owners can update their venue events"
ON public.events FOR UPDATE
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND is_venue_owner(auth.uid(), venue_id)
);

CREATE POLICY "Owners can delete their venue events"
ON public.events FOR DELETE
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND is_venue_owner(auth.uid(), venue_id)
);

CREATE POLICY "Barmen can view their venue events"
ON public.events FOR SELECT
USING (
  has_role(auth.uid(), 'barman'::app_role) 
  AND venue_id = get_user_venue_id(auth.uid())
);

-- Update orders RLS: filter by venue
DROP POLICY IF EXISTS "Barmen can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Barmen can update orders" ON public.orders;
DROP POLICY IF EXISTS "Owners can view all orders" ON public.orders;

CREATE POLICY "Barmen can view their venue orders"
ON public.orders FOR SELECT
USING (
  has_role(auth.uid(), 'barman'::app_role) 
  AND venue_id = get_user_venue_id(auth.uid())
);

CREATE POLICY "Barmen can update their venue orders"
ON public.orders FOR UPDATE
USING (
  has_role(auth.uid(), 'barman'::app_role) 
  AND venue_id = get_user_venue_id(auth.uid())
);

CREATE POLICY "Owners can view their venue orders"
ON public.orders FOR SELECT
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND is_venue_owner(auth.uid(), venue_id)
);

CREATE POLICY "Owners can update their venue orders"
ON public.orders FOR UPDATE
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND is_venue_owner(auth.uid(), venue_id)
);

-- Update visitor_sessions RLS
DROP POLICY IF EXISTS "Owners can view visitor sessions" ON public.visitor_sessions;

CREATE POLICY "Owners can view their venue visitor sessions"
ON public.visitor_sessions FOR SELECT
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND is_venue_owner(auth.uid(), venue_id)
);

CREATE POLICY "Barmen can view their venue visitor sessions"
ON public.visitor_sessions FOR SELECT
USING (
  has_role(auth.uid(), 'barman'::app_role) 
  AND venue_id = get_user_venue_id(auth.uid())
);

-- Update venues RLS: owners can only update their own venue
DROP POLICY IF EXISTS "Owners can update venues" ON public.venues;

CREATE POLICY "Owners can update their own venue"
ON public.venues FOR UPDATE
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND owner_id = auth.uid()
)
WITH CHECK (
  has_role(auth.uid(), 'owner'::app_role) 
  AND owner_id = auth.uid()
);

-- Update profiles RLS: owners can only view/update profiles in their venue
DROP POLICY IF EXISTS "Owners can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Owners can update all profiles" ON public.profiles;

CREATE POLICY "Owners can view their venue profiles"
ON public.profiles FOR SELECT
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND (
    venue_id IN (SELECT id FROM venues WHERE owner_id = auth.uid())
    OR id = auth.uid()
  )
);

CREATE POLICY "Owners can update their venue profiles"
ON public.profiles FOR UPDATE
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND venue_id IN (SELECT id FROM venues WHERE owner_id = auth.uid())
);

-- Update user_roles RLS: owners can only see roles for their venue's staff
DROP POLICY IF EXISTS "Owners can view all user roles" ON public.user_roles;

CREATE POLICY "Owners can view their venue user roles"
ON public.user_roles FOR SELECT
USING (
  has_role(auth.uid(), 'owner'::app_role) 
  AND user_id IN (
    SELECT id FROM profiles 
    WHERE venue_id IN (SELECT id FROM venues WHERE owner_id = auth.uid())
  )
);