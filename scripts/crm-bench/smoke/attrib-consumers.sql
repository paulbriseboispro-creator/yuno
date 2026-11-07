DO $$
DECLARE
  o uuid := '10764c3b-f312-42da-be99-4d57d7c6c0c5';
  c uuid := 'ec6daa79-91b3-4c79-ad08-b8c58c7704db';
  res jsonb := '{}'::jsonb; j jsonb; t0 timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', o::text, 'role', 'authenticated')::text, true);
  BEGIN j := public.crm_email_overview__core(NULL, o, 30); res := res || jsonb_build_object('overview', jsonb_build_object('md5', md5(j::text), 'cur', j->'current')); EXCEPTION WHEN others THEN res := res || jsonb_build_object('overview', 'ERR ' || SQLERRM); END;
  BEGIN j := public.crm_email_recipients__core(NULL, o, c, 'clicked'); res := res || jsonb_build_object('recipients_clicked', jsonb_build_object('total', j->'total', 'counts', j->'counts')); EXCEPTION WHEN others THEN res := res || jsonb_build_object('recipients', 'ERR ' || SQLERRM); END;
  BEGIN j := public.crm_email_result_segments__core(NULL, o, c); res := res || jsonb_build_object('result_segments', md5(j::text)); EXCEPTION WHEN others THEN res := res || jsonb_build_object('result_segments', 'ERR ' || SQLERRM); END;
  BEGIN j := public.crm_email_analysis__core(NULL, o); res := res || jsonb_build_object('analysis', md5(j::text)); EXCEPTION WHEN others THEN res := res || jsonb_build_object('analysis', 'ERR ' || SQLERRM); END;
  BEGIN j := public.crm_ana_traffic__core(NULL, o, '90d', NULL); res := res || jsonb_build_object('traffic_messages', j->'messages'); EXCEPTION WHEN others THEN res := res || jsonb_build_object('traffic', 'ERR ' || SQLERRM); END;
  BEGIN j := public.crm_journey__core(NULL, o, '90d', NULL, NULL, 'all', 'all'); res := res || jsonb_build_object('journey', md5(j::text)); EXCEPTION WHEN others THEN res := res || jsonb_build_object('journey', 'ERR ' || SQLERRM); END;
  BEGIN j := public.crm_home__core(NULL, o, '30d'); res := res || jsonb_build_object('home', md5(j::text)); EXCEPTION WHEN others THEN res := res || jsonb_build_object('home', 'ERR ' || SQLERRM); END;
  BEGIN j := public.crm_segments_overview__core(NULL, o, '90d'); res := res || jsonb_build_object('segments', md5(j::text)); EXCEPTION WHEN others THEN res := res || jsonb_build_object('segments', 'ERR ' || SQLERRM); END;
  BEGIN j := public.crm_automations__core(NULL, o, '90d'); res := res || jsonb_build_object('automations', md5(j::text)); EXCEPTION WHEN others THEN res := res || jsonb_build_object('automations', 'ERR ' || SQLERRM); END;
  RAISE EXCEPTION 'SMOKE_OK %', res;
END $$;
