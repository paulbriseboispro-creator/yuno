-- Add logo_url to venues table
ALTER TABLE public.venues 
ADD COLUMN IF NOT EXISTS logo_url text;

-- Create storage bucket for drink images
INSERT INTO storage.buckets (id, name, public)
VALUES ('drink-images', 'drink-images', true)
ON CONFLICT (id) DO NOTHING;

-- Create storage bucket for venue assets (logos and covers)
INSERT INTO storage.buckets (id, name, public)
VALUES ('venue-assets', 'venue-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Policies for drink images
CREATE POLICY "Drink images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'drink-images');

CREATE POLICY "Owners can upload drink images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'drink-images' 
  AND has_role(auth.uid(), 'owner'::app_role)
);

CREATE POLICY "Owners can update drink images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'drink-images' 
  AND has_role(auth.uid(), 'owner'::app_role)
);

CREATE POLICY "Owners can delete drink images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'drink-images' 
  AND has_role(auth.uid(), 'owner'::app_role)
);

-- Policies for venue assets
CREATE POLICY "Venue assets are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'venue-assets');

CREATE POLICY "Owners can upload venue assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'venue-assets' 
  AND has_role(auth.uid(), 'owner'::app_role)
);

CREATE POLICY "Owners can update venue assets"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'venue-assets' 
  AND has_role(auth.uid(), 'owner'::app_role)
);

CREATE POLICY "Owners can delete venue assets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'venue-assets' 
  AND has_role(auth.uid(), 'owner'::app_role)
);