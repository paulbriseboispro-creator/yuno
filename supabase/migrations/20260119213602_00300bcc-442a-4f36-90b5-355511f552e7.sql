-- Allow managers with tables permission to view venue-assets
DROP POLICY IF EXISTS "Managers can view venue assets" ON storage.objects;

CREATE POLICY "Managers can view venue assets"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'venue-assets'
  AND (
    -- Public access for venue assets
    true
  )
);

-- Allow managers to upload to venue-assets for their venue
DROP POLICY IF EXISTS "Managers can upload venue assets" ON storage.objects;

CREATE POLICY "Managers can upload venue assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'venue-assets'
  AND (
    public.is_venue_owner(auth.uid(), (storage.foldername(name))[1])
    OR public.manager_has_permission(auth.uid(), (storage.foldername(name))[1], 'tables')
  )
);

-- Allow managers to update venue assets
DROP POLICY IF EXISTS "Managers can update venue assets" ON storage.objects;

CREATE POLICY "Managers can update venue assets"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'venue-assets'
  AND (
    public.is_venue_owner(auth.uid(), (storage.foldername(name))[1])
    OR public.manager_has_permission(auth.uid(), (storage.foldername(name))[1], 'tables')
  )
);

-- Allow managers to delete venue assets
DROP POLICY IF EXISTS "Managers can delete venue assets" ON storage.objects;

CREATE POLICY "Managers can delete venue assets"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'venue-assets'
  AND (
    public.is_venue_owner(auth.uid(), (storage.foldername(name))[1])
    OR public.manager_has_permission(auth.uid(), (storage.foldername(name))[1], 'tables')
  )
);