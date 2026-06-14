-- Fix promoter_conversions amounts: use unit_price * quantity instead of total_price
UPDATE public.promoter_conversions pc
SET amount = t.unit_price * t.quantity
FROM public.tickets t
WHERE pc.ticket_id = t.id
  AND pc.conversion_type = 'ticket'
  AND pc.amount != (t.unit_price * t.quantity);