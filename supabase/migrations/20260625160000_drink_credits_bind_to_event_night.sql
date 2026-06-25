-- Drink credits ("crédits conso") are bound to the soirée they were bought for.
-- Historically order_pack_credits.event_id was populated at creation, but
-- expires_at could be left NULL when the linked event had no end_at. A NULL
-- expiry is a silent bug: the credit shows forever on the orders page yet can
-- never be redeemed (the cart + use-drink-credit both filter with
-- `expires_at > now()`, which excludes NULLs). This backfills a real expiry so
-- every event-bound credit lives and dies with its event night.
--
-- Rule: expire at the event end, or (when the event has no end_at) 8 hours
-- after it starts — a generous floor for a single club night. Venue-wide
-- credits (event_id IS NULL) are intentionally left untouched: those are not
-- tied to any soirée.

UPDATE public.order_pack_credits opc
SET expires_at = COALESCE(e.end_at, e.start_at + INTERVAL '8 hours')
FROM public.events e
WHERE opc.event_id = e.id
  AND opc.expires_at IS NULL;
