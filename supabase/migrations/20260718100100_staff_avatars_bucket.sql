-- Bucket des photos de profil pro du staff.
-- Séparé de l'avatar client : un barman peut vouloir une photo de service
-- (badge, uniforme) sans toucher à son avatar public de client Yuno.
-- Chemin imposé : {user_id}/... — les policies s'appuient dessus.

INSERT INTO storage.buckets (id, name, public)
VALUES ('staff-avatars', 'staff-avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Staff avatars are publicly readable" ON storage.objects;
CREATE POLICY "Staff avatars are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'staff-avatars');

DROP POLICY IF EXISTS "Staff can upload their own avatar" ON storage.objects;
CREATE POLICY "Staff can upload their own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'staff-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Staff can update their own avatar" ON storage.objects;
CREATE POLICY "Staff can update their own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'staff-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Staff can delete their own avatar" ON storage.objects;
CREATE POLICY "Staff can delete their own avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'staff-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
