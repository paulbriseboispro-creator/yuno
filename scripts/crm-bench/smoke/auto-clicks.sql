DO $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'per_campaign', (SELECT jsonb_agg(x) FROM (
        SELECT left(campaign_id::text, 8) c, event_type, count(*) n, count(DISTINCT lower(recipient_email)) people
          FROM public.email_campaign_events
         WHERE campaign_id IN ('ec6daa79-91b3-4c79-ad08-b8c58c7704db', 'f770ce21-65b4-4cdf-b33c-dd33ef80be2d')
           AND event_type IN ('clicked', 'auto_click') GROUP BY 1, 2 ORDER BY 1, 2) x),
    'platform', (SELECT jsonb_object_agg(event_type, n) FROM (
        SELECT event_type, count(*) n FROM public.email_campaign_events
         WHERE event_type IN ('clicked', 'auto_click') AND recipient_email NOT ILIKE '%@example.%' AND created_at >= '2026-10-01'
         GROUP BY 1) y),
    'humans_3am', (SELECT jsonb_agg(DISTINCT lower(recipient_email)) FROM public.email_campaign_events
         WHERE campaign_id IN ('ec6daa79-91b3-4c79-ad08-b8c58c7704db', 'f770ce21-65b4-4cdf-b33c-dd33ef80be2d') AND event_type = 'clicked'),
    'counters', (SELECT jsonb_agg(jsonb_build_object('c', left(id::text, 8), 'clicks', clicks_count, 'clickers', clickers_count))
         FROM public.email_campaigns WHERE id IN ('ec6daa79-91b3-4c79-ad08-b8c58c7704db', 'f770ce21-65b4-4cdf-b33c-dd33ef80be2d'))
  ) INTO v;
  RAISE EXCEPTION 'SMOKE_OK %', v;
END $$;
