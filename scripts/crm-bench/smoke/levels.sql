-- Droits d'envoi par niveaux (annulé).
DO $s$
DECLARE caps jsonb; mode3 jsonb; tick jsonb; rep jsonb; r1 jsonb; c1 jsonb;
BEGIN
  caps := jsonb_build_object('woh_crm', email_sender_daily_cap('venue:woh'), 'woh_tickets', email_sender_daily_cap('org:617d01cb-6568-4a7a-9aea-4f25d9c29fc8'),
     '3am', email_sender_daily_cap('org:10764c3b-f312-42da-be99-4d57d7c6c0c5'), 'amoris', email_sender_daily_cap('org:06ce47f8-66a5-42d5-a7bf-56253619ff96'),
     'new_account', email_sender_daily_cap('org:00000000-0000-0000-0000-000000000001'));
  tick := email_sender_levels_tick();
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r1 := enqueue_campaign_recipients('aa583e5c-0c52-45a6-a324-26f3d9d5952d');
  SELECT jsonb_build_object('per_h', throttle_per_hour, 'forced', spread_forced) INTO c1 FROM email_campaigns WHERE id='aa583e5c-0c52-45a6-a324-26f3d9d5952d';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM user_roles WHERE role='admin' LIMIT 1), 'role','authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  mode3 := email_sender_send_mode(NULL, '10764c3b-f312-42da-be99-4d57d7c6c0c5');
  rep := email_sender_health_report(NULL, '06ce47f8-66a5-42d5-a7bf-56253619ff96', NULL);
  RAISE EXCEPTION 'SMOKE_OK CAPS % ### TICK % ### WOH_CAMPAIGN % ### 3AM_MODE % ### AMORIS_RIGHTS %', caps, tick, c1, mode3, (rep->'rights') - 'ladder';
END $s$;
