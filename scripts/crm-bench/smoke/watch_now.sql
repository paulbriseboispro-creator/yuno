-- Ce que la surveillance ferait sur la prod maintenant (annulé).
DO $s$ DECLARE r jsonb; BEGIN
  r := email_deliverability_watch();
  RAISE EXCEPTION 'SMOKE_OK %', r;
END $s$;
