-- =====================================================================
-- Lecture agence des enveloppes & sous-parts guest list (RLS additive).
--
-- Le chef d'agence n'a aucune policy de lecture sur guest_lists : sa page de
-- distribution ne verrait rien. On ajoute des policies SELECT PERMISSIVES (donc
-- purement additives — elles n'enlèvent jamais d'accès, cf. le gotcha « narrowing
-- a base table's SELECT RLS ») pour qu'il voie :
--   • son enveloppe 'agency' ;
--   • les sous-parts 'promoter' distribuées à SES promoteurs ;
--   • les invités posés sur ces parts (comptage partition/pool) ;
--   • les assignations de ses promoteurs aux soirées (grille de répartition).
-- L'écriture reste exclusivement via les RPC SECURITY DEFINER (093000).
-- =====================================================================

-- Enveloppe agence + sous-parts promoteur de l'agence.
DROP POLICY IF EXISTS "Agency owner views agency guest list parts" ON public.guest_lists;
CREATE POLICY "Agency owner views agency guest list parts"
ON public.guest_lists FOR SELECT TO authenticated
USING (
  (holder_type = 'agency' AND public.is_agency_owner(auth.uid(), agency_id))
  OR (holder_type = 'promoter' AND EXISTS (
        SELECT 1 FROM public.promoters p
        WHERE p.id = guest_lists.promoter_id
          AND p.agency_id IS NOT NULL
          AND public.is_agency_owner(auth.uid(), p.agency_id)))
);

-- Invités sur une part que l'agence gère (source unique : can_manage_guest_list_part,
-- SECURITY DEFINER, déjà étendue aux parts/sous-parts agence en 094000).
DROP POLICY IF EXISTS "Agency owner views managed guest entries" ON public.guest_list_entries;
CREATE POLICY "Agency owner views managed guest entries"
ON public.guest_list_entries FOR SELECT TO authenticated
USING (public.can_manage_guest_list_part(auth.uid(), guest_list_id));

-- Assignations des promoteurs de l'agence (pour savoir qui est éligible à une part).
DROP POLICY IF EXISTS "Agency owner views agency promoter assignments" ON public.promoter_event_assignments;
CREATE POLICY "Agency owner views agency promoter assignments"
ON public.promoter_event_assignments FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.promoters p
  WHERE p.id = promoter_event_assignments.promoter_id
    AND p.agency_id IS NOT NULL
    AND public.is_agency_owner(auth.uid(), p.agency_id)
));
