
-- 1. Add new columns to djs table
ALTER TABLE public.djs ADD COLUMN IF NOT EXISTS cover_image_url text;
ALTER TABLE public.djs ADD COLUMN IF NOT EXISTS soundcloud_url text;
ALTER TABLE public.djs ADD COLUMN IF NOT EXISTS spotify_url text;
ALTER TABLE public.djs ADD COLUMN IF NOT EXISTS youtube_url text;
ALTER TABLE public.djs ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.djs ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.djs ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false;
ALTER TABLE public.djs ADD COLUMN IF NOT EXISTS slug text UNIQUE;
ALTER TABLE public.djs ADD COLUMN IF NOT EXISTS description text;

-- 2. Create event_djs junction table
CREATE TABLE IF NOT EXISTS public.event_djs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  dj_id uuid NOT NULL REFERENCES public.djs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, dj_id)
);

ALTER TABLE public.event_djs ENABLE ROW LEVEL SECURITY;

-- Public can read event_djs (for public DJ pages)
CREATE POLICY "Anyone can view event_djs" ON public.event_djs FOR SELECT USING (true);

-- Owners can manage event_djs for their venue's events
CREATE POLICY "Owners can insert event_djs" ON public.event_djs FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.venues v ON v.id = e.venue_id
    WHERE e.id = event_id AND v.owner_id = auth.uid()
  )
);

CREATE POLICY "Owners can delete event_djs" ON public.event_djs FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    JOIN public.venues v ON v.id = e.venue_id
    WHERE e.id = event_id AND v.owner_id = auth.uid()
  )
);

-- 3. Add dj_id to favorites table
ALTER TABLE public.favorites ADD COLUMN IF NOT EXISTS dj_id uuid REFERENCES public.djs(id);

-- 4. Generate slugs for existing DJs
UPDATE public.djs 
SET slug = LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      COALESCE(NULLIF(stage_name, ''), first_name || '-' || last_name),
      '[^a-zA-Z0-9\-]', '-', 'g'
    ),
    '-+', '-', 'g'
  )
) || '-' || SUBSTRING(id::text FROM 1 FOR 4)
WHERE slug IS NULL;

-- 5. Function to auto-generate slug on insert
CREATE OR REPLACE FUNCTION public.generate_dj_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL THEN
    NEW.slug := LOWER(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          COALESCE(NULLIF(NEW.stage_name, ''), NEW.first_name || '-' || NEW.last_name),
          '[^a-zA-Z0-9\-]', '-', 'g'
        ),
        '-+', '-', 'g'
      )
    ) || '-' || SUBSTRING(NEW.id::text FROM 1 FOR 4);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER set_dj_slug
BEFORE INSERT ON public.djs
FOR EACH ROW
EXECUTE FUNCTION public.generate_dj_slug();
