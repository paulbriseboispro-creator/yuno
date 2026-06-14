-- Add social media and gallery columns to venues table
ALTER TABLE public.venues 
ADD COLUMN IF NOT EXISTS instagram_url text,
ADD COLUMN IF NOT EXISTS facebook_url text,
ADD COLUMN IF NOT EXISTS tiktok_url text,
ADD COLUMN IF NOT EXISTS twitter_url text,
ADD COLUMN IF NOT EXISTS gallery_images jsonb DEFAULT '[]'::jsonb;