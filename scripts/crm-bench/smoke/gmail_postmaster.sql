-- Google Postmaster : écriture, alerte, attribution du 09/09 (annulé).
DO $s$
DECLARE r jsonb; snd jsonb; a jsonb;
BEGIN
  r := record_gmail_postmaster('yunoapp.eu', '[{"day":"2026-11-01","spam":0.01,"delivery_error":0.02,"auth":0.99}]'::jsonb, '{"x":1}'::jsonb, NULL);
  snd := _gmail_senders_on('2026-09-09');
  SELECT jsonb_agg(jsonb_build_object('t', title, 'm', left(message, 260))) INTO a FROM admin_notifications WHERE dedup_key LIKE 'google_spam:%';
  RAISE EXCEPTION 'SMOKE_OK % ### 0909 % ### %', r, snd, a;
END $s$;
