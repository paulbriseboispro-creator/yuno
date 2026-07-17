-- ============================================================================
-- Publication du linktree promoteur conditionnée à l'approbation (2026-07-17).
--
-- La page publique /promo/:slug affichait un linktree quel que soit son
-- linktree_status : un brouillon ou une page en attente de révision était
-- visible de tous, et la boucle d'approbation manager ne gatait rien.
--
-- Désormais seule une page 'approved' est lisible par le public. Le membre
-- lui-même (policy « Members read own team »), l'owner de l'affilié et les
-- managers gardent la lecture — la page leur sert d'aperçu avant publication.
--
-- Grandfathering : les linktrees DÉJÀ en ligne (slug posé, membre actif)
-- encore en 'draft' passent 'approved' en une fois — introduire le gate ne
-- doit pas dépublier des pages en production. Le manager peut repasser
-- n'importe quel membre en 'draft' depuis son dashboard pour dépublier.
-- ============================================================================

-- Helper : l'utilisateur est-il manager actif de cet affilié ?
-- SECURITY DEFINER obligatoire : une policy d'affiliate_members qui
-- sous-requête affiliate_members directement provoquerait une récursion RLS.
CREATE OR REPLACE FUNCTION public.is_affiliate_manager(_user_id uuid, _affiliate_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.affiliate_members m
    WHERE m.affiliate_id = _affiliate_id
      AND m.user_id = _user_id
      AND m.role = 'manager'
      AND m.is_active
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_affiliate_manager(uuid, uuid) TO authenticated;

-- Le dashboard manager listait l'équipe via la policy publique (les membres
-- non approuvés en disparaîtraient) : policy de lecture d'équipe dédiée.
DROP POLICY IF EXISTS "Manager reads own affiliate members" ON public.affiliate_members;
CREATE POLICY "Manager reads own affiliate members"
  ON public.affiliate_members FOR SELECT TO authenticated
  USING (public.is_affiliate_manager(auth.uid(), affiliate_id));

-- Grandfathering AVANT le resserrement : les pages actuellement publiques
-- restent publiques. Les 'pending_review' restent en attente (demande
-- explicite du membre), les brouillons sans slug restent des brouillons.
UPDATE public.affiliate_members
SET linktree_status = 'approved'
WHERE linktree_slug IS NOT NULL
  AND is_active = true
  AND linktree_status = 'draft';

-- Lecture publique : approuvé uniquement.
DROP POLICY IF EXISTS "Public read member linktree" ON public.affiliate_members;
CREATE POLICY "Public read member linktree"
  ON public.affiliate_members FOR SELECT
  USING (linktree_slug IS NOT NULL AND is_active = true AND linktree_status = 'approved');
