-- Liste admin des comptes avec niveau et droits (annulé).
DO $s$ DECLARE r jsonb; BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM user_roles WHERE role='admin' LIMIT 1), 'role','authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT jsonb_agg(jsonb_build_object('name', x->>'name', 'level', x->'level', 'daily', x->'rights'->'daily_cap', 'per_h', x->'rights'->'per_hour', 'ok', (SELECT count(*) FROM jsonb_each_text(x->'checks') WHERE value='true'))) INTO r
    FROM jsonb_array_elements(admin_email_senders()) x;
  RAISE EXCEPTION 'SMOKE_OK %', r;
END $s$;
