-- Add GPS coordinates to venues table
ALTER TABLE public.venues
ADD COLUMN latitude NUMERIC,
ADD COLUMN longitude NUMERIC;

-- Add comment for documentation
COMMENT ON COLUMN public.venues.latitude IS 'GPS latitude coordinate for map display';
COMMENT ON COLUMN public.venues.longitude IS 'GPS longitude coordinate for map display';