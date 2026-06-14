-- =====================================================================
-- Security Fix: Restrict access to profiles and venue_customers tables
-- =====================================================================

-- First, check if there's an existing "profiles_public" view and drop it if not secure
DROP VIEW IF EXISTS public.profiles_public CASCADE;

-- Create a safe public view for profiles that only exposes non-sensitive data
CREATE VIEW public.profiles_public 
WITH (security_invoker = on) AS
SELECT 
  id,
  first_name,
  last_name,
  avatar_url,
  city,
  created_at
FROM public.profiles;

-- Grant SELECT on the view to authenticated users
GRANT SELECT ON public.profiles_public TO authenticated;

-- =====================================================================
-- Fix profiles table RLS policies
-- =====================================================================

-- Drop any existing overly permissive policies (if they exist)
DROP POLICY IF EXISTS "Owners can search profiles by email" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

-- Keep existing policies:
-- "Users can view their own profile" - SELECT USING (auth.uid() = id)
-- "Users can update their own profile" - UPDATE USING (auth.uid() = id)

-- Add policy for super admins to manage all profiles
DROP POLICY IF EXISTS "Super admins can view all profiles" ON public.profiles;
CREATE POLICY "Super admins can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (is_super_admin());

-- Add policy for venue owners/staff to view profiles of users associated with their venue
DROP POLICY IF EXISTS "Venue staff can view assigned user profiles" ON public.profiles;
CREATE POLICY "Venue staff can view assigned user profiles"
  ON public.profiles
  FOR SELECT
  USING (
    -- Staff can view profiles of users assigned to their venue
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.venue_id IS NOT NULL
      AND p.venue_id = profiles.venue_id
    )
  );

-- Add policy for venue owners to view profiles of their venue customers
DROP POLICY IF EXISTS "Venue owners can view customer profiles" ON public.profiles;
CREATE POLICY "Venue owners can view customer profiles"
  ON public.profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.venue_customers vc
      JOIN public.venues v ON v.id = vc.venue_id
      WHERE vc.user_id = profiles.id
      AND v.owner_id = auth.uid()
    )
  );

-- =====================================================================
-- Fix venue_customers table RLS policies
-- =====================================================================

-- Enable RLS if not already enabled
ALTER TABLE public.venue_customers ENABLE ROW LEVEL SECURITY;

-- Drop any overly permissive policies
DROP POLICY IF EXISTS "Anyone can view venue_customers" ON public.venue_customers;
DROP POLICY IF EXISTS "Public can view venue_customers" ON public.venue_customers;
DROP POLICY IF EXISTS "Authenticated can view venue_customers" ON public.venue_customers;

-- Users can view their own customer records
DROP POLICY IF EXISTS "Users can view their own venue customer records" ON public.venue_customers;
CREATE POLICY "Users can view their own venue customer records"
  ON public.venue_customers
  FOR SELECT
  USING (user_id = auth.uid());

-- Venue owners can view their venue's customers
DROP POLICY IF EXISTS "Venue owners can view their customers" ON public.venue_customers;
CREATE POLICY "Venue owners can view their customers"
  ON public.venue_customers
  FOR SELECT
  USING (is_venue_owner(auth.uid(), venue_id));

-- Venue owners can manage their venue's customers
DROP POLICY IF EXISTS "Venue owners can manage their customers" ON public.venue_customers;
CREATE POLICY "Venue owners can manage their customers"
  ON public.venue_customers
  FOR ALL
  USING (is_venue_owner(auth.uid(), venue_id))
  WITH CHECK (is_venue_owner(auth.uid(), venue_id));

-- Managers with customer permission can view customers
DROP POLICY IF EXISTS "Managers can view customers" ON public.venue_customers;
CREATE POLICY "Managers can view customers"
  ON public.venue_customers
  FOR SELECT
  USING (can_manage_venue(auth.uid(), venue_id));

-- Managers can update customer records
DROP POLICY IF EXISTS "Managers can update customers" ON public.venue_customers;
CREATE POLICY "Managers can update customers"
  ON public.venue_customers
  FOR UPDATE
  USING (can_manage_venue(auth.uid(), venue_id))
  WITH CHECK (can_manage_venue(auth.uid(), venue_id));

-- Staff (barmen, bouncers, VIP hosts) can view customers for their venue
DROP POLICY IF EXISTS "Staff can view venue customers" ON public.venue_customers;
CREATE POLICY "Staff can view venue customers"
  ON public.venue_customers
  FOR SELECT
  USING (
    venue_id = get_user_venue_id(auth.uid())
    AND (
      has_role(auth.uid(), 'barman'::app_role)
      OR has_role(auth.uid(), 'bouncer'::app_role)
      OR has_role(auth.uid(), 'vip_host'::app_role)
    )
  );

-- Super admins can manage all customers
DROP POLICY IF EXISTS "Super admins can manage all venue customers" ON public.venue_customers;
CREATE POLICY "Super admins can manage all venue customers"
  ON public.venue_customers
  FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Service role needs INSERT access for edge functions (payment verification, etc.)
DROP POLICY IF EXISTS "Service role can manage venue customers" ON public.venue_customers;
CREATE POLICY "Service role can manage venue customers"
  ON public.venue_customers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);