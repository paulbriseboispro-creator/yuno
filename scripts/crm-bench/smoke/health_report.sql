-- La page « Santé de vos e-mails » sur les vrais comptes (annulé), en super admin.
DO $s$
DECLARE r1 jsonb; r2 jsonb; r3 jsonb; t0 timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM user_roles WHERE role='admin' LIMIT 1), 'role','authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  t0 := clock_timestamp();
  r1 := email_sender_health_report(NULL, '617d01cb-6568-4a7a-9aea-4f25d9c29fc8', NULL);
  r2 := email_sender_health_report(NULL, '06ce47f8-66a5-42d5-a7bf-56253619ff96', NULL);
  r3 := email_sender_health_report(NULL, '10764c3b-f312-42da-be99-4d57d7c6c0c5', 'crm');
  RAISE EXCEPTION 'SMOKE_OK ms=% ### WOH % ### AMORIS % ### 3AM %', round(extract(epoch FROM clock_timestamp()-t0)*1000),
    r1 - 'rules' - 'thresholds' - 'campaigns', r2 - 'rules' - 'thresholds' - 'campaigns', r3 - 'rules' - 'thresholds';
END $s$;
