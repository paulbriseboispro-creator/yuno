-- Add Click & Collect columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prep_requested boolean DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prep_status text DEFAULT 'queue' CHECK (prep_status IN ('queue', 'preparing', 'ready', 'served'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prep_claimed_by uuid REFERENCES auth.users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prep_claimed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notify_status text DEFAULT 'none' CHECK (notify_status IN ('none', 'ready', 'picked'));

-- Add Click & Collect mode to venues table
ALTER TABLE venues ADD COLUMN IF NOT EXISTS click_collect_mode boolean DEFAULT false;

-- Create index for better performance on prep queries
CREATE INDEX IF NOT EXISTS idx_orders_prep_status ON orders(prep_status);
CREATE INDEX IF NOT EXISTS idx_orders_prep_claimed_by ON orders(prep_claimed_by);
CREATE INDEX IF NOT EXISTS idx_orders_venue_prep ON orders(venue_id, prep_status);

-- Enable realtime for orders table
ALTER PUBLICATION supabase_realtime ADD TABLE orders;

COMMENT ON COLUMN orders.prep_requested IS 'Client has requested preparation';
COMMENT ON COLUMN orders.prep_status IS 'Preparation status: queue, preparing, ready, served';
COMMENT ON COLUMN orders.prep_claimed_by IS 'Barman who claimed this order';
COMMENT ON COLUMN orders.prep_claimed_at IS 'When the order was claimed';
COMMENT ON COLUMN orders.ready_at IS 'When the order was marked as ready';
COMMENT ON COLUMN orders.notify_status IS 'Notification status: none, ready, picked';