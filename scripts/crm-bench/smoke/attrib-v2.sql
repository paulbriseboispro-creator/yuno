DO $$
DECLARE
  o uuid := '10764c3b-f312-42da-be99-4d57d7c6c0c5';
  c uuid := 'ec6daa79-91b3-4c79-ad08-b8c58c7704db';
  r jsonb; l jsonb; v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', o::text, 'role', 'authenticated')::text, true);
  r := public.crm_email_result__core(NULL, o, c);
  l := public.crm_email_campaigns__core(NULL, o);
  v := jsonb_build_object(
    'stats', r->'stats',
    'started', r->'started_at', 'days_sold', r#>'{days,sold}', 'days_seen', r#>'{days,seen}', 'days_later', r#>'{days,later}',
    'sales_total', r->'sales_total', 'sales', (SELECT jsonb_agg(jsonb_build_object('e', left(x->>'email', 6), 'at', x->>'at', 'level', x->>'level', 'shared', x->'shared', 'deal', left(x->>'deal', 18))) FROM jsonb_array_elements(r->'sales') x),
    'follow', r->'follow', 'links', r->'links',
    'list', (SELECT jsonb_agg(jsonb_build_object('n', x->>'name', 'stats', x->'stats')) FROM jsonb_array_elements(l->'campaigns') x WHERE x->'stats' IS NOT NULL));
  RAISE EXCEPTION 'SMOKE_OK %', v;
END $$;
