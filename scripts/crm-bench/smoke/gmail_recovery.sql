-- Smoke du mode reprise Gmail (20261127100000), toujours annulé.
DO $s$
DECLARE
  v_hot text; v_admin uuid; r jsonb; v_res text; n_cold int; n_total int; n_gm int;
BEGIN
  SELECT lower(ev.recipient_email) INTO v_hot FROM email_campaign_events ev
   WHERE ev.event_type='opened' AND _email_is_gmail(ev.recipient_email) AND ev.created_at > now()-interval '30 days' LIMIT 1;
  -- 1. forme ensembliste
  SELECT string_agg(email||'='||coalesce(reason,'ok'), ' ' ORDER BY email) INTO v_res
    FROM _email_send_policy_many(ARRAY[v_hot, 'yuno.cold.smoke@gmail.com', 'yuno.cold.smoke@googlemail.com', 'yuno.cold.smoke@orange.fr'], 'campaign');
  RAISE NOTICE 'many: %', regexp_replace(v_res, '^[^=]*=', 'HOT=');
  IF v_res NOT LIKE '%yuno.cold.smoke@gmail.com=gmail_cold%' OR v_res NOT LIKE '%yuno.cold.smoke@googlemail.com=gmail_cold%' OR v_res NOT LIKE '%orange.fr=ok%' THEN RAISE EXCEPTION 'many KO: %', v_res; END IF;
  IF (SELECT reason FROM _email_send_policy_many(ARRAY[v_hot],'campaign')) = 'gmail_cold' THEN RAISE EXCEPTION 'engaged gmail held'; END IF;
  -- 2. forme unitaire
  IF email_send_policy('yuno.cold.smoke@gmail.com','missed_you') IS DISTINCT FROM 'gmail_cold' THEN RAISE EXCEPTION 'single KO'; END IF;
  IF email_send_policy(v_hot,'missed_you') = 'gmail_cold' THEN RAISE EXCEPTION 'single engaged held'; END IF;
  IF email_send_policy('yuno.cold.smoke@orange.fr','missed_you') = 'gmail_cold' THEN RAISE EXCEPTION 'single non-gmail held'; END IF;
  -- 3. impact sur la base WOH (destinataires du 08/10)
  SELECT count(*), count(*) FILTER (WHERE _email_is_gmail(email)) INTO n_total, n_gm FROM email_campaign_recipients WHERE campaign_id='7b0423d0-2da1-4211-8a83-1114739473f9' AND status='sent';
  SELECT count(*) INTO n_cold FROM _email_send_policy_many(ARRAY(SELECT email FROM email_campaign_recipients WHERE campaign_id='7b0423d0-2da1-4211-8a83-1114739473f9' AND status='sent'),'campaign') WHERE reason='gmail_cold';
  RAISE NOTICE 'WOH base: % adresses, % gmail, % gmail froides retenues', n_total, n_gm, n_cold;
  -- 3b. accord frais : passe ; fichier importé : retenu
  INSERT INTO newsletter_subscriptions (email, opted_in, source, organizer_user_id) VALUES ('yuno.fresh.smoke@gmail.com', true, 'signup_page', (SELECT organizer_user_id FROM email_campaigns WHERE id='7b0423d0-2da1-4211-8a83-1114739473f9'));
  IF email_send_policy('yuno.fresh.smoke@gmail.com','campaign') = 'gmail_cold' THEN RAISE EXCEPTION 'fresh held (single)'; END IF;
  IF (SELECT reason FROM _email_send_policy_many(ARRAY['yuno.fresh.smoke@gmail.com'],'campaign')) = 'gmail_cold' THEN RAISE EXCEPTION 'fresh held (many)'; END IF;
  INSERT INTO newsletter_subscriptions (email, opted_in, source, organizer_user_id) VALUES ('yuno.imp.smoke@gmail.com', true, 'import', (SELECT organizer_user_id FROM email_campaigns WHERE id='7b0423d0-2da1-4211-8a83-1114739473f9'));
  IF email_send_policy('yuno.imp.smoke@gmail.com','campaign') IS DISTINCT FROM 'gmail_cold' THEN RAISE EXCEPTION 'import passed'; END IF;
  -- 4. interrupteur
  UPDATE email_deliverability_settings SET gmail_recovery=false WHERE id;
  IF email_send_policy('yuno.cold.smoke@gmail.com','missed_you') = 'gmail_cold' THEN RAISE EXCEPTION 'switch off ignored'; END IF;
  UPDATE email_deliverability_settings SET gmail_recovery=true WHERE id;
  -- 4b. registre des recettes : le motif est accepté, et la collecte tourne
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='email_automation_sends_skip_reason_check')) NOT LIKE '%gmail_cold%' THEN RAISE EXCEPTION 'check KO'; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('role', 'service_role', true);
  r := collect_email_automations()::jsonb;
  RAISE NOTICE 'collect %', r;
  PERFORM set_config('role', 'postgres', true);
  -- 5. lecture admin
  SELECT ur.user_id INTO v_admin FROM user_roles ur WHERE ur.role='admin' LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  r := admin_email_deliverability();
  RAISE NOTICE 'admin: pool=% held=% days=%', r->>'gmail_engaged_pool', r->>'gmail_held_30d', jsonb_array_length(r->'days');
  r := admin_set_email_deliverability(true, 90, 'smoke');
  IF (r->>'gmail_engaged_days')::int <> 90 THEN RAISE EXCEPTION 'set KO'; END IF;
  RAISE EXCEPTION 'SMOKE_OK woh=% gmail=% froides=% pool=% days=%', n_total, n_gm, n_cold, r->>'gmail_engaged_pool', jsonb_array_length(r->'days');
END $s$;
