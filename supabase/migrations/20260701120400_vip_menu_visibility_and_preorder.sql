-- Phases 2 & 3 — Réglages club pour la vitrine menu VIP dans le tunnel de réservation.
--
-- vip_menu_visibility : 3 modes, car dans le nightlife haut de gamme l'opacité des prix
-- bouteilles est parfois VOLONTAIRE (signal d'exclusivité, évite l'ancrage).
--   'hidden'    -> aucune vitrine menu avant paiement (comportement actuel, défaut)
--   'no_prices' -> le client voit les bouteilles disponibles, sans prix
--   'full'      -> le client voit bouteilles + prix
--
-- vip_preorder_enabled : autorise la pré-commande de bouteilles au checkout table
--   (bundle table + bouteilles ; alimente le minimum spend, revenu prépayé garanti).

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS vip_menu_visibility text NOT NULL DEFAULT 'hidden',
  ADD COLUMN IF NOT EXISTS vip_preorder_enabled boolean NOT NULL DEFAULT false;

-- Garde-fou : n'accepter que les 3 valeurs prévues.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'venues_vip_menu_visibility_check'
  ) THEN
    ALTER TABLE public.venues
      ADD CONSTRAINT venues_vip_menu_visibility_check
      CHECK (vip_menu_visibility IN ('hidden', 'no_prices', 'full'));
  END IF;
END $$;

COMMENT ON COLUMN public.venues.vip_menu_visibility  IS 'Vitrine menu VIP dans le tunnel de résa : hidden | no_prices | full.';
COMMENT ON COLUMN public.venues.vip_preorder_enabled IS 'Autorise la pré-commande de bouteilles au checkout table VIP.';
