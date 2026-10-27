DO $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '6a958c46-680d-4c6a-aec0-15301af47e1f', 'role', 'authenticated')::text, true);
  r := public._mcp_crm_clicks(NULL, '6a958c46-680d-4c6a-aec0-15301af47e1f'::uuid, '30d');
  RAISE EXCEPTION 'SMOKE_OK patch=% keys=% clicks=%',
    position('_mcp_crm_clicks' IN pg_get_functiondef('public._mcp_tool'::regproc)) > 0,
    (SELECT string_agg(k, ',') FROM jsonb_object_keys(r) k), r->'totals'->>'clicks';
END $$;
