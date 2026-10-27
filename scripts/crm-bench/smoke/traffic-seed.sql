DO $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '6a958c46-680d-4c6a-aec0-15301af47e1f', 'role', 'authenticated')::text, true);
  r := public.crm_ana_clicks(NULL, '6a958c46-680d-4c6a-aec0-15301af47e1f'::uuid, '30d');
  RAISE EXCEPTION 'SMOKE_OK ig=%/% hours=% devices=% keep=% page_link_clicks=%',
    r->'totals'->>'ig_in', r->'totals'->>'ig_known', r->'hours', r->'devices', r->'keep',
    (SELECT count(*) FROM public.tracked_link_clicks c JOIN public.crm_signup_pages p ON p.go_link_id = c.tracked_link_id);
END $$;
