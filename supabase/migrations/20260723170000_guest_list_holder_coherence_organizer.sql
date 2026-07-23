-- =====================================================================
-- FIX — la part d'allocation 'organizer' violait guest_lists_holder_coherence_check.
--
-- En ajoutant le holder_type 'organizer' (migration 20260723130000) on avait
-- élargi guest_lists_holder_type_check mais PAS la contrainte de cohérence, qui
-- n'énumère que club/dj/promoter/custom. Résultat : le club validait une demande
-- d'allocation et l'INSERT partait en erreur « violates check constraint ».
--
-- Une part 'organizer' est portée par un organisateur : organizer_user_id requis,
-- et surtout aucun dj_id / promoter_id (ce n'est pas une part déléguée).
-- =====================================================================

ALTER TABLE public.guest_lists DROP CONSTRAINT IF EXISTS guest_lists_holder_coherence_check;
ALTER TABLE public.guest_lists
  ADD CONSTRAINT guest_lists_holder_coherence_check CHECK (
    (holder_type = 'club'      AND dj_id IS NULL AND promoter_id IS NULL)
    OR (holder_type = 'dj'        AND dj_id IS NOT NULL)
    OR (holder_type = 'promoter'  AND promoter_id IS NOT NULL)
    OR (holder_type = 'custom'    AND holder_label IS NOT NULL AND length(btrim(holder_label)) > 0)
    OR (holder_type = 'organizer' AND organizer_user_id IS NOT NULL
        AND dj_id IS NULL AND promoter_id IS NULL)
  );
