-- ============================================================
-- FIX: Ensure affiliate-media bucket is public
-- and storage policies are idempotent
-- ============================================================

-- 1. Upsert the bucket so it's definitely public even if it existed before
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'affiliate-media',
  'affiliate-media',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- 2. Recreate policies idempotently (drop + create)
DROP POLICY IF EXISTS "Public read affiliate media" ON storage.objects;
DROP POLICY IF EXISTS "Affiliates can upload own media" ON storage.objects;
DROP POLICY IF EXISTS "Affiliates can update own media" ON storage.objects;
DROP POLICY IF EXISTS "Affiliates can delete own media" ON storage.objects;

CREATE POLICY "Public read affiliate media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'affiliate-media');

CREATE POLICY "Affiliates can upload own media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'affiliate-media'
    AND EXISTS (
      SELECT 1 FROM affiliates
      WHERE user_id = auth.uid()
        AND id::text = (string_to_array(name, '/'))[1]
    )
  );

CREATE POLICY "Affiliates can update own media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'affiliate-media'
    AND EXISTS (
      SELECT 1 FROM affiliates
      WHERE user_id = auth.uid()
        AND id::text = (string_to_array(name, '/'))[1]
    )
  );

CREATE POLICY "Affiliates can delete own media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'affiliate-media'
    AND EXISTS (
      SELECT 1 FROM affiliates
      WHERE user_id = auth.uid()
        AND id::text = (string_to_array(name, '/'))[1]
    )
  );
