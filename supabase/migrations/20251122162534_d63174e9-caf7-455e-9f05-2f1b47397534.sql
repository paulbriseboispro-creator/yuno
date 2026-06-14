-- Update the archive_expired_event_orders function to mark orders as served
CREATE OR REPLACE FUNCTION public.archive_expired_event_orders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Archive paid orders from ended events that were not served
  -- Also mark them as served with served_at timestamp
  UPDATE public.orders o
  SET 
    archived = true,
    status = 'served',
    served_at = now()
  FROM public.events e
  WHERE o.event_id = e.id
    AND o.archived = false
    AND o.status = 'paid'
    AND o.served_at IS NULL
    AND e.end_at < now();
END;
$function$;