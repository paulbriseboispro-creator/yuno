-- Fix RLS policy that tries to access auth.users table
-- Remove the problematic user_email check that causes permission error

-- Drop the existing policy that references auth.users
DROP POLICY IF EXISTS "Users can view their own orders" ON public.orders;

-- Create simplified policy using only user_id
CREATE POLICY "Users can view their own orders"
ON public.orders
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);