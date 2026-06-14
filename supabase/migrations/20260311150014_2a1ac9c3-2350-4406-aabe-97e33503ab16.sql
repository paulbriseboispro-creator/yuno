
-- Add guest checkout fields to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number text UNIQUE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_first_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_last_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_guest boolean DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS claimed_by_user_id uuid;

-- Function to generate readable order number (YN-XXXXXX)
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS text LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_number text; v_exists boolean;
BEGIN
  LOOP
    v_number := 'YN-' || upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 6));
    SELECT EXISTS(SELECT 1 FROM orders WHERE order_number = v_number) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_number;
END; $$;

-- Auto-generate order_number on insert
CREATE OR REPLACE FUNCTION public.set_order_number() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.order_number IS NULL THEN
    NEW.order_number := public.generate_order_number();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_set_order_number ON orders;
CREATE TRIGGER trg_set_order_number BEFORE INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION public.set_order_number();

-- Backfill existing orders with order_number
UPDATE orders SET order_number = public.generate_order_number() WHERE order_number IS NULL;

-- OTP table for guest claim verification
CREATE TABLE IF NOT EXISTS public.guest_claim_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  email text NOT NULL,
  otp_code text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.guest_claim_otps ENABLE ROW LEVEL SECURITY;
-- No public access — only edge functions with service role
