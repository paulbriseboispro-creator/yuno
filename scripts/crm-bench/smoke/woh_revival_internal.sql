-- REVIVAL interne : plafond caché, rien d'affiché (annulé).
DO $s$
DECLARE a int; b int; c int; d int; lbl text; lv int; h int; rep jsonb;
BEGIN
  a := email_sender_daily_cap('venue:woh');
  b := email_sender_daily_cap('org:06ce47f8-66a5-42d5-a7bf-56253619ff96');
  c := email_sender_daily_cap('org:617d01cb-6568-4a7a-9aea-4f25d9c29fc8');
  UPDATE email_sender_health SET internal_cap_from = now() - interval '1 minute' WHERE scope_key = 'venue:woh';
  d := email_sender_daily_cap('venue:woh');
  SELECT x->>'label' INTO lbl FROM email_campaigns, jsonb_array_elements(audiences_json) x WHERE id = 'aa583e5c-0c52-45a6-a324-26f3d9d5952d';
  SELECT level INTO lv FROM email_sender_health WHERE scope_key = 'venue:woh';
  SELECT count(*) INTO h FROM cron.job WHERE jobname LIKE 'woh-revival-level%';
  RAISE EXCEPTION 'SMOKE_OK woh_now=% amoris=% wohtix=% woh_window=% label=% level=% leveljobs=%', a, b, c, d, lbl, lv, h;
END $s$;
