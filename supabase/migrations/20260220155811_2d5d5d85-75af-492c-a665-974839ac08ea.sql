
ALTER TABLE public.organizers ADD COLUMN IF NOT EXISTS music_genres TEXT[];
ALTER TABLE public.organizers ADD COLUMN IF NOT EXISTS tiktok_url TEXT;
ALTER TABLE public.organizers ADD COLUMN IF NOT EXISTS soundcloud_url TEXT;
ALTER TABLE public.organizers ADD COLUMN IF NOT EXISTS spotify_url TEXT;
ALTER TABLE public.organizers ADD COLUMN IF NOT EXISTS youtube_url TEXT;
ALTER TABLE public.organizers ADD COLUMN IF NOT EXISTS bio TEXT;
