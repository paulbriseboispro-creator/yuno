-- Add poster_position column to events table to store crop position data
ALTER TABLE public.events 
ADD COLUMN IF NOT EXISTS poster_position jsonb DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.events.poster_position IS 'Stores poster crop position data: {x, y, scale} for proper display';