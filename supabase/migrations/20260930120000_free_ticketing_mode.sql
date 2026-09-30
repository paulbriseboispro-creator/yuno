-- Billetterie LIBRE (events.ticket_selling_mode = 'free').
--
-- Une liste de billets sans règle imposée : chacun son nom, son prix, sa
-- quantité et, en option, une boisson offerte. Le pro règle billet par billet
-- QUAND on le voit (tout de suite / à une date / caché) et QUAND on l'achète
-- (tout de suite / à une date / plus tard, à la main), plus une fin de vente
-- facultative. `is_active` garde son sens de « vente ouverte à la main ».
--
-- Ces colonnes valent dans tous les modes mais restent à leur défaut hors du
-- mode libre, où elles n'ont donc aucun effet. Règle de lecture unique :
-- src/lib/freeTicketing.ts ⇄ supabase/functions/_shared/free-ticketing.ts
-- (ticketPhase), appliquée au checkout (create-ticket-checkout).
--
-- ticket_selling_mode et ticket_presets.selling_mode sont des text sans
-- CHECK : 'free' n'a rien à déclarer. Un modèle libre range ses billets dans
-- ticket_presets.rounds avec des dates RELATIVES au jour de la soirée
-- ({daysBefore, time}), pour se rejouer sur n'importe quelle date.

ALTER TABLE public.ticket_rounds
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visible_from timestamptz,
  ADD COLUMN IF NOT EXISTS sale_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS sale_ends_at timestamptz;

ALTER TABLE public.ticket_rounds
  DROP CONSTRAINT IF EXISTS ticket_rounds_sale_window_check;
ALTER TABLE public.ticket_rounds
  ADD CONSTRAINT ticket_rounds_sale_window_check
  CHECK (sale_starts_at IS NULL OR sale_ends_at IS NULL OR sale_ends_at > sale_starts_at);

COMMENT ON COLUMN public.ticket_rounds.hidden IS
  'Billetterie libre : billet caché au public (ni affiché, ni vendu). Défaut false = sans effet.';
COMMENT ON COLUMN public.ticket_rounds.visible_from IS
  'Billetterie libre : le billet n''apparaît qu''à partir de cet instant. NULL = tout de suite.';
COMMENT ON COLUMN public.ticket_rounds.sale_starts_at IS
  'Billetterie libre : visible mais pas achetable avant cet instant (« Bientôt »). NULL = selon is_active.';
COMMENT ON COLUMN public.ticket_rounds.sale_ends_at IS
  'Billetterie libre : fin de vente (le billet reste affiché, « Vente terminée »). NULL = jusqu''à la soirée.';
