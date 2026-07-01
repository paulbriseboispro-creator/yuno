-- Phase 1 — Tracking mixer explicite (chemin commande QR).
-- Aujourd'hui : un mixer commandé est juste une ligne vip_table_order_items de plus, sans
-- lien vers la bouteille à laquelle il se rattache -> impossible de répondre « quel mixer
-- avec quelle bouteille ». On ajoute un lien parent facultatif vers la ligne bouteille.
-- (Le chemin host utilise déjà vip_consumptions.parent_consumption_id, ajouté en Phase 0.)

ALTER TABLE public.vip_table_order_items
  ADD COLUMN IF NOT EXISTS parent_order_item_id uuid
    REFERENCES public.vip_table_order_items(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_vip_order_items_parent
  ON public.vip_table_order_items(parent_order_item_id);

COMMENT ON COLUMN public.vip_table_order_items.parent_order_item_id IS
  'Si c''est un mixer/diluant, référence la ligne bouteille parente du même order.';
