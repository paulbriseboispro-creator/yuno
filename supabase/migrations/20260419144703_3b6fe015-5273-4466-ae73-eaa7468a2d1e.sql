-- Allow organizers to upload/manage their own event images & posters
-- Path convention: {auth.uid()}/...

CREATE POLICY "Organizers upload own event images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND has_role(auth.uid(), 'organizer'::app_role)
);

CREATE POLICY "Organizers update own event images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND has_role(auth.uid(), 'organizer'::app_role)
);

CREATE POLICY "Organizers delete own event images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'event-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND has_role(auth.uid(), 'organizer'::app_role)
);

-- Ensure event-posters bucket exists & public read
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-posters', 'event-posters', true)
ON CONFLICT (id) DO UPDATE SET public = true;