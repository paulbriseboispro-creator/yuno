
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;

-- Add refund tracking columns
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refunded_by UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS refunded_by UUID;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS refunded_by UUID;
ALTER TABLE public.table_reservations ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
