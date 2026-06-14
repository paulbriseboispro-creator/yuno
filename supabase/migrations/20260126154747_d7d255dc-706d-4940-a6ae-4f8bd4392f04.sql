-- Enable realtime updates for loyalty balance changes (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'customer_loyalty'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_loyalty;
  END IF;
END $$;