-- Option club : affichage de la carte bouteilles dans le tunnel de réservation.
--   'text'   = liste écrite (accordéon), défaut
--   'visual' = bouton « Voir la carte » → page/modale avec images des bouteilles
-- Complète vip_menu_visibility (hidden/no_prices/full) et vip_preorder_enabled.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS vip_menu_display_mode text NOT NULL DEFAULT 'text';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'venues_vip_menu_display_mode_check'
  ) THEN
    ALTER TABLE public.venues
      ADD CONSTRAINT venues_vip_menu_display_mode_check
      CHECK (vip_menu_display_mode IN ('text', 'visual'));
  END IF;
END $$;

COMMENT ON COLUMN public.venues.vip_menu_display_mode IS 'Affichage carte VIP au checkout : text (liste) | visual (images).';
