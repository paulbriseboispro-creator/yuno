-- Fix critical security issue: Implement server-side role validation
-- Create enum for app roles
CREATE TYPE public.app_role AS ENUM ('client', 'barman', 'owner');

-- Create user_roles table with RLS
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Create security definer function to check roles
-- This prevents recursive RLS issues
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Add RLS policies to drinks table for owner-only updates
CREATE POLICY "Owners can insert drinks"
ON public.drinks
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Owners can update drinks"
ON public.drinks
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'owner'));

CREATE POLICY "Owners can delete drinks"
ON public.drinks
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'owner'));

-- Add RLS policy for barmen to view all orders
CREATE POLICY "Barmen can view all orders"
ON public.orders
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'barman'));

-- Add RLS policy for barmen to update order status (serve orders)
CREATE POLICY "Barmen can update orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'barman'))
WITH CHECK (public.has_role(auth.uid(), 'barman'));