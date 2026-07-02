-- Corrige la vue analytique vip_consumption_facts (Phase 0) contre le DOUBLE-COMPTAGE.
--
-- Le flux host « marquer servi » (VipOrderNotifications) copie les lignes de la commande
-- QR (vip_table_order_items) dans vip_consumptions ET passe la commande en 'served'.
-- La vue d'origine UNIONisait les 2 tables sans exclure les commandes servies -> chaque
-- item QR servi était compté 2 fois (une fois via la conso copiée, une fois via l'order).
--
-- Correction du chemin QR :
--   - exclut 'served'   -> déjà compté via vip_consumptions (copie au moment du service)
--   - exclut 'preorder' -> pré-commande NON encore validée par le host = pas encore consommée
--   - garde pending/confirmed/preparing -> commandes en cours (engagées, en préparation)
-- Chemin host (vip_consumptions) inchangé : c'est la vérité de la conso servie.

CREATE OR REPLACE VIEW public.vip_consumption_facts AS
  -- Chemin 1 : saisie host / conso servie (vip_consumptions)
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

  -- Chemin 2 : commande QR en cours (NON servie, NON pré-commande, NON annulée)
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
  WHERE o.status NOT IN ('cancelled', 'served', 'preorder');
