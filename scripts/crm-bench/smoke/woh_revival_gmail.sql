-- Envoi unique REVIVAL 04/11 : Gmail actifs seulement (annulé).
DO $s$
DECLARE r jsonb; m jsonb; c jsonb; n int; jobs jsonb;
BEGIN
  SELECT jsonb_array_length(audiences_json->0->'def'->'f'->'emails') INTO n FROM email_campaigns WHERE id='aa583e5c-0c52-45a6-a324-26f3d9d5952d';
  SELECT jsonb_agg(jsonb_build_object('j', jobname, 's', schedule)) INTO jobs FROM cron.job WHERE jobname LIKE 'woh-revival%';
  UPDATE email_sender_health SET level = 3 WHERE scope_key='venue:woh';
  INSERT INTO email_sender_state (scope_key, venue_id, daily_cap_override) VALUES ('venue:woh','woh',1000) ON CONFLICT (scope_key) DO UPDATE SET daily_cap_override=1000;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := enqueue_campaign_recipients('aa583e5c-0c52-45a6-a324-26f3d9d5952d');
  SELECT jsonb_object_agg(k, x) INTO m FROM (SELECT CASE WHEN status<>'pending' THEN coalesce(error_message,status)
     WHEN _email_is_gmail(email) THEN 'gmail' ELSE 'OTHER' END k, count(*) x FROM email_campaign_recipients
     WHERE campaign_id='aa583e5c-0c52-45a6-a324-26f3d9d5952d' GROUP BY 1) z;
  SELECT jsonb_build_object('per_h', throttle_per_hour, 'label', audiences_json->0->>'label', 'area', audiences_json->0->'def'->'f'->'area') INTO c FROM email_campaigns WHERE id='aa583e5c-0c52-45a6-a324-26f3d9d5952d';
  RAISE EXCEPTION 'SMOKE_OK list=% jobs=% cap=% camp=% rows=% enqueue=%', n, jobs, email_sender_daily_cap('venue:woh'), c, m, r - 'yunits_balance';
END $s$;
