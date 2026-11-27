-- D17 (Paul, 27/11) : la carte bouteilles d'un club se montre aux clients PAR DÉFAUT ; le club peut la cacher
-- (Tables VIP › Carte : « Montrer la carte aux clients »). Les anciens défauts (hidden / false) n'avaient jamais été
-- réglés par les clubs (aucun écran ne les écrivait) : ils sont remis une fois à « visible », précommande permise.
ALTER TABLE public.venues ALTER COLUMN vip_menu_visibility SET DEFAULT 'full';
ALTER TABLE public.venues ALTER COLUMN vip_preorder_enabled SET DEFAULT true;

UPDATE public.venues
   SET vip_menu_visibility = 'full', vip_preorder_enabled = true
 WHERE vip_menu_visibility = 'hidden' OR vip_preorder_enabled = false;
