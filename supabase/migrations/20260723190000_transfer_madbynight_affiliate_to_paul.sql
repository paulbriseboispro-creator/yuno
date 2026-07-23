-- ============================================================
-- Transfert du compte affilié MadByNight (Madrid) : Milo → Paul
--
-- Contexte : Milo (milodelloyecoiteux@gmail.com) gérait le compte
-- affilié Madrid. Paul (paul.brisebois.pro@gmail.com) en reprend la
-- gestion. Transfert net : Milo ne conserve aucun accès affilié.
--
--   Affilié   : 213e5471-bef8-4c2e-91e3-29c6e4d79015  « MadByNight »
--   Ancien    : 4f43f5d4-8b67-40c5-b7d6-06e398596ea9  Milo
--   Nouveau   : c29dc8a5-3e64-4bbd-a80d-3878edeee1f4  Paul (compte .pro)
--
-- NB : ne PAS confondre avec fceae0a5-d888-48f2-8c99-7c32c9559476
-- (paul.brisebois@free.fr), l'autre compte de Paul, qui portait
-- l'ancien affilié de seed « Yuno Madrid » supprimé en juin.
--
-- Tout le contenu (22 clubs, 315 events, 50 modèles récurrents, les
-- médias storage, les notifications, l'équipe) est rattaché à
-- affiliate_id et suit donc automatiquement. Seul le porteur du
-- compte change : `affiliates.user_id` est la seule colonne que les
-- policies RLS et `current_affiliate_id()` interrogent.
--
-- Margot Bessoule reste membre promoteur de MadByNight (rattachée à
-- affiliate_id, inchangée). Le nom « MadByNight » est conservé pour
-- l'instant — renommage à faire plus tard depuis le dashboard.
-- ============================================================

BEGIN;

-- Garde-fou : on refuse de transférer si l'état de départ n'est pas
-- celui attendu (compte déjà transféré, ou Paul déjà porteur d'un
-- autre affilié — `affiliates.user_id` est UNIQUE).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.affiliates
    WHERE id = '213e5471-bef8-4c2e-91e3-29c6e4d79015'
      AND user_id = '4f43f5d4-8b67-40c5-b7d6-06e398596ea9'
  ) THEN
    RAISE EXCEPTION 'MadByNight introuvable ou déjà transféré (porteur attendu : Milo)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.affiliates
    WHERE user_id = 'c29dc8a5-3e64-4bbd-a80d-3878edeee1f4'
  ) THEN
    RAISE EXCEPTION 'Paul porte déjà un compte affilié : affiliates.user_id est UNIQUE';
  END IF;
END $$;

-- 1. Transfert du compte affilié
UPDATE public.affiliates
SET
  user_id    = 'c29dc8a5-3e64-4bbd-a80d-3878edeee1f4',
  updated_at = now()
WHERE id = '213e5471-bef8-4c2e-91e3-29c6e4d79015';

-- 2. Accorder le rôle affilié à Paul
INSERT INTO public.user_roles (user_id, role)
VALUES ('c29dc8a5-3e64-4bbd-a80d-3878edeee1f4', 'affiliate')
ON CONFLICT ON CONSTRAINT user_roles_user_id_role_key DO NOTHING;

-- 3. Retirer le rôle affilié à Milo.
--    Indispensable : sans affiliates row, AffiliateRoute le classerait
--    en 'member' et il atterrirait sur un dashboard vide.
--    Son rôle 'client' est conservé — il garde un compte Yuno normal.
DELETE FROM public.user_roles
WHERE user_id = '4f43f5d4-8b67-40c5-b7d6-06e398596ea9'
  AND role    = 'affiliate';

COMMIT;
