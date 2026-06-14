-- Fix security issue: Prevent public access to profiles table
-- Drop existing policy and recreate with explicit authenticated scope

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;

-- Recreate policy with explicit TO authenticated clause
-- This ensures only authenticated users can access, and only their own profile
CREATE POLICY "Users can view their own profile" 
ON public.profiles 
FOR SELECT 
TO authenticated
USING (auth.uid() = id);

-- Explicitly ensure UPDATE is also scoped to authenticated users
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Users can update their own profile" 
ON public.profiles 
FOR UPDATE 
TO authenticated
USING (auth.uid() = id);
