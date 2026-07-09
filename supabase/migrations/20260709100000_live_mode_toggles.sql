-- Mode Live — toggles de configuration.
--
-- `venues.live_mode_enabled` : le club peut couper le takeover Mode Live
--   (bascule de l'app cliente au scan d'entrée + push de bienvenue). ON par défaut.
-- `venues.solo_bottle_sale_enabled` : opt-in club pour la vente de bouteilles
--   SANS table (retrait au bar via QR, flux orders/Barman). OFF par défaut.
-- `vip_menu_items.solo_sale_enabled` : opt-out par bouteille quand le venue a
--   activé la vente solo. ON par défaut pour que l'activation du toggle venue
--   rende tout le menu VIP actif vendable d'un coup.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS live_mode_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS solo_bottle_sale_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.vip_menu_items
  ADD COLUMN IF NOT EXISTS solo_sale_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.venues.live_mode_enabled IS
  'Mode Live : takeover de l''app cliente au scan d''entrée (menu soirée plein écran).';
COMMENT ON COLUMN public.venues.solo_bottle_sale_enabled IS
  'Vente de bouteilles sans table pendant le Mode Live (retrait au bar via QR).';
COMMENT ON COLUMN public.vip_menu_items.solo_sale_enabled IS
  'Bouteille vendable sans table quand venues.solo_bottle_sale_enabled est actif.';
