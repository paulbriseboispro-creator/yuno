-- Add post_visit_notified column to orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS post_visit_notified BOOLEAN NOT NULL DEFAULT false;

-- Create index for efficient querying of unnotified orders
CREATE INDEX IF NOT EXISTS idx_orders_post_visit_notified 
ON public.orders (post_visit_notified, served_at) 
WHERE status = 'served' AND post_visit_notified = false;