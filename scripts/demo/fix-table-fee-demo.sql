-- Démo : les tables semées portaient les frais de gestion DANS total_price
-- (prix × 1,04), alors qu'un vrai checkout les facture EN PLUS du prix de la
-- table. Depuis 20260929170000 le CA tables ne retire ces frais que s'ils sont
-- absorbés : sans ce correctif, la démo compterait les frais deux fois.
-- Rejouable (ne touche que les lignes encore « prix × 1,04 »), borné au
-- périmètre démo.
BEGIN;
WITH d AS MATERIALIZED (SELECT demo_event_ids() AS de),
fix AS (
  SELECT tr.id, round(tr.total_price - tr.management_fee, 2) AS new_total,
         (abs(tr.deposit - tr.total_price) < 0.02) AS deposit_was_total
    FROM public.table_reservations tr
    JOIN public.table_packs p ON p.id = tr.pack_id
   CROSS JOIN d
   WHERE tr.event_id = ANY (d.de)
     AND NOT COALESCE(tr.fee_absorbed, false)
     AND tr.management_fee > 0
     AND abs(tr.total_price - round(p.base_price * 1.04, 2)) < 0.02
)
UPDATE public.table_reservations tr
   SET total_price = fix.new_total,
       deposit = CASE WHEN fix.deposit_was_total THEN fix.new_total ELSE tr.deposit END
  FROM fix
 WHERE tr.id = fix.id;
SELECT count(*) AS restant_avec_frais_inclus
  FROM public.table_reservations tr JOIN public.table_packs p ON p.id = tr.pack_id
 WHERE tr.event_id = ANY (demo_event_ids()) AND tr.management_fee > 0
   AND abs(tr.total_price - round(p.base_price * 1.04, 2)) < 0.02;
COMMIT;
