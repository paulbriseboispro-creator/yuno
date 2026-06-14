ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS banner_position jsonb;

COMMENT ON COLUMN public.events.banner_position IS 'Normalized banner crop position: {x,y,scale} where x/y are ratios relative to container size';