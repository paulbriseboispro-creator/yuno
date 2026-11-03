-- Surveillance renforcée : 250 envois partis il y a 2 h, 5 ouvertures ⇒ pause (annulé).
DO $s$
DECLARE r1 jsonb; r2 jsonb; st text; al jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM enqueue_campaign_recipients('aa583e5c-0c52-45a6-a324-26f3d9d5952d');
  UPDATE email_campaigns SET status = 'sending' WHERE id = 'aa583e5c-0c52-45a6-a324-26f3d9d5952d';
  r1 := email_test_watch('aa583e5c-0c52-45a6-a324-26f3d9d5952d');
  UPDATE email_campaign_recipients SET status = 'sent', sent_at = now() - interval '2 hours'
   WHERE id IN (SELECT id FROM email_campaign_recipients WHERE campaign_id = 'aa583e5c-0c52-45a6-a324-26f3d9d5952d' AND status = 'pending' LIMIT 250);
  INSERT INTO email_campaign_events (campaign_id, recipient_email, event_type)
  SELECT campaign_id, email, 'opened' FROM email_campaign_recipients WHERE campaign_id = 'aa583e5c-0c52-45a6-a324-26f3d9d5952d' AND status = 'sent' LIMIT 5;
  r2 := email_test_watch('aa583e5c-0c52-45a6-a324-26f3d9d5952d');
  SELECT status || ' / ' || coalesce(error_message, '') INTO st FROM email_campaigns WHERE id = 'aa583e5c-0c52-45a6-a324-26f3d9d5952d';
  SELECT jsonb_agg(title) INTO al FROM admin_notifications WHERE dedup_key LIKE 'test_watch%';
  RAISE EXCEPTION 'SMOKE_OK r1=% ### r2=% ### %  ### %', r1, r2, st, al;
END $s$;
