
INSERT INTO storage.buckets (id, name, public)
VALUES ('organization-assets', 'organization-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Organization assets are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'organization-assets');

CREATE POLICY "Organizers can upload to their own folder"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'organization-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Organizers can update their own folder"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'organization-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Organizers can delete their own folder"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'organization-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
