-- Add description and image_url to events table
ALTER TABLE public.events 
ADD COLUMN description text,
ADD COLUMN image_url text;