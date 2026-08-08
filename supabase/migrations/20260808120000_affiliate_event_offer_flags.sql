-- ============================================================================
-- Offre d'une soirée affiliée : tables VIP et guest list.
--
-- Certains clubs ne donnent à leurs promoteurs que la vente de tables ;
-- d'autres ajoutent une guest list (mixte ou réservée aux femmes). Ces
-- drapeaux décrivent ce que la soirée propose, sur le modèle récurrent
-- (valeur par défaut copiée sur chaque occurrence générée) comme sur la
-- soirée elle-même (modifiable au cas par cas). Affichés en badges sur les
-- surfaces publiques (linktree, page RP, agenda, page soirée).
--
--   has_tables      : des tables VIP sont disponibles.
--   tables_only     : la soirée ne vend QUE des tables (pas de billets
--                     d'entrée) — implique has_tables côté affichage.
--   has_guest_list  : une guest list est ouverte.
--   guest_list_type : 'mixed' (défaut) ou 'women' (guest list femmes).
-- ============================================================================

ALTER TABLE public.affiliate_events
  ADD COLUMN IF NOT EXISTS has_tables boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tables_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_guest_list boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guest_list_type text NOT NULL DEFAULT 'mixed';

ALTER TABLE public.affiliate_events
  DROP CONSTRAINT IF EXISTS affiliate_events_guest_list_type_check;
ALTER TABLE public.affiliate_events
  ADD CONSTRAINT affiliate_events_guest_list_type_check
  CHECK (guest_list_type IN ('mixed', 'women'));

ALTER TABLE public.affiliate_recurring_templates
  ADD COLUMN IF NOT EXISTS has_tables boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tables_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_guest_list boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS guest_list_type text NOT NULL DEFAULT 'mixed';

ALTER TABLE public.affiliate_recurring_templates
  DROP CONSTRAINT IF EXISTS affiliate_recurring_templates_guest_list_type_check;
ALTER TABLE public.affiliate_recurring_templates
  ADD CONSTRAINT affiliate_recurring_templates_guest_list_type_check
  CHECK (guest_list_type IN ('mixed', 'women'));
