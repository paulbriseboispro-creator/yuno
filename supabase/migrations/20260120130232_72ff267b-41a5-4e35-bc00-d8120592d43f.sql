-- Add phone column to profiles table for auto-fill functionality
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.phone IS 'User phone number for pre-filling checkout forms';