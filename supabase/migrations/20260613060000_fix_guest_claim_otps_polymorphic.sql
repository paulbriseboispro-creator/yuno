-- Guest-claim OTPs are polymorphic: order_id can reference orders(id),
-- tickets(id), or table_reservations(id) depending on which purchase type a
-- guest is claiming. The original FK to orders(id) made ticket and table guest
-- claims fail with a foreign-key violation when the edge function inserted the
-- OTP row. Drop the FK; the RGPD purge (deletes rows older than 24h) already
-- replaces the ON DELETE CASCADE cleanup that the FK provided.
ALTER TABLE public.guest_claim_otps
  DROP CONSTRAINT IF EXISTS guest_claim_otps_order_id_fkey;

-- Keep claim lookups fast now that there is no FK-backed index on the column.
CREATE INDEX IF NOT EXISTS idx_guest_claim_otps_order_id
  ON public.guest_claim_otps (order_id);

-- Brute-force protection: the verify action increments this on each wrong code
-- and invalidates the OTP after MAX_OTP_ATTEMPTS (5) tries.
ALTER TABLE public.guest_claim_otps
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
