-- ============================================================================
-- Bannière d'accueil de la Console (club + organisateur).
--
-- Le héros de l'accueil (/owner/dashboard, /organizer-app) affichait la
-- couverture de la PAGE PUBLIQUE, cadrée pour elle (4:3 côté organisateur) :
-- étirée dans un bandeau ~4,5:1, elle ne montrait qu'une tranche au hasard.
-- La bannière d'accueil a désormais sa propre colonne, réglée depuis l'accueil
-- (src/components/home-banner/*, src/lib/homeBanner.ts) :
--   { url, x, y, zoom, dim }  — point focal 0-100, zoom 1-2,5,
--                               voile light | medium | strong.
-- NULL = dégradé Yuno. Le front lit cette colonne dans une requête SÉPARÉE :
-- tant que cette migration n'est pas appliquée, seule la bannière manque.
--
-- Visible par la Console seulement : aucun GRANT à anon.
-- Écriture : la policy UPDATE existante de chaque table (owner du club,
-- fondateur de l'organisation) — rien de nouveau à ouvrir.
-- ============================================================================

BEGIN;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS home_banner jsonb;
ALTER TABLE public.organizer_profiles
  ADD COLUMN IF NOT EXISTS home_banner jsonb;

ALTER TABLE public.venues
  DROP CONSTRAINT IF EXISTS venues_home_banner_shape;
ALTER TABLE public.venues
  ADD CONSTRAINT venues_home_banner_shape CHECK (
    home_banner IS NULL
    OR (jsonb_typeof(home_banner) = 'object'
        AND jsonb_typeof(home_banner -> 'url') = 'string'
        AND pg_column_size(home_banner) < 4096)
  );

ALTER TABLE public.organizer_profiles
  DROP CONSTRAINT IF EXISTS organizer_profiles_home_banner_shape;
ALTER TABLE public.organizer_profiles
  ADD CONSTRAINT organizer_profiles_home_banner_shape CHECK (
    home_banner IS NULL
    OR (jsonb_typeof(home_banner) = 'object'
        AND jsonb_typeof(home_banner -> 'url') = 'string'
        AND pg_column_size(home_banner) < 4096)
  );

-- venues : SELECT accordé colonne par colonne à authenticated depuis
-- 20260823180003 — une nouvelle colonne doit être GRANTée explicitement.
GRANT SELECT (home_banner) ON public.venues TO authenticated;

COMMENT ON COLUMN public.venues.home_banner IS
  'Bannière de l''accueil de la Console club {url,x,y,zoom,dim}. Distincte de cover_url (page publique).';
COMMENT ON COLUMN public.organizer_profiles.home_banner IS
  'Bannière de l''accueil de la Console organisateur {url,x,y,zoom,dim}. Distincte de cover_url (profil public).';

COMMIT;
