-- ============================================================
-- AFFILIATE MEDIA STORAGE
-- Add logo_url to venues, flyer_url + slug to recurring templates,
-- create affiliate-media Storage bucket with RLS policies
-- ============================================================

-- 1. Add logo_url to affiliate_venues
ALTER TABLE affiliate_venues
  ADD COLUMN IF NOT EXISTS logo_url text;

-- 2. Add flyer_url and slug to affiliate_recurring_templates
ALTER TABLE affiliate_recurring_templates
  ADD COLUMN IF NOT EXISTS flyer_url text,
  ADD COLUMN IF NOT EXISTS slug text;

-- 3. Create the affiliate-media Storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'affiliate-media',
  'affiliate-media',
  true,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- 4. Storage policies for affiliate-media bucket

-- Public read: anyone can view affiliate media
CREATE POLICY "Public read affiliate media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'affiliate-media');

-- Authenticated affiliates can upload their own media
-- Path pattern: {affiliate_id}/{anything}
CREATE POLICY "Affiliates can upload own media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'affiliate-media'
    AND (
      EXISTS (
        SELECT 1 FROM affiliates
        WHERE user_id = auth.uid()
        AND id::text = (string_to_array(name, '/'))[1]
      )
    )
  );

-- Affiliates can update their own media
CREATE POLICY "Affiliates can update own media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'affiliate-media'
    AND (
      EXISTS (
        SELECT 1 FROM affiliates
        WHERE user_id = auth.uid()
        AND id::text = (string_to_array(name, '/'))[1]
      )
    )
  );

-- Affiliates can delete their own media
CREATE POLICY "Affiliates can delete own media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'affiliate-media'
    AND (
      EXISTS (
        SELECT 1 FROM affiliates
        WHERE user_id = auth.uid()
        AND id::text = (string_to_array(name, '/'))[1]
      )
    )
  );
