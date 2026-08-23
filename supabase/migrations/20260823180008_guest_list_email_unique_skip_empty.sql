-- ============================================================================
-- P1 GUEST LIST — Deux invités sans email doivent pouvoir coexister sur la
-- même liste.
--
-- Trou : guest_list_entries.email est NOT NULL et l'app enregistre '' quand
-- l'invité n'a pas d'email. L'index unique anti-doublon
-- uq_guest_list_entries_list_email (20260714160000, vérifié identique en
-- prod) :
--   (guest_list_id, lower(email)) WHERE email IS NOT NULL AND status <> 'cancelled'
-- traite '' comme une valeur : le 2e invité sans email de la même liste est
-- rejeté « déjà sur la liste ».
--
-- Correctif : unicité PARTIELLE — un email vide n'est jamais un doublon. On
-- garde le NOT NULL et la valeur '' (l'affichage et les exports comptent
-- dessus) ; seule la prédicat de l'index change (+ email <> ''). La sémantique
-- devient : sur une même liste, un même email NON VIDE (insensible à la
-- casse) n'apparaît qu'une fois parmi les entrées non annulées ; les entrées
-- sans email sont illimitées.
--
-- Vérifié avant écriture : aucun INSERT ... ON CONFLICT n'utilise cet index
-- comme arbitre (ni migrations ni edge functions) — le swap est sûr. Le
-- pré-check applicatif de guest-list-manage (dédup côté edge) est aligné dans
-- le même chantier par ailleurs (il doit ignorer les emails vides après trim).
-- ============================================================================

DROP INDEX IF EXISTS public.uq_guest_list_entries_list_email;

CREATE UNIQUE INDEX uq_guest_list_entries_list_email
  ON public.guest_list_entries (guest_list_id, lower(email))
  WHERE email IS NOT NULL AND email <> '' AND status <> 'cancelled';
