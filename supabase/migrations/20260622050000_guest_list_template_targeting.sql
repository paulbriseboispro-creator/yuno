-- Les presets de guest list pilotent maintenant TOUTE la distribution depuis le
-- formulaire de template : pour qui (ciblage), quel type d'entrée, et la visibilité.
--   target_mode : 'all' (tous) | 'select' (à sélectionner à l'application) | 'agency'
--                 (promoteur seulement : un contrat global délégué à une agence)
--   entry_kind  : 'normal' | 'drink' (boisson offerte) | 'table' (accès VIP)
-- La visibilité réutilise visible_on_club_page (true = page de sélection publique via
-- le lien ; false = privé / lien direct).

ALTER TABLE public.guest_list_templates
  ADD COLUMN IF NOT EXISTS target_mode text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS entry_kind  text NOT NULL DEFAULT 'normal';

ALTER TABLE public.guest_list_templates DROP CONSTRAINT IF EXISTS glt_target_mode_check;
ALTER TABLE public.guest_list_templates
  ADD CONSTRAINT glt_target_mode_check CHECK (target_mode IN ('all','select','agency'));

ALTER TABLE public.guest_list_templates DROP CONSTRAINT IF EXISTS glt_entry_kind_check;
ALTER TABLE public.guest_list_templates
  ADD CONSTRAINT glt_entry_kind_check CHECK (entry_kind IN ('normal','drink','table'));

-- Le type d'entrée porté par une part : les inscriptions via son lien héritent de ce
-- type (le scanner de porte + les crédits boisson s'en servent).
ALTER TABLE public.guest_lists
  ADD COLUMN IF NOT EXISTS entry_kind text NOT NULL DEFAULT 'normal';

ALTER TABLE public.guest_lists DROP CONSTRAINT IF EXISTS guest_lists_entry_kind_check;
ALTER TABLE public.guest_lists
  ADD CONSTRAINT guest_lists_entry_kind_check CHECK (entry_kind IN ('normal','drink','table'));
