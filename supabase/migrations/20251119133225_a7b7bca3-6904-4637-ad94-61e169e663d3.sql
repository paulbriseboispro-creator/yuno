-- Create storage bucket for event images
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-images', 'event-images', true)
ON CONFLICT (id) DO NOTHING;

-- Create policies for event images bucket
CREATE POLICY "Event images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'event-images');

CREATE POLICY "Owners can upload event images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'event-images' 
  AND has_role(auth.uid(), 'owner'::app_role)
);

CREATE POLICY "Owners can update event images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'event-images' 
  AND has_role(auth.uid(), 'owner'::app_role)
);

CREATE POLICY "Owners can delete event images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'event-images' 
  AND has_role(auth.uid(), 'owner'::app_role)
);