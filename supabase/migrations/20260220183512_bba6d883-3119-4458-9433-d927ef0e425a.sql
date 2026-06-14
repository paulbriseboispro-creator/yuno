
-- Drop the 3 broken organizer storage policies
DROP POLICY IF EXISTS "Organizers can upload their assets" ON storage.objects;
DROP POLICY IF EXISTS "Organizers can update their assets" ON storage.objects;
DROP POLICY IF EXISTS "Organizers can delete their assets" ON storage.objects;

-- Recreate with explicit storage.objects.name reference
CREATE POLICY "Organizers can upload their assets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'venue-assets'
  AND (storage.foldername(storage.objects.name))[1] = 'organizers'
  AND EXISTS (
    SELECT 1 FROM public.organizers o
    WHERE o.user_id = auth.uid()
    AND o.id::text = (storage.foldername(storage.objects.name))[2]
  )
);

CREATE POLICY "Organizers can update their assets"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'venue-assets'
  AND (storage.foldername(storage.objects.name))[1] = 'organizers'
  AND EXISTS (
    SELECT 1 FROM public.organizers o
    WHERE o.user_id = auth.uid()
    AND o.id::text = (storage.foldername(storage.objects.name))[2]
  )
);

CREATE POLICY "Organizers can delete their assets"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'venue-assets'
  AND (storage.foldername(storage.objects.name))[1] = 'organizers'
  AND EXISTS (
    SELECT 1 FROM public.organizers o
    WHERE o.user_id = auth.uid()
    AND o.id::text = (storage.foldername(storage.objects.name))[2]
  )
);
