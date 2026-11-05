-- Galeries photo (club et organisateur) : chaque photo passe par un recadrage
-- 4:3, et le pro peut le reprendre plus tard (crayon sur la photo).
--
-- gallery_images reste la vérité affichée : les photos RECADRÉES, dans l'ordre.
-- gallery_crops garde, par photo recadrée, de quoi rouvrir l'éditeur sur
-- l'image d'origine avec le même cadre :
--   { "<url recadrée>": { "src": "<url d'origine>", "x": 0.1, "y": -0.05, "zoom": 1.4 } }
-- x / y = décalage du centre de l'image en fraction du cadre, zoom ≥ 1 par
-- rapport au remplissage du cadre (src/lib/galleryCrop.ts). Une photo sans
-- entrée (ajoutée avant ce système) se recadre à partir d'elle-même.
--
-- Lu seulement par l'éditeur de la Console (authenticated) ; la page publique
-- ne lit que gallery_images. venues et organizer_profiles accordent SELECT
-- colonne par colonne : une colonne ajoutée doit être GRANT explicitement.
-- L'UPDATE est accordé au niveau de la table (RLS : owner / manager, fondateur).

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS gallery_crops jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS gallery_crops jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.venues DROP CONSTRAINT IF EXISTS venues_gallery_crops_chk;
ALTER TABLE public.venues
  ADD CONSTRAINT venues_gallery_crops_chk CHECK (jsonb_typeof(gallery_crops) = 'object');
ALTER TABLE public.organizer_profiles DROP CONSTRAINT IF EXISTS organizer_profiles_gallery_crops_chk;
ALTER TABLE public.organizer_profiles
  ADD CONSTRAINT organizer_profiles_gallery_crops_chk CHECK (jsonb_typeof(gallery_crops) = 'object');

GRANT SELECT (gallery_crops) ON public.venues TO authenticated;
GRANT SELECT (gallery_crops) ON public.organizer_profiles TO authenticated;

NOTIFY pgrst, 'reload schema';
