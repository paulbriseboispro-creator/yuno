-- Vidéo verticale (9:16) de la page soirée.
--
-- Un club ou un organisateur peut joindre à sa soirée une courte vidéo
-- portrait, en plus de l'affiche. Elle ne se lit QUE sur la page de la
-- soirée (héros), en boucle, sans son, en autoplay ; partout ailleurs
-- (Explore, cartes, emails, passes Wallet, partages) l'affiche reste le
-- seul visuel. Le bucket est dédié : plafond 30 Mo et types vidéo seuls,
-- pour ne jamais alourdir le bucket des affiches.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS video_url text;

COMMENT ON COLUMN public.events.video_url IS
  'Vidéo portrait 9:16 lue en boucle, muette, sur la page de la soirée uniquement. NULL = affiche seule.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-videos', 'event-videos', true,
  31457280,
  ARRAY['video/mp4', 'video/quicktime', 'video/webm']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 31457280,
      allowed_mime_types = ARRAY['video/mp4', 'video/quicktime', 'video/webm'];

-- Lecture publique (la page soirée est publique).
DROP POLICY IF EXISTS "Public read event videos" ON storage.objects;
CREATE POLICY "Public read event videos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-videos');

-- Écriture : chaque compte connecté dans SON dossier (owner, manager, organisateur).
DROP POLICY IF EXISTS "Users upload own event videos" ON storage.objects;
CREATE POLICY "Users upload own event videos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'event-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users update own event videos" ON storage.objects;
CREATE POLICY "Users update own event videos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'event-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own event videos" ON storage.objects;
CREATE POLICY "Users delete own event videos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'event-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
