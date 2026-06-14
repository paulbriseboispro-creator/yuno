-- Add music_genres array column alongside existing music_genre
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS music_genres text[] DEFAULT ARRAY['Open Format']::text[];

-- Migrate existing data from music_genre to music_genres
UPDATE public.events SET music_genres = ARRAY[music_genre] WHERE music_genre IS NOT NULL AND music_genre != '' AND (music_genres IS NULL OR music_genres = ARRAY['Open Format']::text[]);