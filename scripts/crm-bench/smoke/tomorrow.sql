-- La journée du 04/11 avec les 4 migrations (annulé).
DO $s$
DECLARE r1 jsonb; r2 jsonb; s1 jsonb; s2 jsonb; caps jsonb; st jsonb; late jsonb; c1 jsonb; c2 jsonb;
BEGIN
  SELECT jsonb_object_agg(id::text, jsonb_build_object('status', status, 'at', scheduled_at AT TIME ZONE 'Europe/Paris', 'per_h', throttle_per_hour))
    INTO st FROM email_campaigns WHERE id IN ('aa583e5c-0c52-45a6-a324-26f3d9d5952d','ec6daa79-91b3-4c79-ad08-b8c58c7704db');
  caps := jsonb_build_object('woh_crm', email_sender_daily_cap('venue:woh'), 'woh_tickets', email_sender_daily_cap('org:617d01cb-6568-4a7a-9aea-4f25d9c29fc8'),
     '3am', email_sender_daily_cap('org:10764c3b-f312-42da-be99-4d57d7c6c0c5'), 'amoris', email_sender_daily_cap('org:06ce47f8-66a5-42d5-a7bf-56253619ff96'));
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r1 := enqueue_campaign_recipients('aa583e5c-0c52-45a6-a324-26f3d9d5952d');
  SELECT jsonb_object_agg(k, n) INTO s1 FROM (SELECT CASE WHEN status <> 'pending' THEN coalesce(error_message, status)
       WHEN wave IS NOT NULL THEN 'wave' || wave WHEN next_attempt_at > now() + interval '30 minutes' THEN 'later(known/ramp)' ELSE 'now(engaged)' END k, count(*) n
    FROM email_campaign_recipients WHERE campaign_id='aa583e5c-0c52-45a6-a324-26f3d9d5952d' GROUP BY 1) x;
  r2 := enqueue_campaign_recipients('ec6daa79-91b3-4c79-ad08-b8c58c7704db');
  SELECT jsonb_object_agg(k, n) INTO s2 FROM (SELECT CASE WHEN status <> 'pending' THEN coalesce(error_message, status)
       WHEN wave IS NOT NULL THEN 'wave' || wave WHEN next_attempt_at > now() + interval '30 minutes' THEN 'later(known/ramp)' ELSE 'now(engaged)' END k, count(*) n
    FROM email_campaign_recipients WHERE campaign_id='ec6daa79-91b3-4c79-ad08-b8c58c7704db' GROUP BY 1) x;
  SELECT jsonb_build_object('per_h', throttle_per_hour, 'spread_forced', spread_forced, 'wave_state', wave_state) INTO c1 FROM email_campaigns WHERE id='aa583e5c-0c52-45a6-a324-26f3d9d5952d';
  SELECT jsonb_build_object('per_h', throttle_per_hour, 'spread_forced', spread_forced, 'wave_state', wave_state, 'waves', wave_total) INTO c2 FROM email_campaigns WHERE id='ec6daa79-91b3-4c79-ad08-b8c58c7704db';
  -- la soirée WOH commence : ce qui reste ne part plus
  UPDATE events SET start_at = now() - interval '1 minute' WHERE id = 'ad86ac12-4019-4c39-a223-d556278c750a';
  late := email_skip_after_event_start();
  RAISE EXCEPTION 'SMOKE_OK SCHEDULE % ### CAPS % ### WOH % % % ### 3AM % % % ### AT_START %', st, caps, c1, s1, r1 - 'yunits_balance', c2, s2, r2 - 'yunits_balance', late;
END $s$;
