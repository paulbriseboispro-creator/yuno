-- Envoi intelligent (20261129100000), sur les vraies campagnes du 04/11 (annulé).
DO $s$
DECLARE r1 jsonb; r2 jsonb; s1 jsonb; s2 jsonb; g jsonb; dly jsonb; v1 jsonb; v2 jsonb; br jsonb; inc boolean; inc2 boolean; lc jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r1 := enqueue_campaign_recipients('aa583e5c-0c52-45a6-a324-26f3d9d5952d');
  SELECT jsonb_object_agg(k, n) INTO s1 FROM (SELECT coalesce(error_message, status) || CASE WHEN wave IS NOT NULL THEN ':w' || wave ELSE '' END k, count(*) n
    FROM email_campaign_recipients WHERE campaign_id='aa583e5c-0c52-45a6-a324-26f3d9d5952d' GROUP BY 1) x;
  r2 := enqueue_campaign_recipients('ec6daa79-91b3-4c79-ad08-b8c58c7704db');
  SELECT jsonb_object_agg(k, n) INTO s2 FROM (SELECT coalesce(error_message, status) || CASE WHEN wave IS NOT NULL THEN ':w' || wave ELSE '' END k, count(*) n
    FROM email_campaign_recipients WHERE campaign_id='ec6daa79-91b3-4c79-ad08-b8c58c7704db' GROUP BY 1) x;
  g := email_campaign_guard_tick();
  dly := email_deliverability_daily();
  v1 := email_sender_health_visual('woh', NULL, 'crm');
  v2 := email_sender_health_visual(NULL, '10764c3b-f312-42da-be99-4d57d7c6c0c5', NULL);
  br := campaign_circuit_breaker('aa583e5c-0c52-45a6-a324-26f3d9d5952d');
  inc := _email_sender_incident('org:test-smoke', 'breaker', gen_random_uuid(), '{}');
  inc2 := _email_sender_incident('org:test-smoke', 'wave_halt', gen_random_uuid(), '{}');
  SELECT to_jsonb(h) - 'metrics' INTO lc FROM email_sender_health h WHERE scope_key = 'org:test-smoke';
  PERFORM email_deliverability_tick();
  RAISE EXCEPTION 'SMOKE_OK WOH % || % ##### 3AM % || % ##### GUARD % ##### DAILY % ##### VIS_WOH_TODAY % SMART % INC % SERIES_LAST % ##### VIS_3AM_TODAY % ##### BREAKER % ##### RECIDIVE % % %',
    r1 - 'yunits_balance', s1, r2 - 'yunits_balance', s2, g, dly, v1->'today', v1->'smart', v1->'incidents', v1->'series'->29, v2->'today', br, inc, inc2, lc;
END $s$;
