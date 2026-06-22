-- Reconcile dj_booking_contracts uniqueness to the intended design.
--
-- The 20260622130000 migration landed on prod (pushed by a concurrent workspace at an
-- intermediate edit) with a HARD unique constraint on dj_set_id — one contract per set
-- forever, even cancelled ones. The intended rule is "one ACTIVE contract per set", so a
-- set can be re-secured after a previous contract was cancelled/refunded. Already-applied
-- migrations don't re-run, so this forward migration converges the schema.
--
-- Idempotent: on a fresh database the DROP is a no-op (the column UNIQUE never existed
-- because 130000 there reflects the final design) and the index create is a no-op too.

ALTER TABLE public.dj_booking_contracts
  DROP CONSTRAINT IF EXISTS dj_booking_contracts_dj_set_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS dj_booking_contracts_active_set_unique
  ON public.dj_booking_contracts (dj_set_id)
  WHERE status NOT IN ('cancelled', 'refunded');
