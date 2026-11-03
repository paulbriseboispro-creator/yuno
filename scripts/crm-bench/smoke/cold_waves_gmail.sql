-- Gmail rangé en spam pendant que les autres ouvrent : arrêt relatif (annulé).
DO $s$
DECLARE v_org uuid; v_c uuid := gen_random_uuid(); r jsonb; v_state text; v_note jsonb; ng int;
BEGIN
  SELECT organizer_user_id INTO v_org FROM email_campaigns WHERE id='7b0423d0-2da1-4211-8a83-1114739473f9';
  DELETE FROM email_sender_health WHERE scope_key = 'org:' || v_org;
  INSERT INTO email_campaigns (id, name, subject, organizer_user_id, status, type) VALUES (v_c, 'SMOKE gmail', 's', v_org, 'sending', 'promotional');
  INSERT INTO email_campaign_recipients (campaign_id, email, status)
    SELECT v_c, 'yuno.smoke.g.' || g || CASE WHEN g % 2 = 0 THEN '@gmail.com' ELSE '@orange.fr' END, 'pending' FROM generate_series(1, 1200) g;
  UPDATE email_deliverability_settings SET gmail_recovery = false, wave_first = 200 WHERE id;  -- la règle Gmail des vagues, seule
  r := _email_assign_waves(v_c, '{}'::jsonb);
  SELECT count(*) FILTER (WHERE _email_is_gmail(email)) INTO ng FROM email_campaign_recipients WHERE campaign_id=v_c AND wave_released_at IS NOT NULL;
  -- vague 1 : les autres ouvrent à ~30 %, Gmail à ~6 % (au-dessus du seuil fixe de 2 %)
  UPDATE email_campaign_recipients SET status='sent', sent_at=now()-interval '4 hours' WHERE campaign_id=v_c AND wave=1;
  INSERT INTO email_campaign_events (campaign_id, recipient_email, event_type)
    SELECT v_c, email, 'opened' FROM email_campaign_recipients
     WHERE campaign_id=v_c AND wave=1 AND ((NOT _email_is_gmail(email) AND substr(md5(email),1,1) IN ('0','1','2','3','4')) OR (_email_is_gmail(email) AND substr(md5(email),1,1) = '0'));
  r := email_waves_tick();
  SELECT wave_state, wave_note INTO v_state, v_note FROM email_campaigns WHERE id=v_c;
  IF v_state <> 'halted' OR v_note->>'reason' <> 'gmail_spam' THEN RAISE EXCEPTION 'relative gmail KO % %', v_state, v_note; END IF;
  RAISE EXCEPTION 'SMOKE_OK state=% note=% gmail_in_wave1=%', v_state, v_note, ng;
END $s$;
