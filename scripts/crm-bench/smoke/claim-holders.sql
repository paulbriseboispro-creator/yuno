DO $$
DECLARE
  c uuid := 'ec6daa79-91b3-4c79-ad08-b8c58c7704db';
  got integer; st text; msg text; stc text; skipped integer;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  UPDATE public.email_campaign_recipients SET status = 'pending', batch_key = NULL, next_attempt_at = NULL, error_message = NULL
   WHERE campaign_id = c AND lower(email) IN ('maximebouget@orange.fr');
  SELECT count(*) INTO got FROM public.claim_campaign_recipients(c, 10);
  SELECT string_agg(left(email, 8) || ':' || status || ':' || COALESCE(error_message, '-'), ' | ') INTO st
    FROM public.email_campaign_recipients WHERE campaign_id = c AND lower(email) IN ('maximebouget@orange.fr');
  RAISE EXCEPTION 'SMOKE_OK claimed=% rows=%', got, st;
END $$;
