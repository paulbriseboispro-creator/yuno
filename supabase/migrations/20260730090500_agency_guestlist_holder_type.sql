-- =====================================================================
-- Guest list — nouvelle part d'ENVELOPPE 'agency'.
--
-- Un club Yuno accorde à une agence de promoteurs une enveloppe de places
-- guest list (par contrat, ou par soirée). Cette enveloppe est portée par une
-- part guest_lists holder_type='agency' (une seule par (soirée, agence)), que
-- l'agence répartit ensuite entre SES promoteurs — soit en PARTITION (sous-parts
-- promoteur au quota fixe, somme ≤ enveloppe), soit en POOL (tous les promoteurs
-- puisent dans la même part jusqu'à épuisement de l'enveloppe).
--
-- Ici : uniquement le socle de données (colonnes + contraintes + unicité). La
-- matérialisation, la distribution et l'enforcement suivent (092000 / 093000 /
-- 094000). L'enforcement de capacité (enforce_guest_list_capacity) n'est PAS
-- touché : une part 'agency' est une ligne guest_lists comme les autres, son
-- `quota` EST la limite du pool, le trigger la garde nativement.
-- =====================================================================

-- Rattachement à l'agence. SET NULL comme promoter_id (20260622000000) : la part
-- de la porte doit survivre à la fin d'un contrat, on ne détruit pas la liste.
ALTER TABLE public.guest_lists
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL;

-- Mode de répartition — propre aux parts 'agency' (NULL partout ailleurs).
ALTER TABLE public.guest_lists
  ADD COLUMN IF NOT EXISTS agency_distribution_mode text
    CHECK (agency_distribution_mode IN ('partition', 'pool'));

CREATE INDEX IF NOT EXISTS idx_guest_lists_agency
  ON public.guest_lists (agency_id) WHERE agency_id IS NOT NULL;

-- ── holder_type : ajoute 'agency' (dernière définition : 20260723130000) ─────
ALTER TABLE public.guest_lists DROP CONSTRAINT IF EXISTS guest_lists_holder_type_check;
ALTER TABLE public.guest_lists
  ADD CONSTRAINT guest_lists_holder_type_check
  CHECK (holder_type IN ('club', 'dj', 'promoter', 'custom', 'organizer', 'agency'));

-- ── cohérence : une part 'agency' porte agency_id, jamais promoter/dj ────────
-- (dernière définition : 20260723170000 — on ré-énumère + branche 'agency'.)
ALTER TABLE public.guest_lists DROP CONSTRAINT IF EXISTS guest_lists_holder_coherence_check;
ALTER TABLE public.guest_lists
  ADD CONSTRAINT guest_lists_holder_coherence_check CHECK (
    (holder_type = 'club'      AND dj_id IS NULL AND promoter_id IS NULL)
    OR (holder_type = 'dj'        AND dj_id IS NOT NULL)
    OR (holder_type = 'promoter'  AND promoter_id IS NOT NULL)
    OR (holder_type = 'custom'    AND holder_label IS NOT NULL AND length(btrim(holder_label)) > 0)
    OR (holder_type = 'organizer' AND organizer_user_id IS NOT NULL
        AND dj_id IS NULL AND promoter_id IS NULL)
    OR (holder_type = 'agency'    AND agency_id IS NOT NULL
        AND dj_id IS NULL AND promoter_id IS NULL)
  );

-- Une seule enveloppe par (soirée, agence) — cible du ON CONFLICT à la
-- matérialisation / à l'octroi par soirée.
CREATE UNIQUE INDEX IF NOT EXISTS guest_lists_event_agency_uniq
  ON public.guest_lists (event_id, agency_id)
  WHERE holder_type = 'agency';

COMMENT ON COLUMN public.guest_lists.agency_id IS
  'Part ENVELOPPE agence : quota total accordé par le club à l''agence pour cette soirée. Répartie entre les promoteurs (voir agency_distribution_mode).';
COMMENT ON COLUMN public.guest_lists.agency_distribution_mode IS
  'partition = sous-parts promoteur au quota fixe (somme ≤ enveloppe) ; pool = tous les promoteurs de l''agence puisent dans cette part jusqu''à épuisement du quota. NULL hors parts agency.';
