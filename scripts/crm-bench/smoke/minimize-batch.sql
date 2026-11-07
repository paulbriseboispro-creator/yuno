DO $$
DECLARE t0 timestamptz := clock_timestamp(); a integer; b integer; left_n bigint; ms numeric;
BEGIN
  a := public.email_events_minimize(5000, 30);
  b := public.email_events_minimize(5000, 30);
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  SELECT count(*) INTO left_n FROM public.email_campaign_events
   WHERE created_at < now() - interval '30 days' AND (metadata #> '{click,ipAddress}' IS NOT NULL OR metadata #> '{open,ipAddress}' IS NOT NULL);
  RAISE EXCEPTION 'SMOKE_OK deux lots de 5000 : % puis % lignes minimisées en % ms ; restent % lignes anciennes avec IP', a, b, ms, left_n;
END $$;
