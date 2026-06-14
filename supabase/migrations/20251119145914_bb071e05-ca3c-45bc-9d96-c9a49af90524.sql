-- Add address field to venues table for Google Maps link
ALTER TABLE public.venues
ADD COLUMN IF NOT EXISTS address TEXT;