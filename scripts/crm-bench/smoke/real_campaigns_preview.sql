-- Ce que feraient les vraies campagnes avec les nouvelles règles (annulé).
DO $s$
DECLARE r1 jsonb; r2 jsonb; s1 jsonb; s2 jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r1 := enqueue_campaign_recipients('aa583e5c-0c52-45a6-a324-26f3d9d5952d');
  SELECT jsonb_object_agg(k, n) INTO s1 FROM (SELECT coalesce(error_message, status) || CASE WHEN wave IS NOT NULL THEN ':w' || wave ELSE '' END k, count(*) n
    FROM email_campaign_recipients WHERE campaign_id='aa583e5c-0c52-45a6-a324-26f3d9d5952d' GROUP BY 1) x;
  r2 := enqueue_campaign_recipients('ec6daa79-91b3-4c79-ad08-b8c58c7704db');
  SELECT jsonb_object_agg(k, n) INTO s2 FROM (SELECT coalesce(error_message, status) || CASE WHEN wave IS NOT NULL THEN ':w' || wave ELSE '' END k, count(*) n
    FROM email_campaign_recipients WHERE campaign_id='ec6daa79-91b3-4c79-ad08-b8c58c7704db' GROUP BY 1) x;
  RAISE EXCEPTION 'SMOKE_OK WOH % || % ##### 3AM % || %', r1, s1, r2, s2;
END $s$;
