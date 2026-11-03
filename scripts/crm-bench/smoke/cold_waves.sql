-- Smoke de l'envoi progressif du froid (20261127110000), toujours annulé.
DO $s$
DECLARE
  v_org uuid; v_c uuid := gen_random_uuid(); v_hot text; r jsonb; n1 int; n2 int; n3 int; nheld int; nclaim int; nbad int;
  v_state text; v_note jsonb; v_def text; v_hn int;
BEGIN
  SELECT organizer_user_id INTO v_org FROM email_campaigns WHERE id='7b0423d0-2da1-4211-8a83-1114739473f9';
  DELETE FROM email_sender_health WHERE scope_key = 'org:' || v_org;
  SELECT lower(ev.recipient_email) INTO v_hot FROM email_campaign_events ev WHERE ev.event_type='opened' AND ev.created_at > now()-interval '30 days' LIMIT 1;
  v_def := pg_get_functiondef('public.enqueue_campaign_recipients(uuid)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, '_email_assign_waves', ''))) / length('_email_assign_waves') <> 2 THEN RAISE EXCEPTION 'hook KO'; END IF;

  INSERT INTO email_campaigns (id, name, subject, organizer_user_id, status, type) VALUES (v_c, 'SMOKE waves', 's', v_org, 'sending', 'promotional');
  INSERT INTO email_campaign_recipients (campaign_id, email, status) VALUES (v_c, v_hot, 'pending');
  INSERT INTO email_campaign_recipients (campaign_id, email, status)
    SELECT v_c, 'yuno.smoke.cold.' || g || CASE WHEN g % 2 = 0 THEN '@gmail.com' ELSE '@orange.fr' END, 'pending' FROM generate_series(1, 1200) g;

  -- 1. affectation
  r := _email_assign_waves(v_c, '{"queued":1201}'::jsonb);
  IF (r->>'cold')::int <> 1200 OR (r->>'waves')::int <> 4 OR (r->>'wave1_released')::int <> 100 THEN RAISE EXCEPTION 'assign KO %', r; END IF;
  SELECT count(*) INTO nheld FROM email_campaign_recipients WHERE campaign_id=v_c AND next_attempt_at='infinity';
  IF nheld <> 1100 THEN RAISE EXCEPTION 'held %', nheld; END IF;
  IF (SELECT wave FROM email_campaign_recipients WHERE campaign_id=v_c AND email=v_hot) IS NOT NULL THEN RAISE EXCEPTION 'hot got a wave'; END IF;

  -- 2. la réclamation ne prend jamais une ligne retenue
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT count(*) INTO nclaim FROM claim_campaign_recipients(v_c, 100) x WHERE x.email LIKE 'yuno.smoke.cold.%';
  SELECT count(*) INTO nbad FROM email_campaign_recipients WHERE campaign_id=v_c AND status='sending' AND wave >= 2;
  IF nbad > 0 THEN RAISE EXCEPTION 'claimed held rows %', nbad; END IF;
  UPDATE email_campaign_recipients SET status='pending', claimed_at=NULL, batch_key=NULL WHERE campaign_id=v_c AND status='sending';

  -- 3. vague 1 partie il y a 4 h, ~30 % d'ouvertures partout : la vague 2 s'ouvre
  UPDATE email_campaign_recipients SET status='sent', sent_at=now()-interval '4 hours' WHERE campaign_id=v_c AND wave=1;
  INSERT INTO email_campaign_events (campaign_id, recipient_email, event_type)
    SELECT v_c, email, 'opened' FROM email_campaign_recipients WHERE campaign_id=v_c AND wave=1 AND substr(md5(email),1,1) IN ('0','1','2','3','4');
  r := email_waves_tick();
  SELECT count(*) INTO n2 FROM email_campaign_recipients WHERE campaign_id=v_c AND wave=2 AND wave_released_at IS NOT NULL AND next_attempt_at <= now();
  IF n2 <> 200 THEN RAISE EXCEPTION 'wave2 not released % %', n2, r; END IF;

  -- 4. vague 2 : 5 % de rebonds → arrêt, reste écarté, compte à l'écart
  UPDATE email_campaign_recipients SET status='sent', sent_at=now()-interval '4 hours' WHERE campaign_id=v_c AND wave=2;
  UPDATE email_campaign_recipients SET status='bounced' WHERE id IN (SELECT id FROM email_campaign_recipients WHERE campaign_id=v_c AND wave=2 ORDER BY id LIMIT 30);
  r := email_waves_tick();
  SELECT wave_state, wave_note INTO v_state, v_note FROM email_campaigns WHERE id=v_c;
  SELECT count(*) INTO n3 FROM email_campaign_recipients WHERE campaign_id=v_c AND status='skipped' AND error_message='policy:cold_wave_halted';
  IF v_state <> 'halted' OR n3 <> 900 THEN RAISE EXCEPTION 'halt KO % % %', v_state, n3, v_note; END IF;
  IF NOT EXISTS (SELECT 1 FROM email_sender_health WHERE scope_key='org:'||v_org AND cold_frozen_until > now()) THEN RAISE EXCEPTION 'no probation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_notifications WHERE dedup_key='email_cold_halted:'||v_c) THEN RAISE EXCEPTION 'no alert'; END IF;

  -- 5. compte à l'écart : une nouvelle campagne n'envoie aucun froid
  v_c := gen_random_uuid();
  INSERT INTO email_campaigns (id, name, subject, organizer_user_id, status, type) VALUES (v_c, 'SMOKE waves 2', 's', v_org, 'sending', 'promotional');
  INSERT INTO email_campaign_recipients (campaign_id, email, status)
    SELECT v_c, 'yuno.smoke.cold2.' || g || '@orange.fr', 'pending' FROM generate_series(1, 300) g;
  r := _email_assign_waves(v_c, '{"queued":300}'::jsonb);
  IF (r->>'cold_frozen')::int <> 300 OR (r->>'queued')::int <> 0 THEN RAISE EXCEPTION 'frozen KO %', r; END IF;

  -- 5 bis. envoi réparti obligatoire : 600 / h imposé, puis compte autorisé = rien
  v_c := gen_random_uuid();
  DELETE FROM email_sender_health WHERE scope_key = 'org:' || v_org;
  INSERT INTO email_campaigns (id, name, subject, organizer_user_id, status, type, total_recipients) VALUES (v_c, 'SMOKE spread', 's', v_org, 'sending', 'promotional', 500);
  r := _email_assign_waves(v_c, '{}'::jsonb);
  IF NOT COALESCE((r->>'spread_forced')::boolean, false) OR (SELECT throttle_per_hour FROM email_campaigns WHERE id=v_c) <> 600 THEN RAISE EXCEPTION 'spread KO %', r; END IF;
  v_c := gen_random_uuid();
  INSERT INTO email_campaigns (id, name, subject, organizer_user_id, status, type, total_recipients, throttle_per_hour, throttle_window_minutes) VALUES (v_c, 'SMOKE spread 2', 's', v_org, 'sending', 'promotional', 5000, 2000, 15);
  r := _email_assign_waves(v_c, '{}'::jsonb);
  IF (SELECT throttle_per_hour FROM email_campaigns WHERE id=v_c) <> 250 THEN RAISE EXCEPTION 'clamp KO'; END IF;
  INSERT INTO email_sender_health (scope_key, burst_allowed) VALUES ('org:' || v_org, true) ON CONFLICT (scope_key) DO UPDATE SET burst_allowed = true, cold_frozen_until = NULL;
  v_c := gen_random_uuid();
  INSERT INTO email_campaigns (id, name, subject, organizer_user_id, status, type, total_recipients) VALUES (v_c, 'SMOKE burst', 's', v_org, 'sending', 'promotional', 5000);
  r := _email_assign_waves(v_c, '{}'::jsonb);
  IF (SELECT throttle_per_hour FROM email_campaigns WHERE id=v_c) IS NOT NULL THEN RAISE EXCEPTION 'burst KO'; END IF;
  -- 6. surveillance
  r := email_deliverability_watch();
  v_hn := jsonb_array_length(r->'flagged');
  -- 7. lecture admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM user_roles WHERE role='admin' LIMIT 1), 'role','authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  r := admin_email_deliverability_watch();
  IF jsonb_typeof(admin_email_senders()) <> 'array' THEN RAISE EXCEPTION 'senders KO'; END IF;
  IF NOT ((email_sender_send_mode(NULL, v_org))->>'burst_allowed')::boolean THEN RAISE EXCEPTION 'send_mode KO'; END IF;
  IF (SELECT email_campaign_send_rules((SELECT id FROM email_campaigns WHERE name='SMOKE waves'))->>'wave_state') <> 'halted' THEN RAISE EXCEPTION 'send_rules KO'; END IF;
  RAISE EXCEPTION 'SMOKE_OK held=% wave2=% halted_skipped=% watch_flagged=% gmail=% senders=%', nheld, n2, n3, v_hn,
    (SELECT to_jsonb(x) FROM (SELECT 1) x), jsonb_array_length(r->'senders');
END $s$;
