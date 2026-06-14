-- Allow organizers to upload to venue-assets bucket (path: organizers/...)
CREATE POLICY "Organizers can upload their assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'venue-assets' AND
  (storage.foldername(name))[1] = 'organizers' AND
  EXISTS (
    SELECT 1 FROM public.organizers o
    WHERE o.user_id = auth.uid()
    AND o.id::text = (storage.foldername(name))[2]
  )
);

CREATE POLICY "Organizers can update their assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'venue-assets' AND
  (storage.foldername(name))[1] = 'organizers' AND
  EXISTS (
    SELECT 1 FROM public.organizers o
    WHERE o.user_id = auth.uid()
    AND o.id::text = (storage.foldername(name))[2]
  )
);

CREATE POLICY "Organizers can delete their assets"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'venue-assets' AND
  (storage.foldername(name))[1] = 'organizers' AND
  EXISTS (
    SELECT 1 FROM public.organizers o
    WHERE o.user_id = auth.uid()
    AND o.id::text = (storage.foldername(name))[2]
  )
);