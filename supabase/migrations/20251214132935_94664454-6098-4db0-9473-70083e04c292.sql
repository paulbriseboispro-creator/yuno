-- Add customer information columns to tickets table
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS full_name text,
ADD COLUMN IF NOT EXISTS phone text,
ADD COLUMN IF NOT EXISTS newsletter_opt_in boolean DEFAULT false;