-- Add poster_url column to events for portrait event poster/flyer
ALTER TABLE public.events 
ADD COLUMN poster_url TEXT;