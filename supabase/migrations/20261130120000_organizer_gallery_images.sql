-- Galerie photos du profil public d'un organisateur (/o/:slug), comme celle d'un club.
--
-- Le carrousel s'affiche en bas de la page publique, sous les soirées passées.
-- 8 photos au plus (même limite que venues.gallery_images) ; le front les dépose
-- dans le bucket public profile-photos, sous le dossier de l'organisateur.
--
-- Depuis 20260927120000, organizer_profiles n'accorde SELECT que COLONNE PAR
-- COLONNE : une colonne ajoutée sans GRANT ferait tomber toute lecture qui la
-- nomme (page publique en anonyme comprise). L'UPDATE reste accordé au niveau de
-- la table, la RLS limite l'écriture au fondateur.

ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS gallery_images text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.organizer_profiles
  DROP CONSTRAINT IF EXISTS organizer_profiles_gallery_images_chk;
ALTER TABLE public.organizer_profiles
  ADD CONSTRAINT organizer_profiles_gallery_images_chk CHECK (
    cardinality(gallery_images) <= 8
    AND array_position(gallery_images, NULL) IS NULL
  );

GRANT SELECT (gallery_images) ON public.organizer_profiles TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
