-- Démo : efface l'historique du bar du club womber (pilier boissons en pause, 2026-10-01).
-- Rejouable. Borné au périmètre démo (venue_id = 'womber' ou soirées démo).
-- Les tables filles sont en ON DELETE CASCADE (order_items, order_pack_credits,
-- order_unit_redemptions, guest_claim_otps, live_activity_tokens, vip_table_order_items).
-- La CARTE (`drinks`) reste : c'est la matière du relancement.
BEGIN;
DELETE FROM public.vip_table_orders WHERE venue_id = 'womber';
DELETE FROM public.orders WHERE venue_id = 'womber' OR event_id IN (SELECT unnest(public.demo_event_ids()));
UPDATE public.venues
SET description = 'Le club Yuno — billets, guest list et tables VIP, tout dans une seule app.'
WHERE id = 'womber' AND description ILIKE '%commande au bar%';
COMMIT;
