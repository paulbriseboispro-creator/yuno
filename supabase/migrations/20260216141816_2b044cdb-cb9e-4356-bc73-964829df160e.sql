-- Add music_genre and event_type columns to events table
ALTER TABLE public.events
ADD COLUMN music_genre text NOT NULL DEFAULT 'Open Format',
ADD COLUMN event_type text NOT NULL DEFAULT 'club';
