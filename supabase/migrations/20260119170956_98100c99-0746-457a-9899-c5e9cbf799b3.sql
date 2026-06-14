-- Fix profiles table: Remove overly permissive "Owners can search profiles by email" policy
-- This policy allows owners to view ALL profiles which exposes sensitive data like employee_pin

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Owners can search profiles by email" ON public.profiles;

-- The existing policies are already correct:
-- - "Users can view own profile" - restricts to auth.uid() = id
-- - "Owners can view their venue profiles" - restricts to venue_id matching owner's venues OR id = auth.uid()
-- These are sufficient for owner functionality while protecting sensitive data

-- Also, create a secure view for profile lookups that excludes sensitive fields
-- This allows email searches without exposing employee_pin, push_token, mfa fields

CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker=on) AS
SELECT 
  id,
  email,
  first_name,
  last_name,
  venue_id,
  created_at
  -- Excludes: employee_pin, push_token, mfa_enabled, mfa_enforced, mfa_verified_at, 
  -- mfa_recovery_codes, birth_date, age_verified_at, is_click_collect_manager
FROM public.profiles;