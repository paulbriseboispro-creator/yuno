-- ============================================================================
-- Guest list : quota illimité pour les parts déléguées (promoteur / DJ / autre).
--
-- Convention : quota NULL = illimité. Le trigger de capacité
-- (enforce_guest_list_capacity) ignore déjà les quotas NULL ou <= 0 — seule la
-- contrainte NOT NULL empêchait de le représenter. Les pré-checks des edge
-- functions sont alignés dans le même chantier (create-guest-list-entry
-- traitait `count >= null` comme plein → inscription publique toujours refusée
-- sur une part illimitée sans ce fix).
-- ============================================================================

ALTER TABLE public.guest_lists
  ALTER COLUMN quota DROP NOT NULL;
