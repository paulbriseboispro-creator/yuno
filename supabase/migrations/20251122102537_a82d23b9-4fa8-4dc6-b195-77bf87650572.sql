-- Add archived field to orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;

-- Create index for archived orders
CREATE INDEX IF NOT EXISTS idx_orders_archived ON public.orders(archived);

-- Create function to archive expired orders
CREATE OR REPLACE FUNCTION public.archive_expired_event_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Archive paid orders from ended events that were not served
  UPDATE public.orders o
  SET archived = true
  FROM public.events e
  WHERE o.event_id = e.id
    AND o.archived = false
    AND o.status = 'paid'
    AND o.served_at IS NULL
    AND e.end_at < now();
END;
$$;