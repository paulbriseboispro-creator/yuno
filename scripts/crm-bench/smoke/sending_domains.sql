-- Sous-domaines d'envoi : cycle et adresse (annulé).
DO $s$
DECLARE a text; b text; r jsonb;
BEGIN
  INSERT INTO email_sending_domains (scope_key, domain, status, verified_at) VALUES ('org:617d01cb-6568-4a7a-9aea-4f25d9c29fc8', 'woh.news.yunoapp.eu', 'verified', now());
  PERFORM set_config('request.jwt.claims', '{"sub":"fceae0a5-d888-48f2-8c99-7c32c9559476","role":"authenticated"}', true);
  a := email_sending_address_for('org:617d01cb-6568-4a7a-9aea-4f25d9c29fc8');
  r := admin_set_email_sending_domain('org:617d01cb-6568-4a7a-9aea-4f25d9c29fc8', 'active', 'test smoke');
  b := email_sending_address_for('org:617d01cb-6568-4a7a-9aea-4f25d9c29fc8');
  RAISE EXCEPTION 'SMOKE_OK before=% after=% list=% active=%', a, b, r, email_sending_domains_active();
END $s$;
