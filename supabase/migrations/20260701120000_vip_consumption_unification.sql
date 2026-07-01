-- Phase 0 — Unification du modèle de consommation VIP
-- Problème audité : deux chemins d'écriture non réconciliables pour la conso VIP :
--   (a) saisie host      -> vip_consumptions (item en TEXTE LIBRE, aucun lien menu)
--   (b) commande QR client -> vip_table_order_items (vrai menu_item_id FK)
-- Toute analytics « top bouteilles / conso par catégorie » bâtie là-dessus serait bancale.
-- Ici : on enrichit vip_consumptions d'un vrai lien menu + on expose UNE vue analytique
-- unifiée (vip_consumption_facts) qui normalise les deux chemins en une seule source.

-- 1. Enrichir vip_consumptions : lien menu fiable, marque, origine, et lien mixer -> bouteille
ALTER TABLE public.vip_consumptions
  ADD COLUMN IF NOT EXISTS menu_item_id uuid REFERENCES public.vip_menu_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS parent_consumption_id uuid REFERENCES public.vip_consumptions(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.vip_consumptions.menu_item_id IS 'Lien fiable vers vip_menu_items (NULL si saisie libre héritée).';
COMMENT ON COLUMN public.vip_consumptions.brand IS 'Marque dénormalisée pour l''analytics (ex. Louis Roederer).';
COMMENT ON COLUMN public.vip_consumptions.source IS 'staff | preorder | qr — origine de la ligne de conso.';
COMMENT ON COLUMN public.vip_consumptions.parent_consumption_id IS 'Si c''est un mixer/diluant, référence la ligne bouteille parente.';

-- 2. Backfill best-effort : relier l'existant au menu par nom (même venue), remplir category/brand.
--    Non destructif : on ne touche qu'aux lignes encore non reliées.
UPDATE public.vip_consumptions c
SET menu_item_id = m.id,
    category = COALESCE(c.category, m.category),
    brand    = COALESCE(c.brand, m.brand)
FROM public.vip_menu_items m
WHERE c.menu_item_id IS NULL
  AND m.venue_id = c.venue_id
  AND lower(trim(m.name)) = lower(trim(c.item_name));

-- 3. Index analytiques
CREATE INDEX IF NOT EXISTS idx_vip_consumptions_menu_item   ON public.vip_consumptions(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_vip_consumptions_venue_event ON public.vip_consumptions(venue_id, event_id);
CREATE INDEX IF NOT EXISTS idx_vip_consumptions_served_at   ON public.vip_consumptions(served_at);
CREATE INDEX IF NOT EXISTS idx_vip_consumptions_parent      ON public.vip_consumptions(parent_consumption_id);

-- 4. Vue analytique unifiée : un enregistrement par ligne consommée, tous chemins confondus.
--    NON exposée à authenticated/anon : seule une RPC SECURITY DEFINER (scopée venue) la lit.
DROP VIEW IF EXISTS public.vip_consumption_facts;
CREATE VIEW public.vip_consumption_facts AS
  -- Chemin 1 : saisie host (vip_consumptions)
  SELECT
    c.id,
    c.table_reservation_id,
    c.venue_id,
    c.event_id,
    tr.zone_id,
    c.menu_item_id,
    c.item_name,
    COALESCE(c.category, mi.category)          AS category,
    COALESCE(c.brand, mi.brand)                AS brand,
    c.item_type,
    c.quantity,
    c.unit_price,
    c.total_price,
    false                                      AS is_included,
    c.served_at,
    c.served_by,
    COALESCE(c.source, 'staff')                AS source,
    c.parent_consumption_id
  FROM public.vip_consumptions c
  LEFT JOIN public.table_reservations tr ON tr.id = c.table_reservation_id
  LEFT JOIN public.vip_menu_items mi     ON mi.id = c.menu_item_id

  UNION ALL

  -- Chemin 2 : commande QR client (vip_table_order_items -> vip_table_orders)
  SELECT
    oi.id,
    o.table_reservation_id,
    o.venue_id,
    tr.event_id,
    tr.zone_id,
    oi.menu_item_id,
    mi.name                                    AS item_name,
    mi.category,
    mi.brand,
    CASE
      WHEN mi.category = 'mixer'            THEN 'mixer'
      WHEN mi.category = 'soft'             THEN 'soft'
      WHEN mi.category IN ('extra','other') THEN 'extra'
      ELSE 'bottle'
    END                                        AS item_type,
    oi.quantity,
    oi.unit_price,
    (oi.quantity * oi.unit_price)              AS total_price,
    COALESCE(oi.is_included, false)            AS is_included,
    COALESCE(o.served_at, o.confirmed_at, o.created_at) AS served_at,
    o.confirmed_by                             AS served_by,
    'qr'                                       AS source,
    NULL::uuid                                 AS parent_consumption_id
  FROM public.vip_table_order_items oi
  JOIN public.vip_table_orders o        ON o.id = oi.order_id
  LEFT JOIN public.table_reservations tr ON tr.id = o.table_reservation_id
  LEFT JOIN public.vip_menu_items mi     ON mi.id = oi.menu_item_id
  WHERE o.status <> 'cancelled';

COMMENT ON VIEW public.vip_consumption_facts IS
  'Source analytique unifiée de la conso VIP (saisie host + commande QR), 1 ligne = 1 item consommé. Lue uniquement via RPC SECURITY DEFINER scopée par venue.';
