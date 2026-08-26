-- ============================================================================
-- Comptes vitrine (prospection) — marqueur du compte fantôme.
--
-- Un « compte vitrine » est une venue cachée (is_hidden=true) construite par le
-- super admin AVANT que le club soit client, possédée par un user jetable (le
-- « fantôme », email contrôlé par Yuno). Le prospect la découvre via un lien de
-- preview privé (demo_preview_links.venue_id), puis la réclame : le transfert
-- d'ownership déclenche le handoff (20260826102000) qui nettoie le fantôme.
--
-- showcase_shadow_owner_id est LA source de vérité « cette venue est une
-- vitrine » : posé à la création du fantôme, remis à NULL en fin de handoff.
-- Le redeem du lien preview résout le compte à minter par CE marqueur, jamais
-- par owner_id — un lien qui survivrait à la réclamation ne peut donc jamais
-- ouvrir la session du vrai propriétaire.
--
-- Fuite résiduelle assumée (pré-existante, hors périmètre) : un SELECT direct
-- sur venues avec un id deviné révèle l'existence d'un club caché (policy
-- SELECT USING(true) + GRANT colonne is_hidden). Le gate 404 de VenuePage et
-- resolve_venue_slug (durci en 20260826104000) restent les portes réelles.
-- ============================================================================

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS showcase_shadow_owner_id uuid NULL
    REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.venues.showcase_shadow_owner_id IS
  'Compte fantôme d''un compte vitrine de prospection. Non NULL = venue vitrine '
  'en attente de réclamation ; remis à NULL par handoff_showcase_venue.';
