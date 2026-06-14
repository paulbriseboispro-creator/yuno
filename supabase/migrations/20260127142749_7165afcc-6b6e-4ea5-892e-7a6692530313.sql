-- Add preferred language column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS preferred_language text DEFAULT 'fr' 
CHECK (preferred_language IN ('en', 'es', 'fr'));